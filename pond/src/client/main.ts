/**
 * The client entry point.
 *
 * Bundled to `public/app.js` by `npm run build:client`, and the output is
 * COMMITTED — `public/` is served verbatim by the CDN and nothing builds at
 * deploy time. See tools/build-client.mjs for why that invariant matters.
 *
 * The server renders the shell and hands over a bootstrap block naming
 * which view to open. There is no router: the pond is one page, and the
 * screens are states of it. That is the whole reason the camera can glide
 * from a duck card back to the water rather than navigating.
 */

import {
  ApiError, api, loadDraft, recallEditKey,
  type ReportReason, type SessionState,
} from "./api.js";
import { button, ditherEdge, field, sheet as makeSheet } from "./dom.js";
import { icon } from "./icons.js";
import { mineScreen } from "./mine.js";
import { FORTUNES } from "./sprites.js";
import { CAM_UI, HOME_CELL } from "./camera.js";
import { cardSetup, claimFromUrl } from "./keeper.js";
import { releaseFlow } from "./release-flow.js";
import { PondView, SPLASH_TAP, type Placed } from "./pond-view.js";
import { GRID } from "./codec.js";
import { TAG, drawDuck } from "./render.js";
import { prefersReducedMotion } from "./viewport.js";
import { fortuneTitle, setLang, t, type Lang } from "./strings.js";
import { watchSize } from "./viewport.js";
import type { PondDuck } from "./types.js";

interface Bootstrap {
  view?: "pond" | "duck" | "edit";
  duck?: PondDuck;
  editKey?: string;
  missing?: string;
}

function boot(): Bootstrap {
  const el = document.getElementById("pond-bootstrap");
  if (!el?.textContent) return {};
  try {
    return JSON.parse(el.textContent) as Bootstrap;
  } catch {
    return {};
  }
}

const root = document.getElementById("pond")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML: a duck's name and message are somebody
  // else's text, and this is the one place they meet the DOM.
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The pond screen.
 *
 * Also the visitor state — someone who tapped a card with no coin in it
 * gets exactly this, minus the CTA. FLOW.md is explicit that a visitor
 * still has something to do: they can put out fires.
 */
/**
 * Everything the pond screen has to undo before another screen replaces it.
 *
 * `pondScreen` used to run exactly once per page load, so leaking two
 * intervals and a resize listener cost nothing. It is re-entrant now —
 * "Just look around" and finishing a duck both come back to it — and
 * without this every round trip would leave another poller running against
 * a canvas that no longer exists.
 */
let teardown: (() => void) | null = null;

async function pondScreen(bootstrap: Bootstrap): Promise<void> {
  teardown?.();
  root.replaceChildren();

  const stage = el("div", "p-stage");
  const canvas = el("canvas", "p-canvas");
  stage.append(canvas);

  const hud = el("div", "p-hud");
  const count = el("button", "p-count");
  count.type = "button";
  count.setAttribute("aria-label", t("pond.13"));

  /*
   * The card's own mark, opposite the count. It is the only thing on the
   * water that leaves the pond, so it says where it goes before it is
   * tapped — pond.02 is the whole sentence, not a decoration.
   */
  const mark = el("a", "p-mark", "BY-002");
  mark.href = "https://davidyang.work";
  mark.target = "_blank";
  mark.rel = "noopener noreferrer";
  mark.setAttribute("aria-label", t("pond.02"));

  hud.append(count, mark);

  const cta = el("div", "p-cta");

  // Where you are. Small, permanent, and the only place the address is
  // written down for somebody who wants to type it in later.
  const wordmark = el("p", "p-wordmark", "ducky.davidyang.work");

  /*
   * Where the making screens render.
   *
   * They sit OVER the water rather than replacing it, so the pond keeps
   * moving behind every sheet. That is what makes decorating feel like
   * making something for a specific place — and it is why nothing below
   * ever calls `replaceChildren` on the root itself.
   */
  const overlay = el("div", "p-overlay");

  /*
   * ══ SPEECH BUBBLES ARE DOM, NOT CANVAS ══
   * Everything else in the pond is drawn, and a bubble drawn into the
   * canvas would match perfectly — and be invisible to a screen reader,
   * unreadable in Chinese without a bitmap font covering it, and unable to
   * wrap. Sixty characters of somebody's own words is exactly the content
   * that has to be REAL text.
   *
   * So it is an element, dressed to belong: the pond's ink, its mono face,
   * its pixel corners. It is glued to its duck on the same frame the duck
   * moves (see `onDraw`), which is what keeps it from swimming behind.
   */
  /**
   * Sixty characters, matching `SAY_MAX_CHARS` on the server.
   *
   * Stated here rather than imported: the client bundle must not reach into
   * the worker, and the server is the authority anyway — this is a courtesy
   * that must never be STRICTER than what will be accepted.
   */
  const SAY_MAX_CHARS = 60;

  /**
   * The gap between a duck's head and the bubble over it, in CSS pixels.
   *
   * The LIFT itself is half a duck, which the view measures, because a duck
   * is twice as tall at cell 8 as at cell 4 — a fixed lift tuned at one
   * rung sits on the duck's head at the next one. Only the breathing room
   * is a constant.
   */
  const SAY_GAP = 6;

  const says = el("div", "p-says");
  says.setAttribute("aria-live", "polite");

  const view = new PondView({
    canvas,
    onTapDuck: (d) => openDuckCard(view, d),
    /*
     * The pond has already shown the steam; this tells the server, which
     * credits whoever got there first. A failure changes nothing on
     * screen — the fire is out either way, and the next poll is the truth.
     */
    onDouseDuck: (d) => void api.extinguish(d.id).catch(() => {}),
    onTapWater: (wx, wy) => view.splash(wx, wy, SPLASH_TAP),
    onDraw: () => positionSays(),
  });

  /** The bubbles currently on screen, by duck id. */
  const bubbles = new Map<string, HTMLElement>();

  /**
   * Put every bubble over its duck.
   *
   * Runs on every drawn frame, so it does the least it can: no layout
   * reads, no allocation, and a transform rather than top/left so the
   * browser never reflows the page to move one.
   */
  /** Reused between frames so a bubble sync allocates nothing. */
  const placements: { node: HTMLElement; x: number; y: number; off: boolean }[] = [];

  /**
   * The band a bubble is allowed to float in.
   *
   * ══ A BUBBLE MUST NOT SIT ON A BUTTON ══
   * Reported from a real screenshot: a bubble over the count chip, and
   * another over the bar. Both are chrome — things you press — and text
   * lying across them makes the pond look broken and the button look
   * unpressable, even though it still works.
   *
   * Measured from the chrome itself rather than guessed, because all three
   * move: the HUD sits under the notch, the bar sits above the home
   * indicator, and both change with the safe-area insets on every phone.
   * A bubble whose duck is inside the band is simply not drawn — better a
   * missing bubble than one lying over the controls, and the duck is still
   * there to be tapped.
   */
  function safeBand(box: DOMRect): { top: number; bottom: number } {
    const clear = (sel: string, edge: "top" | "bottom"): number => {
      const e = document.querySelector(sel);
      if (!e) return edge === "top" ? 0 : box.height;
      const r = e.getBoundingClientRect();
      if (!r.height) return edge === "top" ? 0 : box.height;
      return edge === "top" ? r.bottom - box.top : r.top - box.top;
    };
    return { top: Math.max(0, clear(".p-hud", "top")), bottom: clear(".p-cta", "bottom") };
  }

  function positionSays(): void {
    if (!bubbles.size) return;
    /*
     * ══ READ EVERYTHING, THEN WRITE EVERYTHING ══
     * This runs on every drawn frame. Interleaved, each write invalidates
     * layout and the next read forces the browser to recompute it — a
     * thrash that costs more the more people are talking, which is exactly
     * backwards. Both the layer's box and each duck's position are read
     * first, into a list reused between frames, and only then is anything
     * touched.
     */
    const box = says.getBoundingClientRect();
    const band = safeBand(box);
    placements.length = 0;
    for (const [id, node] of bubbles) {
      const at = view.screenOf(id);
      /*
       * A duck outside the window has no bubble. The world WRAPS, so a duck
       * two screens away still projects to a real position — it is simply
       * one nobody can see, and a bubble hanging there is a sentence with
       * nothing saying it.
       */
      const x = at ? at.x - box.left : 0;
      const duckY = at ? at.y - box.top : 0;
      const y = duckY - (at?.r ?? 0) - SAY_GAP;
      const off = !at ||
        // Off the sides, or off the top and bottom of the window entirely.
        x < 0 || x > box.width || duckY < 0 || duckY > box.height ||
        // Or the bubble would land on the chrome.
        y - node.offsetHeight < band.top || duckY > band.bottom;
      placements.push({ node, x, y, off });
    }
    for (const p of placements) {
      p.node.hidden = p.off;
      if (p.off) continue;
      p.node.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`;
    }
  }

  /**
   * Bring the bubbles into step with what the pond just said.
   *
   * The server only sends a `say` while it is live, so a duck whose bubble
   * has expired simply stops mentioning it — there is no separate expiry
   * to run here, and nothing to get out of step with.
   */
  function syncSays(list: PondDuck[]): void {
    const live = new Set<string>();
    for (const d of list) {
      if (!d.say?.text) continue;
      live.add(d.id);
      let node = bubbles.get(d.id);
      if (!node) {
        node = el("p", "p-say");
        bubbles.set(d.id, node);
        says.append(node);
      }
      if (node.textContent !== d.say.text) node.textContent = d.say.text;
    }
    for (const [id, node] of bubbles) {
      if (live.has(id)) continue;
      node.remove();
      bubbles.delete(id);
    }
    positionSays();
  }

  /**
   * Zoom controls — pond.06 to pond.09 in the deck.
   *
   * Pinch and wheel are the direct way; these are the discoverable one, and
   * the only one available to somebody who cannot pinch. Each steps one rung
   * of the ladder and glides, so the zoom that arrives is always integral.
   */
  const zoom = el("div", "p-zoom");
  const zoomBtn = (label: string, aria: string, dir: 1 | -1) => {
    const b = el("button", "p-icon-btn", label);
    b.type = "button";
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", () => {
      const next = view.camera.step(dir);
      // null at the ends of the ladder. Disable rather than no-op silently,
      // so the control tells the truth about what it can do.
      if (next !== null) view.camera.glide({ cell: next }, CAM_UI);
      syncZoom();
    });
    return b;
  };
  const zoomIn = zoomBtn(t("pond.07"), t("pond.06"), 1);
  const zoomOut = zoomBtn(t("pond.09"), t("pond.08"), -1);
  const syncZoom = () => {
    zoomIn.disabled = view.camera.step(1) === null;
    zoomOut.disabled = view.camera.step(-1) === null;
  };
  zoom.append(zoomIn, zoomOut);

  root.append(stage, says, hud, zoom, cta, wordmark, overlay);


  // A handle for looking at the real thing in a real browser. The pond is
  // canvas, so nothing about its state is visible in the DOM inspector —
  // and reasoning about geometry instead of measuring it has already cost
  // two wrong fixes.
  //
  // NOT `window.pond`: an element with id="pond" already claims that name
  // through the legacy named-access behaviour, so the assignment silently
  // did nothing and the handle read back as an HTMLDivElement.
  (window as unknown as { __pond?: unknown }).__pond = view;

  const fit = () => view.resize();
  fit();
  watchSize(canvas, fit);
  view.start();
  syncZoom();
  // A pinch changes the zoom without touching a button, so the buttons have
  // to notice. Cheap, and only while something is happening.
  const zoomPoll = window.setInterval(syncZoom, 500);

  // ── the pond itself ───────────────────────────────────────────────────
  //
  // The whistle's state is declared BEFORE `refresh`, because refresh calls
  // `syncCount`. Declared after, it sat in the temporal dead zone during
  // the first refresh, threw, and was caught by refresh's own error handler
  // — so a working pond reported "the pond is not answering". The second
  // time this exact shape of bug has bitten in this file.
  let ducks: PondDuck[] = [];
  /**
   * The whistle.
   *
   * "The count IS the whistle" — tapping it opens the gather list, so the
   * gesture costs no chrome over the water. Picking a card calls that
   * card's ducks in and pushes everyone else clear of the frame; the label
   * reads "30 of 113" while it is active.
   */
  let calling: string | null = null;
  const sheet = el("div", "p-sheet");
  sheet.hidden = true;

  const syncCount = () => {
    if (calling === null) {
      count.textContent =
        ducks.length === 0 ? t("live.count.none")
        : ducks.length === 1 ? t("live.count.one")
        : t("live.count", { n: String(ducks.length) });
      return;
    }
    const n = ducks.filter((d) => d.keeper === calling).length;
    count.textContent = t("live.count.of", { n: String(n), total: String(ducks.length) });
  };

  /*
   * ══ A FILTER YOU CAN SEE, AND LEAVE ══
   * Whistling gathers one keeper's ducks and leaves the rest of the pond
   * where it is. That is a MODE, and the only sign of it was the count
   * quietly changing from "13 ducks" to "5 of 13" — which reads as the
   * pond having lost ducks rather than as you having narrowed it.
   *
   * So the pill says whose circle you are in, and carries its own way out.
   * A mode with no visible exit is a trap, and this one is easy to enter
   * by tapping the count to see what it does.
   */
  const whistle = el("div", "p-whistle");
  whistle.hidden = true;
  const whistleWho = el("span", "p-whistle-who", "");
  whistle.append(
    whistleWho,
    button("p-whistle-x", "✕", () => call(null), t("pond.03")),
  );

  const call = (keeper: string | null) => {
    calling = keeper;
    view.gather(keeper === null ? null : (d) => d.keeper === keeper);
    whistle.hidden = keeper === null;
    whistleWho.textContent = keeper === null ? "" : t("live.whistling", { keeper });

    /*
     * ══ THE FLOCK COMES TO YOU ══
     * `gather` rings the called ducks around the CAMERA, not around the
     * middle of the world — so whistling never needs to move the view, and
     * you are always already looking at what answered. The prototype
     * gathers at world centre and then flies the camera there, which is
     * the same intent by a longer route; this way nothing moves under you.
     *
     * Clearing IS the way home though: back to the middle at the pond's
     * own zoom. It is the only undo for a zoom and a pan, so somebody who
     * has wandered into a corner is never stranded there.
     */
    if (keeper === null) view.home();

    syncCount();
    sheet.hidden = true;
    scrim.remove();
  };

  /*
   * ══ WHISTLE FOR ══
   * One row per thing you can call, each with how many ducks answer to it,
   * ordered by how many — the biggest circle first, because that is the one
   * most likely to be wanted and the one that best explains what the list
   * is for.
   *
   * "Everyone" is always first and is never absent: a filter list whose
   * only rows are filters gives you no way back to the whole pond.
   */
  const openGather = () => {
    sheet.replaceChildren();
    sheet.append(el("p", "p-field-label", t("pond.04")));

    const byKeeper = new Map<string, number>();
    for (const d of ducks) {
      if (d.keeper) byKeeper.set(d.keeper, (byKeeper.get(d.keeper) ?? 0) + 1);
    }

    const rows: { key: string | null; label: string; count: number }[] = [
      { key: null, label: t("live.everyone"), count: ducks.length },
      ...[...byKeeper.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ key: k, label: t("live.whistling", { keeper: k }), count: n })),
    ];

    const list = el("div", "p-glist");
    for (const row of rows) {
      const b = button("p-grow", "", () => call(row.key));
      b.append(row.label, el("i", "p-grow-n", String(row.count)));
      // Pressed, not just coloured: this is the one control that reports
      // which of several states the pond is in.
      b.setAttribute("aria-pressed", String(calling === row.key));
      b.classList.toggle("on", calling === row.key);
      list.append(b);
    }
    sheet.append(list);

    // Only a keeper's own ducks can be whistled for. An unclaimed card has
    // no name to call, so it is simply part of the pond.
    if (byKeeper.size === 0) sheet.append(el("p", "p-note", t("live.nokeepers")));

    sheet.hidden = false;
    root.append(scrim);
  };

  const scrim = el("div", "p-scrim");
  scrim.addEventListener("click", () => {
    sheet.hidden = true;
    scrim.remove();
  });

  count.addEventListener("click", openGather);

  root.append(whistle, sheet);

  /**
   * ══ THE ARRIVAL IS THE MOMENT THE WHOLE THING EXISTS FOR ══
   *
   * The prototype's sequence, and every beat of it is deliberate:
   *
   *   1. START WIDE. The fall and the fortune's effect need room — a 大吉
   *      firework cropped to a close-up is not a firework.
   *   2. DROP IT WHERE IT SHOULD APPEAR: a little above centre of the
   *      VISIBLE frame, so the sheet that rises later never covers it.
   *      Expressed as a fraction of what can be seen, because the world is
   *      far bigger than the window.
   *   3. Once the effect has READ — 850ms for 大吉, which is the loudest,
   *      700 for the rest — close in on the duck. This is the moment the
   *      card exists for, and a duck you have to look for is not a moment.
   *   4. The sheet waits for all of that. Showing it immediately would put
   *      chrome on top of the one thing this whole flow is for.
   *
   * What this replaced was a sheet containing a PICTURE of a duck, shown
   * instantly. Everything above was already built and none of it ran.
   */
  function playArrival(
    fortune: number,
    tint: number,
    sheet: HTMLElement,
    onSheet: () => void,
  ): () => void {
    const id = "arrival-preview";
    // Wide, and at the pond's own framing rather than wherever the camera
    // was left. There is nothing to look at yet but the water it will hit.
    view.camera.snap({ cell: HOME_CELL });
    const at = view.frameAt(0.5, ARRIVAL_DROP_Y);
    const duck = view.addLocal({
      id, slug: id, fortune, tint, stickers: [], paint: "", name: "", message: "",
      created: Date.now(), bumps: 0, rescues: 0, fire: null, say: null, keeper: null,
      mine: true,
      // This screen closes in on it itself, on its own schedule.
      selfDirected: true,
    }, at);
    view.arrive(duck);

    const timers = [
      /*
       * Close in, once the effect has said its piece — and centre it in the
       * water the sheet is ABOUT to leave, not in the whole screen. The
       * sheet is laid out already precisely so it can be measured here.
       */
      window.setTimeout(
        () => {
          const covered = sheet.getBoundingClientRect().height;
          view.focusClear(id, closeCell(covered), covered, ARRIVAL_CLOSE_MS);
        },
        fortune === 0 ? ARRIVAL_CLOSE_GREAT_MS : ARRIVAL_CLOSE_WAIT_MS,
      ),
      // And only then the sheet.
      window.setTimeout(
        onSheet,
        prefersReducedMotion() ? ARRIVAL_SHEET_REDUCED_MS
          : fortune === 0 ? ARRIVAL_SHEET_GREAT_MS : ARRIVAL_SHEET_MS,
      ),
    ];

    return () => {
      timers.forEach(clearTimeout);
      view.removeLocal(id);
    };
  }

  /**
   * The closest rung that still leaves the duck room to be looked at.
   *
   * The block is the duck plus the tag above it — 30 sprite cells, not 24 —
   * because the tag is what a person is reading as much as the duck.
   */
  function closeCell(coveredCss: number): number {
    const water = Math.max(0, view.stageHeight() - coveredCss);
    const BLOCK_CELLS = GRID + -TAG.Y;
    for (const cell of [ARRIVAL_CLOSE_CELL, 6, 4, 3, 2]) {
      if (cell < ARRIVAL_MIN_CELL) break;
      if (BLOCK_CELLS * cell <= water * ARRIVAL_BLOCK_SHARE) return cell;
    }
    return ARRIVAL_MIN_CELL;
  }

  /**
   * Watch your own duck come down.
   *
   * ══ THE ONE ANIMATION THAT MUST NOT BE MISSED ══
   * The duck enters with its fortune's own arrival — FLOW.md § 06 — and
   * the camera goes to meet it. This is the moment the whole flow is for.
   *
   * It used to be one refresh and `if (duck) arrive(duck)`, which silently
   * did nothing whenever the duck was not in that first response. The
   * server writes it and the poll reads it back over two round trips, so
   * losing that race costs the person the only time they will ever see
   * their own duck arrive — and it fails SILENTLY, which is why it went
   * unnoticed until somebody said "I don't see any arrival animation".
   *
   * So it asks again. A few short retries cover a slow write far better
   * than one attempt, and if the pond still has not heard of it, the
   * camera at least goes to where it will be — rather than the flow
   * ending on nothing at all.
   */
  async function arriveWhenItLands(id: string): Promise<void> {
    for (let attempt = 0; attempt < ARRIVAL_TRIES; attempt++) {
      await refresh();
      const duck = view.find(id);
      if (duck) {
        /*
         * ══ FRAME IT, THEN DROP IT ══
         * The camera used to GLIDE to the duck while the duck was falling,
         * so two things moved at once and neither could be watched: you
         * cannot follow something coming down while the ground slides
         * underneath it. Reported as exactly that — "it feels weird".
         *
         * The prototype settled this and wrote down why: frame the landing
         * spot before the duck falls, with no camera animation at all, and
         * let it fall into an already-close view. The drop IS the motion;
         * the camera does not need to be.
         *
         * A snap rather than a glide is free here: the keep screen is
         * closing over the water in the same instant, so there is nothing
         * on screen to jump.
         */
        view.camera.snap({ x: duck.wx, y: duck.wy });
        view.arrive(duck);
        return;
      }
      await new Promise((r) => setTimeout(r, ARRIVAL_RETRY_MS));
    }
    // It is in the pond somewhere; the next poll will place it.
    console.warn("[pond] released duck has not appeared yet:", id);
  }

  const refresh = async (): Promise<void> => {
    try {
      const res = await api.pond();
      ducks = res.ducks;
      view.setDucks(ducks);
      syncSays(ducks);
      syncCount();
    } catch (err) {
      count.textContent =
        err instanceof ApiError && err.status === 0 ? t("live.offline") : t("live.error");
    }
  };
  await refresh();

  // ── what this visitor can do ──────────────────────────────────────────
  //
  // Re-checked rather than remembered: the CTA is built once, and after a
  // duck is released the session is spent — so leaving it on screen offers
  // a second fortune that the server will refuse. `syncCta` runs again when
  // the flow hands back.
  /*
   * ══ READ THE KEY, DO NOT REMEMBER IT ══
   * This was captured once when the pond screen was built. But the private
   * link is written DURING this screen's lifetime — the release flow saves
   * it and then asks the bar to rebuild — so the one person guaranteed to
   * have just got a duck was the one shown the bar for having none.
   */
  const hasDuck = (): string | null => recallEditKey();

  async function syncCta(): Promise<void> {
    cta.replaceChildren();
    const session = await api.session().catch(() => ({ active: false }) as SessionState);
    buildCta(session);
  }

  function buildCta(session: SessionState): void {
    // Only the two-glyph state is a row; every other state is a wide button.
    cta.classList.remove("p-cta-glyphs");
    const mine = hasDuck();
    if (session.active && !session.spent) {
    // A fortune is waiting. This is the only CTA that ever appears, and it
    // is the whole reason the pond can be the default screen: someone with
    // nothing to make sees a pond, not a form.
    /*
     * ══ THE BAR SAYS WHERE YOU ARE IN THE FLOW ══
     * The prototype's pond CTA has three states and this had one. It said
     * "Decorate it" whether you had never started or were three screens
     * deep with a half-decorated duck saved — so the button that resumed
     * your work was worded as though it would begin it.
     *
     * COPY.md code.02 / code.06. The one adaptation: the prototype reaches
     * the pond AFTER the arrival, so its CTA is always a resume. Here the
     * pond is the default screen, so a session with no draft is genuinely
     * a start and says so.
     */
    const resuming = loadDraft() !== null;
    const go = el(
      "button",
      "p-btn p-btn-quiet",
      resuming ? t("code.02") : t("arrival.04"),
    );
    go.type = "button";
    go.addEventListener("click", () => {
      // The pollers stop; the WATER DOES NOT. A pond that freezes the
      // moment you start decorating stops being a place you are making
      // something for.
      pausePolling();
      /*
       * ══ NOBODY IS BEING WHISTLED FOR DURING AN ARRIVAL ══
       * A filter left up from before treats the arrival's preview duck as
       * uncalled — it has no keeper, because it does not exist yet — and
       * shoves it out of frame while it is still falling. The whistle
       * belongs to browsing the pond, and this is not that.
       */
      call(null);
      releaseFlow({
        root: overlay,
        fortune: session.fortune ?? 1,
        playArrival,
        // The keeper of the card that was TAPPED — from the session, which
        // knows the card. It used to be inferred from the ducks on screen,
        // which quietly stopped working the moment the pond held ducks from
        // two different keepers: the inference gave up and returned null, so
        // the option to share with a keeper never appeared at all.
        keeper: session.keeper ?? null,
        onBrowse: () => {
          overlay.replaceChildren();
          resumePolling();
          void syncCta();
        },
        /*
         * The duck is in. It goes into the water NOW, behind the card that
         * says so — the card covers the bottom and the water above it is
         * clear, so the whole arrival is watched while somebody is reading
         * their private link.
         *
         * Polling stays paused: a refresh mid-arrival is the one thing
         * that can replace a duck in mid-air, and there is nothing to poll
         * for while a card is up anyway.
         */
        onReleased: (made) => { void arriveWhenItLands(made.id); },
        onDone: () => {
          // Nothing to trigger. The duck went in a moment ago; this is
          // just getting the card out of the way.
          overlay.replaceChildren();
          resumePolling();
          void syncCta();
        },
      });
    });
      cta.append(go);
      return;
    }

    /*
     * No fortune waiting, and no duck of your own: the card is the only way
     * to get one, and saying so is kinder than an empty bar that leaves
     * somebody wondering what the pond wants from them.
     */
    if (!mine) {
      const hint = el("button", "p-btn p-btn-quiet", t("code.06"));
      hint.type = "button";
      hint.disabled = true;
      cta.append(hint);
      return;
    }

    /*
     * ══ ONCE YOUR DUCK IS IN, THE BAR GETS OUT OF THE WAY ══
     * There is nothing you still owe it — the pond IS the destination —
     * so the wide button goes and leaves two quiet glyphs: say something,
     * and your duck's settings. A CTA here would be asking for an action
     * that does not exist.
     *
     * This used to append a "Back to the pond" button while the comment
     * beside it said the CTA hides entirely. The comment was right.
     */
    cta.classList.add("p-cta-glyphs");
    cta.append(sayButton(), settingsButton());
  }

  /** Say something. Sixty characters, forty-five seconds, once per ten minutes. */
  function sayButton(): HTMLElement {
    const b = button("p-glyph", "", () => openSay(), t("say.01"));
    b.append(icon("chat", 22));
    return b;
  }

  function settingsButton(): HTMLElement {
    const b = button("p-glyph", "", () => {
      pausePolling();
      mineScreen({
        root: overlay,
        // Read again rather than closed over: this button can outlive the
        // bar that made it by a whole screen.
        editKey: hasDuck()!,
        onPond: () => {
          overlay.replaceChildren();
          resumePolling();
          void syncCta();
        },
      });
    }, t("say.09"));
    b.append(icon("gear", 22));
    return b;
  }

  /**
   * The say sheet.
   *
   * The cooldown is stated by the server, not guessed at here: a client
   * that counts down its own ten minutes disagrees with the server the
   * moment a tab sleeps, and then refuses something that would have been
   * allowed. So the field is always open, and a refusal comes back with
   * the real number of minutes left.
   */
  function openSay(): void {
    const { root: sheetRoot, body: wrap } = makeSheet();
    const close = () => overlay.replaceChildren();
    // Heading then body, like every other sheet. It was an eyebrow, which
    // is a kicker ABOVE a heading — so this sheet had a kicker and no
    // heading at all.
    wrap.append(
      el("h2", "p-title", t("say.02")),
      el("p", "p-body", t("say.03")),
    );

    const note = el("p", "p-note", "");
    note.hidden = true;
    const input = field({
      label: "", placeholder: t("say.04"), max: SAY_MAX_CHARS,
    });
    // The heading already names the field; a label under it would be the
    // same words twice.
    input.wrap.querySelector(".p-field-label")?.remove();

    const send = button("p-btn", t("say.05"), () => {
      const text = input.input.value.trim();
      if (!text) return;
      send.disabled = true;
      void api.say(hasDuck()!, text).then(
        () => {
          close();
          void refresh();
        },
        (err: unknown) => {
          send.disabled = false;
          note.hidden = false;
          /*
           * A refusal is not a failure. The cooldown is the DESIGN — it is
           * what keeps the pond ambient rather than a chat room — so it
           * says when, not just no. `retryAfter` comes off the error
           * because `request` throws on any non-2xx and carries it there.
           */
          const cooling = err instanceof ApiError && err.status === 429;
          note.textContent = cooling
            ? t("say.07", {
                minutes: String(Math.max(1, Math.ceil(err.retryAfter / 60))),
              })
            : t("say.08");
        },
      );
    });

    const actions = el("div", "p-actions");
    actions.append(send, button("p-btn p-btn-quiet", t("say.06"), close));
    wrap.append(input.wrap, note, actions);
    overlay.replaceChildren(sheetRoot);
    input.input.focus();
  }

  await syncCta();


  // Arrival zoom: land at arm's length from your own duck rather than
  // somewhere out there.
  if (bootstrap.duck) view.lookAt(bootstrap.duck.id, true);

  // Polling pauses while a sheet is open — there is nothing on screen for
  // a refresh to update, and a duck arriving mid-decoration would move the
  // water under the sheet for no reason.
  let polling = true;
  function pausePolling(): void {
    polling = false;
  }
  function resumePolling(): void {
    polling = true;
    void refresh();
  }
  const poll = window.setInterval(() => {
    if (polling) void refresh();
  }, 20_000);

  teardown = () => {
    clearInterval(zoomPoll);
    clearInterval(poll);
    window.removeEventListener("resize", fit);
    view.stop();
    teardown = null;
  };
}

/**
 * A duck's card.
 *
 * Deliberately not a route: the camera glides to the duck and the card
 * opens over the water, so closing it puts you back where you were.
 */
/**
 * "12 JUL" — the day it went in, not how long ago.
 *
 * The prototype dates the duck rather than ageing it, and it is the better
 * answer: "in the pond for six days" is a number that changes every time
 * you look, and nobody is counting. A date is a fact about the duck.
 *
 * Built from the parts rather than toLocaleDateString, which would put a
 * comma and a year in some locales and none in others.
 */
/**
 * How long the card stays up after a bump lands, so the new number can be
 * read before the pond takes the screen back.
 *
 * Long enough to notice a digit change and a tick; short enough that it
 * never feels like waiting. The crossing starts when this ends.
 */
const BUMP_READ_MS = 520;

/**
 * How hard the pond tries to find your duck before giving up on showing it
 * arrive. Three goes over about a second — long enough to cover a slow
 * write, short enough that nobody is left staring at water.
 */
const ARRIVAL_TRIES = 3;
const ARRIVAL_RETRY_MS = 400;

/*
 * The arrival's own clock. All of these are the prototype's, and they are
 * an order rather than a set of independent knobs: the duck lands, its
 * effect reads, the camera closes in, the sheet arrives. Shortening any one
 * of them puts the next beat on top of the one before it.
 */
/** A little above centre, so the sheet never covers where it lands. */
const ARRIVAL_DROP_Y = 0.34;
/** How long the fortune's effect gets before the camera moves. */
const ARRIVAL_CLOSE_WAIT_MS = 700;
/** 大吉 is the loudest arrival; cutting it short throws the moment away. */
const ARRIVAL_CLOSE_GREAT_MS = 850;
/**
 * Close enough to look at rather than to locate — as a PROPORTION.
 *
 * The prototype closes to a fixed cell 8, which is right on the phone it
 * was drawn for. On a short screen it is not: the sheet takes 275px
 * whatever the screen is, so a 568-tall phone has 293px of water left, and
 * a duck-plus-tag at cell 8 is 120 of it. That is not "closed in on the
 * duck", it is the duck wearing the screen.
 *
 * So the rung is chosen from the water actually available. 8 stays the
 * ceiling — it is as close as the pond ever goes — and 6 the floor, so it
 * is always nearer than the framing you arrived from.
 */
const ARRIVAL_CLOSE_CELL = 8;
const ARRIVAL_MIN_CELL = 6;
/** How much of the visible water the duck and its tag may take. */
const ARRIVAL_BLOCK_SHARE = 0.4;
/** Where the duck sits once the camera arrives, down the visible frame. */
const ARRIVAL_DUCK_Y = 0.3;
const ARRIVAL_CLOSE_MS = 900;
/** When the sheet rises. After the landing AND after the effect reads. */
const ARRIVAL_SHEET_MS = 1100;
const ARRIVAL_SHEET_GREAT_MS = 1500;
/** With motion reduced there is no effect to wait for, only the fact. */
const ARRIVAL_SHEET_REDUCED_MS = 340;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shortDate(created: number): string {
  const d = new Date(created * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function openDuckCard(view: PondView, duck: Placed): void {
  view.splash(duck.wx, duck.wy);
  document.querySelector(".p-card")?.remove();

  /*
   * A scrim behind the card. The pond keeps moving — it is not paused —
   * but it stops competing with the thing you just asked to read, and a
   * tap on the water is a way out that needs no aim.
   */
  const scrim = el("div", "p-scrim");
  const panel = el("div", "p-card");
  /*
   * The panel is transparent and only its BODY is opaque, so the dithered
   * edge has water behind it to dissolve into. Everything below appends to
   * `card`, which is that body.
   */
  const card = el("div", "p-card-body");
  const dismiss = () => {
    panel.remove();
    scrim.remove();
  };
  scrim.addEventListener("click", dismiss);

  /*
   * ══ THE HEAD IS THE DUCK, THEN WHO IT IS ══
   * Two columns, exactly as the prototype: the animal at 72px in a tinted
   * box on the left, and on the right its fortune as a pill, its name in
   * the serif, and its provenance in mono. The card opened with a bare
   * name and no picture, so a panel about one specific duck showed nothing
   * you had just tapped.
   */
  const THUMB_CSS = 72;
  const thumb = el("canvas", "p-card-duck");
  thumb.width = THUMB_CSS * 2;
  thumb.height = THUMB_CSS * 2;
  const tctx = thumb.getContext("2d");
  if (tctx) {
    tctx.imageSmoothingEnabled = false;
    // 24-cell sprite into 144 device px: 6 px a cell, which stays integral.
    drawDuck(tctx, duck, 0, 0, (THUMB_CSS * 2) / 24);
  }

  const fortune = FORTUNES[duck.fortune] ?? FORTUNES[1]!;
  const pill = el("p", "p-card-fortune");
  pill.append(
    el("b", "", fortune.jp),
    el("i", "", "·"),
    el("span", "", fortune.en),
  );

  const provenance = [
    duck.keeper ? t("live.via", { keeper: duck.keeper }) : "",
    shortDate(duck.created),
  ].filter(Boolean);

  const headText = el("div", "p-card-headtext");
  headText.append(pill, el("h2", "p-card-name", duck.name || fortune.jp));
  if (provenance.length) headText.append(el("p", "p-card-via", provenance.join(" · ")));

  const head = el("div", "p-card-head");
  head.append(thumb, headText);
  card.append(head);

  if (duck.message) card.append(el("p", "p-card-msg", duck.message));

  const stats = el("p", "p-card-stats");
  const showStats = (bumps: number) => {
    stats.textContent =
      bumps === 0 ? t("live.bumps.none")
      : bumps === 1 ? t("live.bumps.one")
      : t("live.bumps", { n: String(bumps) });
  };
  showStats(duck.bumps);
  card.append(stats);

  /*
   * ══ MOST BUMPS FROM ══
   * A number is a score; a row of ducks is a relationship. This is the one
   * place the pond shows that the same person came back, so it is worth a
   * request of its own rather than being folded into the pond payload.
   *
   * Appended only if there are any, and only after it arrives — an empty
   * heading over nothing is worse than no heading.
   */
  const bumpers = el("div", "p-bumpers");
  bumpers.hidden = true;
  card.append(bumpers);
  void api.bumpers(duck.id).then(
    (res) => {
      if (!res.bumpers.length || !panel.isConnected) return;
      bumpers.append(el("p", "p-field-label", t("pond.28")));
      const row = el("div", "p-bumprow");
      for (const b of res.bumpers) {
        const box = el("div", "p-bumper");
        box.title = b.name || b.slug;
        const cv = el("canvas", "");
        // 32 CSS pixels inside a 44px control, at a whole 2x per sprite
        // pixel with a little headroom — a fractional cell resamples the
        // art, which is the one thing this pond never does.
        cv.width = GRID * 2;
        cv.height = GRID * 2;
        const c = cv.getContext("2d");
        if (c) {
          c.imageSmoothingEnabled = false;
          drawDuck(c, b, 0, 0, 2);
        }
        box.append(cv, el("i", "p-bumper-n", String(b.count)));
        row.append(box);
      }
      bumpers.append(row);
      bumpers.hidden = false;
    },
    // A card that opens without this row is still a card.
    () => {},
  );

  const actions = el("div", "p-actions");

  /**
   * Bump.
   *
   * A bump is a thing one duck does to another, so it needs a duck of your
   * own — "Make a duck to bump" is the shape of the feature, not a nag. The
   * server refuses an unauthenticated sender, which is what stops anyone
   * spending a stranger's ten unreturned bumps for them.
   */
  const mine = recallEditKey();
  if (mine && mine !== duck.id) {
    const bump = button("p-btn", t("pond.38").split(" ·")[0]!, () => {
      bump.disabled = true;
      void api.bump(mine, duck.id).then(
        (res) => {
          /*
           * ══ THE NUMBER FIRST, THEN THE CROSSING ══
           * Your duck swims over and knocks theirs — that is the whole
           * reason this is called a bump: a counter going up is a like,
           * and two ducks touching is a bump.
           *
           * But the card used to close on the same tick the count changed,
           * so the number went up and vanished in the same frame. Reported
           * as the counter not working at all, which is exactly what it
           * looked like.
           *
           * So: show the new count and the tick, hold long enough to read
           * them, and only then get out of the way — and start the
           * crossing AFTER the card has gone, so the whole journey is
           * watched rather than half of it happening behind a panel.
           */
          showStats(res.bumps);
          bump.textContent = "✓";
          window.setTimeout(() => {
            if (!panel.isConnected) return;
            dismiss();
            // A bumper that is not in the pond right now cannot swim: the
            // splash says the bump landed anyway.
            if (!view.bumpDuck(res.from, duck.id)) view.splash(duck.wx, duck.wy);
          }, BUMP_READ_MS);
        },
        (err: unknown) => {
          // 409 is the ten-unreturned cap, which is a real answer rather
          // than a failure: bump them back to free a slot.
          bump.textContent =
            err instanceof ApiError && err.status === 409 ? t("live.capped") : t("live.error");
        },
      );
    });
    actions.append(bump);
  } else if (!mine) {
    // Not a nag: a bump is a thing one duck does to another, so it needs a
    // duck. Shown as a spent button rather than a sentence, which is what
    // the prototype does and what makes the shape of it obvious.
    const needsDuck = button("p-card-btn", t("code.03"), () => {});
    needsDuck.disabled = true;
    actions.append(needsDuck);
  }

  actions.append(button("p-card-btn p-card-btn-danger", t("pond.39"), () => reportSheet(card, duck)));
  card.append(actions);

  // A corner ✕ as well as the foot button. Closing a card you opened by
  // accident should not need a journey to the bottom of it.
  const close = button("p-card-x", "✕", dismiss, t("pond.23"));
  card.append(close);

  panel.append(ditherEdge(), card);
  root.append(scrim, panel);

  /*
   * Move the camera only once the card is in the DOM and has a height —
   * the duck is centred in the water the card LEAVES, and that space
   * cannot be known before the card exists.
   */
  view.lookAtAbove(duck.id, window.innerHeight - panel.getBoundingClientRect().top);
}

/**
 * The report sheet.
 *
 * A reason is required and a note is optional, because a bare report tells
 * whoever reads the queue nothing they can act on — "Rude or abusive" and
 * "Private details" need different responses, and the second needs one
 * quickly. Reporting twice is the same report and says so.
 */
function reportSheet(card: HTMLElement, duck: Placed): void {
  card.replaceChildren();
  card.append(el("p", "p-card-name", t("pond.29")));

  let reason: ReportReason | null = null;
  const note = field({ label: t("pond.34"), placeholder: t("pond.35"), max: 200 });

  const reasons = el("div", "p-actions");
  const options: [ReportReason, string][] = [
    ["rude", t("pond.30")], ["private", t("pond.31")],
    ["spam", t("pond.32")], ["other", t("pond.33")],
  ];
  const buttons = options.map(([value, label]) =>
    button("p-chip", label, () => {
      reason = value;
      buttons.forEach((b, i) => b.classList.toggle("on", options[i]![0] === value));
      send.disabled = false;
    }),
  );
  buttons.forEach((b) => reasons.append(b));

  const send = button("p-btn", t("pond.36"), () => {
    if (!reason) return;
    send.disabled = true;
    void api.report(duck.id, reason, note.input.value).then(
      () => {
        card.replaceChildren(el("p", "p-card-name", t("code.05")));
      },
      () => {
        card.replaceChildren(el("p", "p-card-name", t("live.error")));
      },
    );
  });
  send.disabled = true;

  const actions = el("div", "p-actions");
  actions.append(send, button("p-btn p-btn-quiet", t("pond.37"), () => card.remove()));
  card.append(reasons, note.wrap, actions);
}

async function main(): Promise<void> {
  const b = boot();
  setLang((document.documentElement.lang as Lang) || "en");

  // `/e/<key>` is the private link — the only credential a duck has, and
  // the whole reason coming back is worth doing.
  if (b.view === "edit" && b.editKey) {
    // The pond renders first, so the water is already there behind it.
    await pondScreen({});
    mineScreen({
      root: document.querySelector(".p-overlay")!,
      editKey: b.editKey,
      onPond: () => document.querySelector(".p-overlay")!.replaceChildren(),
    });
    return;
  }

  await pondScreen(b);

  /*
   * A card that arrived ARMED — four blows during the boot window — carries
   * a signed claim in its URL. Claimed here, on arrival, so the credential
   * spends as little time in the address bar as possible; Card setup then
   * opens over the water like every other screen.
   */
  const url = new URL(location.href);
  if (url.searchParams.has("t") && (await claimFromUrl(url))) {
    // Take the claim out of the URL: it is spent, and a shared or
    // bookmarked link should not carry a used credential around.
    history.replaceState(null, "", url.pathname);
    cardSetup({
      root: document.querySelector(".p-overlay")!,
      onDone: () => document.querySelector(".p-overlay")!.replaceChildren(),
    });
  }
}

void main();
