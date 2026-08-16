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
  ApiError, api, loadDraft, quietFor, recallEditKey, rememberEditKey, rememberQuiet,
  type ReportReason, type SessionState,
} from "./api.js";
import { button, ditherEdge, field, floater, sheet as makeSheet } from "./dom.js";
import { icon } from "./icons.js";
import { mineScreen } from "./mine.js";
import { FORTUNES } from "./sprites.js";
import { CAM_UI, CAM_ZOOM, HOME_CELL, easeOutCubic } from "./camera.js";
import {
  cardSetup, claimIsFresh, claimIsSpent, rememberClaimAttempt, resolveClaim,
} from "./keeper.js";
import type { ClaimResult } from "./keeper.js";
import { releaseFlow } from "./release-flow.js";
import { PondView, SPLASH_TAP, type Placed } from "./pond-view.js";
import { GRID } from "./codec.js";
import { bumpsToShow } from "./bumps.js";
import { TAG, drawDuck } from "./render.js";
import { prefersReducedMotion } from "./viewport.js";
import { fortuneTitle, setLang, t, type Lang } from "./strings.js";
import { watchSize } from "./viewport.js";
import type { PondDuck } from "./types.js";

/** What a pond screen hands back to whoever opened it. */
interface PondHandle {
  /** Start the release flow, if this tap has a fortune waiting. */
  startRelease(): void;
}

interface Bootstrap {
  view?: "pond" | "duck" | "edit";
  duck?: PondDuck;
  editKey?: string;
  missing?: string;
  /*
   * Set by the private-link route, not by the server. The pond payload is
   * public and cannot say which duck is yours; this is the key that can,
   * handed in so the pond can mark and frame it.
   */
  mine?: string;
  /*
   * Whether a tap with a live fortune should go straight into the flow.
   * False when a claim screen is about to open over the water — the
   * caller has resolved the tap and knows; the pond should not have to
   * guess from what happens to be in localStorage.
   */
  arrive?: boolean;
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

async function pondScreen(bootstrap: Bootstrap): Promise<PondHandle> {
  teardown?.();
  root.replaceChildren();

  const stage = el("div", "p-stage");
  const canvas = el("canvas", "p-canvas");
  stage.append(canvas);

  /*
   * ══ THE POND, FOR SOMEBODY WHO CANNOT SEE IT ══
   * Everything in the pond is painted into one canvas. To a screen reader
   * that is a single empty graphic, and to a keyboard it is nothing at
   * all: the ducks, their names, their fortunes, the fires and every card
   * behind them were unreachable without a pointer and working eyes. The
   * count in the corner said "14 ducks" and there was no way to meet one.
   *
   * So the ducks also exist as a list — one button each, off-screen but
   * focusable, saying whose duck it is and what fortune it drew. Pressing
   * one does exactly what tapping the duck does: the camera goes to it and
   * its card opens. Nothing is a special accessible copy of the product;
   * it is the same two calls the tap makes.
   *
   * The prototype had this from the start and it was the piece most worth
   * carrying over, because it is the only one nobody would notice missing.
   */
  const srList = el("ul", "p-sr");
  srList.setAttribute("aria-label", t("pond.13"));
  /*
   * `role="list"` on a list, which looks redundant and is not: Safari
   * drops list semantics from any `ul` whose `list-style` is `none`, and
   * this one's is. Without it VoiceOver announces thirteen loose buttons
   * instead of "list, 13 items" — losing the one piece of information
   * that tells somebody how much pond there is.
   */
  srList.setAttribute("role", "list");
  /*
   * And the water itself says nothing. Every duck in it is now in the
   * list above; leaving the canvas exposed as well would announce an
   * unlabelled graphic in the middle of the page that cannot be entered
   * or acted on — the accessibility equivalent of a locked door beside
   * the open one.
   */
  canvas.setAttribute("aria-hidden", "true");
  stage.append(srList);

  const hud = el("div", "p-hud");
  const count = el("button", "p-count");
  count.type = "button";
  count.setAttribute("aria-label", t("pond.13"));

  /*
   * The card's own mark, opposite the count. It is the only thing on the
   * water that leaves the pond, so it says where it goes before it is
   * tapped — pond.02 is the whole sentence, not a decoration.
   *
   * It reads "David's Pond" rather than the part number it started as.
   * BY-002 is what the card is called on a bill of materials; it is not
   * what the place is called, and the one piece of chrome floating on the
   * water should say whose pond somebody has wandered into.
   *
   * It goes to the portfolio rather than the lab: a stranger who taps the
   * only words on the water is asking who made this, and that is a person
   * before it is a part number.
   */
  const mark = el("a", "p-mark", t("pond.41"));
  mark.href = "https://www.davidyang.work";
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
   * ══ THE POND'S LIST BELONGS TO THE POND ══
   * The screen-reader duck list lives in the stage, and the stage stays in
   * the document when a flow screen opens over it. So on the studio, sign,
   * contact, keep and settings screens, a keyboard user tabbed through
   * every duck in the pond — invisible, underneath, thirteen of them, or a
   * hundred once the cards are out — before reaching the Next button in
   * front of them. Pressing one moved a camera they could not see.
   *
   * Measured on the studio: 13 of the first 18 tab stops.
   *
   * `hidden`, deliberately, and it is the same reasoning that ruled it out
   * for the list itself: it removes an element from the accessibility tree
   * AND the tab order. Wrong when the pond is the screen and the ducks
   * must be reachable; exactly right when the pond is not the screen and
   * they must not be.
   *
   * A MutationObserver rather than a line in each opener, for the reason
   * the orbit's teardown gives: a rule enforced in one place cannot be
   * forgotten by the next person to add a screen.
   */
  const gateSrList = (): void => {
    srList.hidden = overlay.children.length > 0;
  };
  new MutationObserver(gateSrList).observe(overlay, { childList: true });
  // And once now, so a page that arrives straight onto a flow screen —
  // a card tapped with a claim in the URL opens card setup — starts in
  // the right state rather than one mutation behind it.
  gateSrList();

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
      // A press is answered at once and settles — see easeOutCubic. The
      // considered glides (looking at a duck, the arrival) keep CAM_UI and
      // its ease-in-out.
      if (next !== null) {
        view.camera.glide({ cell: next }, CAM_ZOOM, performance.now(), easeOutCubic);
      }
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
  /*
   * ══ THE TEARDOWN WAS THROWN AWAY ══
   * `watchSize` returns one, and it was discarded — while the teardown
   * below removed a plain `resize` listener that had never been added.
   * So the ResizeObserver, the visualViewport listeners and the DPR
   * media query all outlived the pond screen, every one of them holding a
   * closure over a canvas that was gone. Two mistakes cancelling out into
   * something that looked tidy. Codex found it.
   */
  const unwatchSize = watchSize(canvas, fit);
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
    /*
     * ══ DEVICE PIXELS ARE NOT CSS PIXELS ══
     * `cell` is DEVICE pixels per sprite pixel, so `BLOCK_CELLS * cell` is
     * a device-pixel height — and it was being compared against `water`,
     * which `stageHeight` returns in CSS pixels. On any retina screen that
     * made the block read twice its real size, so every rung failed the
     * test and this fell through to the minimum almost always.
     *
     * Two things followed. The fortune arrival never closed in as far as
     * it was written to. And the landing after a release was framed at
     * whatever the pond was already at — which is HOME_CELL — so the
     * pull-back on Done had nothing to pull back FROM and read as broken.
     * Reported as exactly that: "the zoom out only after click done is not
     * working."
     *
     * `dpr()` is clamped to 2, so the conversion is the view's own, not
     * `window.devicePixelRatio`.
     */
    const blockCss = (BLOCK_CELLS * 1) / view.pxPerCss();
    for (const cell of [ARRIVAL_CLOSE_CELL, 6, 4, 3, 2]) {
      if (cell < ARRIVAL_MIN_CELL) break;
      if (blockCss * cell <= water * ARRIVAL_BLOCK_SHARE) return cell;
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
  /**
   * True once this pond screen has been torn down.
   *
   * ══ AN AWAIT IS A PLACE THE SCREEN CAN VANISH ══
   * The retry loop below awaits a fetch and then a timeout, up to several
   * times. Every one of those is a moment the person can leave — and the
   * loop had no way to find out. It would come back from a `refresh()`
   * that resolved after the view had stopped, snap the camera of a dead
   * PondView and start an arrival nobody would ever see, on a canvas
   * detached from the document.
   *
   * Found in review rather than on screen, because the symptom is a few
   * wasted frames and a fetch nobody reads: invisible until it is not.
   */
  let gone = false;

  /** How much of the screen a card in the overlay is covering, in CSS px. */
  function coveredCss(): number {
    const cover = overlay.querySelector<HTMLElement>(".p-screen, .p-view");
    if (!cover) return 0;
    return Math.max(0, window.innerHeight - cover.getBoundingClientRect().top);
  }

  async function arriveWhenItLands(id: string): Promise<void> {
    for (let attempt = 0; attempt < ARRIVAL_TRIES; attempt++) {
      await refresh();
      // Checked after every await, not just at the top: the screen can go
      // during the fetch as easily as during the wait.
      if (gone) return;
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
        /*
         * ══ FRAME THE CLEAR WATER, NOT THE SCREEN ══
         * `snap({x: duck.wx, y: duck.wy})` centred the duck on the SCREEN,
         * and the keep card covers the bottom half of the screen — so the
         * one moment the whole flow builds to happened on the card's top
         * edge, where it could barely be seen.
         *
         * `focusClear` already knew how to do this: it is what the fortune
         * arrival uses to close in on the water a sheet is about to leave.
         * It also accounts for the tag above a duck and picks the closest
         * zoom rung that still leaves room to look — both of which the
         * hand-rolled version here did not. Reusing it, rather than owning
         * a second copy of the same arithmetic, is the whole lesson of the
         * `?t=` bug two commits ago.
         *
         * Zero milliseconds, deliberately: frame the spot BEFORE the duck
         * falls. You cannot watch something come down while the ground
         * slides underneath it.
         */
        const covered = coveredCss();
        mineId = duck.id;
        duck.mine = true;
        /*
         * ══ THIS SCREEN FRAMES IT ITSELF ══
         * `dropIn` schedules a `lookAt` a beat after any duck lands, and
         * `lookAt` defaults to HOME_CELL — so it zoomed straight back out
         * and re-centred on the SCREEN, undoing the framing below and
         * putting the duck back on the card's edge. Measured: the camera
         * reached cell 8 and then glided to 4 over 1.1s while the keep
         * card was still up, which is why the pull-back on Done looked
         * like it did nothing. There was nothing left to pull back from.
         *
         * `selfDirected` is the flag that already exists to say "leave
         * this one alone, the screen has its own schedule" — the fortune
         * arrival sets it for the same reason. The released duck needs it
         * too, and not setting it was the whole bug.
         */
        duck.selfDirected = true;
        view.camera.snap({ x: duck.wx, y: duck.wy });
        view.focusClear(duck.id, closeCell(covered), covered, 0);
        view.arrive(duck);
        return;
      }
      await new Promise((r) => setTimeout(r, ARRIVAL_RETRY_MS));
      if (gone) return;
    }
    // It is in the pond somewhere; the next poll will place it.
    console.warn("[pond] released duck has not appeared yet:", id);
  }

  /**
   * What the list currently says, so it is only rebuilt when it is wrong.
   *
   * A poll lands every twenty seconds. Rebuilding blindly would replace
   * the button under somebody's finger four times a minute — and a
   * focused element that is removed drops focus to the document body,
   * which on this page means being thrown out of the pond and back to the
   * start of the tab order, silently, while reading.
   */
  let srSignature = "";

  const syncSr = (): void => {
    const signature = ducks.map((d) => `${d.id}:${d.name}:${d.fire ? 1 : 0}`).join("|");
    if (signature === srSignature) return;
    srSignature = signature;

    /*
     * Whose button had focus, and WHERE it was.
     *
     * The id alone is not enough. A duck can be taken out between polls,
     * and then there is no button to hand focus back to — so focus drops
     * to the document body, which means being thrown silently to the very
     * start of the tab order while reading. The position is the fallback:
     * if that particular duck is gone, focus lands where it was standing,
     * which is the same thing a list does when you delete a row.
     */
    const focused = document.activeElement;
    const wasIn = focused instanceof HTMLElement && srList.contains(focused);
    const keep = wasIn ? (focused as HTMLElement).dataset.duck : null;
    const keepAt = wasIn
      ? [...srList.querySelectorAll(".p-sr-btn")].indexOf(focused as HTMLElement)
      : -1;

    srList.replaceChildren();
    for (const duck of ducks) {
      const who = duck.name || t("live.sr.anon");
      // Boolean(), not a truthiness test on a field that is `undefined`
      // as often as `null` — that exact slip once set thirteen ducks on
      // fire at once.
      const label = Boolean(duck.fire)
        ? t("live.sr.burning", { name: who })
        : t("live.sr.duck", { name: who, fortune: fortuneTitle(duck.fortune) });
      const item = el("li", "");
      const open = button("p-sr-btn", label, () => {
        const placed = view.find(duck.id);
        if (!placed) return;
        view.lookAt(duck.id, true);
        openDuckCard(view, placed);
      });
      open.dataset.duck = duck.id;
      item.append(open);
      srList.append(item);
    }
    if (keep) {
      const again = srList.querySelector<HTMLElement>(`[data-duck="${CSS.escape(keep)}"]`);
      if (again) {
        again.focus();
      } else {
        // That duck has gone. Stay where it stood — clamped, since the
        // list is usually shorter now — and fall back to the pond's own
        // landmark if it emptied entirely.
        const left = [...srList.querySelectorAll<HTMLElement>(".p-sr-btn")];
        const at = left[Math.min(Math.max(keepAt, 0), left.length - 1)];
        (at ?? count).focus();
      }
    }
  };

  /*
   * Which duck in the water is this browser's, if any.
   *
   * Resolved once, from the private link, and then applied on every
   * refresh — `setDucks` replaces the list each poll, so a flag written
   * once would last exactly twenty seconds. The pond payload is public and
   * cannot say which duck is yours; only the key can, so it is asked once
   * and remembered here.
   */
  let mineId: string | null = null;

  const refresh = async (): Promise<void> => {
    try {
      const res = await api.pond();
      ducks = res.ducks;
      if (mineId) {
        // The tag over your own duck — drawTag already knows how to draw
        // it; nothing had ever told it which duck to draw it over.
        for (const d of ducks) if (d.id === mineId) d.mine = true;
      }
      view.setDucks(ducks);
      syncSays(ducks);
      syncCount();
      syncSr();
    } catch (err) {
      count.textContent =
        err instanceof ApiError && err.status === 0 ? t("live.offline") : t("live.error");
    }
  };
  await refresh();

  /*
   * Arriving by private link: find the duck it belongs to, mark it, and
   * put the camera on it. "Knowing which duck you are" is the thing the
   * link is for, and a pond that opens on the same view as everybody
   * else's does not say it.
   *
   * After the first refresh, so there is a pond to find it in, and
   * deliberately not awaited before the screen is usable — a slow lookup
   * should delay a camera move, not the water.
   */
  if (bootstrap.mine) {
    void api.mine(bootstrap.mine).then(
      (res) => {
        const id = typeof res.duck?.id === "string" ? res.duck.id : null;
        if (!id || gone) return;
        mineId = id;
        for (const d of ducks) if (d.id === id) d.mine = true;
        view.setDucks(ducks);
        const found = view.find(id);
        if (found) view.camera.snap({ x: found.wx, y: found.wy });
      },
      // A link that no longer resolves is a duck that was taken out. The
      // pond is still the right place to be standing.
      () => {},
    );
  }

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

  async function syncCta(): Promise<SessionState> {
    cta.replaceChildren();
    // The key goes with the question: `keeperOffer` cannot be answered for
    // somebody returning to a card later without knowing which duck is
    // theirs. Null when they have none, which is most people.
    const session = await api.session(hasDuck())
      .catch(() => ({ active: false }) as SessionState);
    buildCta(session);
    // Handed back so the caller can decide whether a tap goes straight to
    // the arrival, rather than asking the server the same question twice.
    return session;
  }

  /**
   * Start the release flow: arrival, studio, sign, contact, keep.
   *
   * Its own function because there are two ways in now. The bar is one.
   * The other is simply having tapped a card — see `pondScreen`'s tail.
   */
  /*
   * ══ ONE RELEASE AT A TIME ══
   * Two ways in now — the bar and a fresh tap — and the bar's button can
   * be double-activated (an impatient tap, a keyboard repeat). Either
   * would build a second flow over the same overlay and start a second set
   * of arrival timers on one duck. Cleared when the flow hands back, so a
   * person who browses away and returns can start again.
   */
  let releasing = false;

  function beginRelease(session: SessionState): void {
    if (releasing) return;
    releasing = true;
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
          releasing = false;
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
          /*
           * ══ THE PULL-BACK BELONGS TO "DONE" ══
           * The camera is close in on one duck behind a card. Widening
           * while the card is still up would zoom out from a landing
           * somebody is in the middle of watching; widening never would
           * leave them staring at one duck with no pond around it.
           *
           * So it happens here, on the tap that says they have finished
           * reading. `pullBackTo` rather than `home`, because home also
           * travels to the middle of the world — the duck would slide
           * away at the exact moment they were free to look at it.
           */
          releasing = false;
          overlay.replaceChildren();
          if (mineId) view.pullBackTo(mineId);
          resumePolling();
          void syncCta();
        },
      });
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
    /*
     * ══ AND THE OFFER, EVEN HERE ══
     * This branch used to `return` before the offer was ever considered,
     * so somebody coming back to an unclaimed card — a fresh tap, a duck
     * they already made — saw "Decorate it" and no way to keep the card.
     * The path existed on the server and nothing could reach it. Codex
     * traced it from the client wrapper inward.
     *
     * Both are true at once and both belong on screen: there is a fortune
     * waiting, AND this card is going spare.
     */
    const resuming = loadDraft() !== null;
    const go = el(
      "button",
      "p-btn p-btn-quiet",
      resuming ? t("code.02") : t("arrival.04"),
    );
    go.type = "button";
    go.addEventListener("click", () => beginRelease(session));
    cta.append(go);
    if (session.keeperOffer && !offerDismissed()) cta.append(keeperGlyph());
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

    /*
     * ══ AN INVITATION NEEDS WORDS — AND THE SHEET IS WHERE THEY GO ══
     * The first version was a wide labelled row above the glyphs, on the
     * argument that a glyph cannot explain an action nobody has heard of.
     * Seen on a phone it was wrong in two ways at once: it dominated a bar
     * whose whole job is to get out of the way, and its dismiss sat in the
     * row as a third control competing with the two that matter.
     *
     * The words were never the problem — their PLACE was. They belong in
     * the sheet, which is where somebody who taps has actually stopped to
     * read. So the bar gets a third glyph the same size as the other two,
     * and the explanation, the decision and the way to decline all live
     * one tap in.
     *
     * That also fixes something worse than layout: the row CLAIMED the
     * card the moment it was pressed and explained afterwards. The sheet's
     * primary claims now, after the reading — and "no thanks" has an
     * honest place to be, which it could not have once the card was
     * already taken.
     */
    if (session.keeperOffer && !offerDismissed()) cta.append(keeperGlyph());
  }

  /*
   * ══ DISMISSED FOR THIS CARD, NOT FOR EVER ══
   * One global flag meant shrugging at a friend's card in a bar silenced
   * the offer on every card this browser ever meets afterwards — including
   * a card of your own. Codex found it.
   *
   * Keyed on the duck instead. The offer only ever appears when you have a
   * duck FROM the card being offered, so the duck identifies the card
   * without the client ever learning the serial — which it must not, since
   * the serial is half of what a claim is keyed on and the server
   * deliberately never sends it.
   */
  const OFFER_KEY = "pond.keeper.offer.dismissed";
  const offerKeyFor = (): string => `${OFFER_KEY}.${hasDuck() ?? "none"}`;
  const offerDismissed = (): boolean => {
    try {
      return localStorage.getItem(offerKeyFor()) === "1";
    } catch {
      // Private mode, or storage turned off. Showing the offer is the
      // safer failure: it can be dismissed again, and never seeing it is
      // the thing this whole feature exists to fix.
      return false;
    }
  };

  function keeperGlyph(): HTMLElement {
    const b = button("p-glyph", "", () => {
      pausePolling();
      // Read now, not closed over: this button outlives the bar that made it.
      const key = hasDuck() ?? undefined;
      void myDuckName(key).then((suggestName) => {
        cardSetup({
          root: overlay,
          compact: true,
          offer: true,
          editKey: key,
          suggestName,
          /*
           * Mapped from the status, not from a boolean. 409 is the only
           * one that means somebody else has it; 401 means this tap's
           * session has expired, which is a different sentence and a
           * different thing to do about it.
           */
          onClaim: () => api.claimFirst(key).then(
            (r) => (r.ok ? "ok" as const : "kept" as const),
            (err: unknown) => {
              if (!(err instanceof ApiError)) return "error" as const;
              if (err.status === 409) return "kept" as const;
              if (err.status === 401) return "expired" as const;
              return "error" as const;
            },
          ),
          onDecline: () => {
            try {
              localStorage.setItem(offerKeyFor(), "1");
            } catch {
              // Offered again next time, which is a smaller problem than
              // never offering it at all.
            }
          },
          onDone: () => {
            overlay.replaceChildren();
            resumePolling();
            void syncCta();
          },
        });
      });
    }, t("keeper.19"));
    b.append(icon("card", 22));
    return b;
  }

  /**
   * What they signed their duck with, for the name field to start from.
   *
   * Asking somebody what to call them twice in two minutes is what makes
   * software feel like paperwork — and it is the same question both times.
   * Taken from the pond we already polled, so it costs no request.
   */
  async function myDuckName(key?: string): Promise<string | undefined> {
    if (!key) return undefined;
    try {
      const { duck } = await api.mine(key);
      const name = typeof duck?.name === "string" ? duck.name.trim() : "";
      return name || undefined;
    } catch {
      /*
       * A prefill is a courtesy. Nothing here is worth blocking the sheet
       * for, and an empty name field is exactly what the screen looked
       * like before this existed.
       *
       * Asked of the server rather than read off the pond, because the
       * pond's duck list is the pond's — see the note on the screen-reader
       * list — and reaching into it for one string would be the first
       * thing to break the next time it is rearranged.
       */
      return undefined;
    }
  }

  /** Say something. Sixty characters, forty-five seconds, once per five minutes. */
  function sayButton(): HTMLElement {
    const b = button("p-glyph", "", () => openSay(), t("say.01"));

    /*
     * ══ THE WAIT IS SHOWN, NOT DISCOVERED ══
     * The cooldown used to be invisible until you had written a message,
     * tapped send, and been refused — so the only way to find out the pond
     * wanted you quiet was to be turned away after doing the work.
     *
     * The button carries it instead. While the duck is quiet the glyph is
     * replaced by the time remaining and the control is disabled; when it
     * runs out the glyph comes back and it is live again. Nothing is
     * hidden and nothing is wasted.
     *
     * The countdown is a CONVENIENCE, never the enforcement — that is one
     * atomic INSERT on the server. Clearing the browser's storage buys an
     * enabled button and a refusal a second later.
     */
    /*
     * The description the button points at while it is counting. Its own
     * element because `aria-describedby` needs an id to aim at, and it is
     * visually hidden because the digits beside it already say it.
     */
    const quiet = el("span", "p-sr-text");
    quiet.id = `say-quiet-${Math.random().toString(36).slice(2, 8)}`;

    const tick = (): void => {
      const left = quietFor();
      b.disabled = left > 0;
      b.classList.toggle("p-glyph-quiet", left > 0);
      if (left > 0) {
        // m:ss, because "273 seconds" is a number and "4:33" is a wait.
        const mm = Math.floor(left / 60);
        const ss = String(left % 60).padStart(2, "0");
        /*
         * ══ THE NAME STAYS PUT; THE TIME IS A DESCRIPTION ══
         * This rewrote the button's accessible NAME every second, which
         * makes the control appear to become a different control once a
         * second — some screen readers re-announce it continuously, and a
         * name that changes under you is the one thing a name must not do.
         *
         * The name is now constant. The countdown is a description, and
         * the digits themselves are hidden from the reader: they are the
         * same information as the description, and hearing "four colon
         * one two" between announcements helps nobody.
         */
        const count = el("span", "p-glyph-count", `${mm}:${ss}`);
        count.setAttribute("aria-hidden", "true");
        b.replaceChildren(count, quiet);
        quiet.textContent = t("live.say.wait", { time: `${mm}:${ss}` });
        b.setAttribute("aria-label", t("say.01"));
        b.setAttribute("aria-describedby", quiet.id);
      } else {
        b.replaceChildren(icon("chat", 22));
        b.setAttribute("aria-label", t("say.01"));
        b.removeAttribute("aria-describedby");
      }
    };
    tick();

    /*
     * Once a second while it is counting, and the interval stops itself
     * when the button leaves the document — the CTA is rebuilt on every
     * `syncCta`, and a timer per rebuild would pile up for the life of the
     * page. Same rule as the orbit's, for the same reason.
     */
    const timer = window.setInterval(() => {
      if (!b.isConnected) { window.clearInterval(timer); return; }
      tick();
    }, 1000);
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
    /*
     * Floats rather than rising. Sixty characters over a pond you are
     * still meant to be watching, and anchored to the top so the keyboard
     * slides up underneath it instead of shoving the whole screen. See
     * `floater`.
     */
    const { root: sheetRoot, body: wrap } = floater();
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
        (res) => {
          // The server said how long this duck stays quiet; the button
          // outside is about to start counting it down.
          if (typeof res.cooldown === "number") rememberQuiet(res.cooldown);
          close();
          void refresh();
          void syncCta();
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
          // Refused because it is still quiet: take the server's figure,
          // which is authoritative, and let the button show it.
          if (cooling && err.retryAfter > 0) {
            rememberQuiet(err.retryAfter);
            void syncCta();
          }
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

  const session = await syncCta();


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

  /*
   * Placed after the pollers rather than beside `syncCta`, where it reads
   * more naturally: `beginRelease` pauses polling, and `polling` is a
   * `let` declared below. Calling it earlier threw "Cannot access
   * 'polling' before initialization" on the one path that matters most —
   * the first tap of a real card — and threw it silently, into the
   * console, behind a pond that looked fine.
   */
  /*
   * ══ A TAP LANDS ON THE FORTUNE, NOT ON A BUTTON TO SEE IT ══
   * The card has just spent several seconds revealing a fortune in LEDs.
   * Landing on the pond with "Decorate it" in the bar puts a decision in
   * the middle of that moment and asks somebody to opt in to the thing
   * they already did — the reveal happens twice, once in your hand and
   * once behind a button.
   *
   * The prototype had this right and this file has admitted it all along,
   * a few hundred lines up: "the prototype reaches the pond AFTER the
   * arrival, so its CTA is always a resume. Here the pond is the default
   * screen." The pond is where you end up once your duck is in, which is
   * exactly where `onDone` already leaves you.
   *
   * Three conditions, and all three are the point:
   *
   *   a fresh `?d=`  — the signal for "a card was just tapped", as
   *                    opposed to a reload, a bookmark, or somebody who
   *                    walked here. It is dropped from the URL below so
   *                    the second look at the same page is a pond.
   *   not a claim    — an ARMED card is going to Card setup instead.
   *
   *                    This has been wrong twice, in the same direction.
   *                    First it tested for `?t=`, which every tag carries
   *                    armed or not, so it was always true and the
   *                    arrival never played on real hardware at all.
   *                    Then it tested `isClaimUrl`, which is a counter
   *                    above zero — and an armed tag STAYS armed: `&g=`
   *                    is written once and never cleared, so a card that
   *                    has ever been blown on reads as claiming for the
   *                    rest of its life. David set his card up, and from
   *                    then on every tap landed on the pond with a
   *                    Decorate it button instead of on his fortune.
   *
   *                    Then it tested `claimIsFresh`, which is storage —
   *                    "has this browser tried this counter" — and storage
   *                    is a record of what happened, not a statement of
   *                    what this tap IS. It is also written a few lines
   *                    before it is read, which made the answer depend on
   *                    the order two things happened in.
   *
   *                    So the caller decides. It has already resolved the
   *                    tap by the time this runs and knows exactly which
   *                    of the four things it was; `arrive` is that answer,
   *                    said out loud, and the only remaining question here
   *                    is whether there is a fortune to arrive with.
   *   no draft       — somebody three screens deep with a half-decorated
   *                    duck is RESUMING. Throwing them back to the
   *                    fortune they already saw would lose their place,
   *                    so they get the pond and a bar that says "keep
   *                    decorating".
   */
  const tapped = new URL(location.href);
  if (
    tapped.searchParams.has("d") &&
    bootstrap.arrive !== false &&
    session?.active && !session.spent &&
    loadDraft() === null
  ) {
    // Spent. Taking it out means a reload is a pond rather than the same
    // fortune announced a second time.
    tapped.searchParams.delete("d");
    history.replaceState(null, "", tapped.pathname + tapped.search + tapped.hash);
    beginRelease(session);
  }

  teardown = () => {
    // Before anything is stopped, so a loop waking mid-teardown sees it.
    gone = true;
    clearInterval(zoomPoll);
    clearInterval(poll);
    unwatchSize();
    view.stop();
    teardown = null;
  };

  /*
   * ══ A DECLINED TAKEOVER STILL HAS A COIN IN IT ══
   * Somebody taps a card that is already somebody else's, says "leave it
   * as it is", and is left holding an unspent fortune with nothing
   * happening. The arrival was suppressed because a claim screen was
   * about to open; once they decline, this tap turns out to have been an
   * ordinary one after all.
   *
   * Handed back rather than triggered from outside, because starting the
   * flow needs the session this screen already fetched and the guards
   * that stop two flows opening over one duck.
   */
  return {
    startRelease(): void {
      if (session?.active && !session.spent && loadDraft() === null) {
        beginRelease(session);
      }
    },
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
  /*
   * ══ TAKE THE SCRIM WITH THE CARD ══
   * This removed the panel and left its scrim. For a long time that was
   * invisible, because every route in went through `dismiss()` first,
   * which removes the pair. Then two routes appeared that do not — the
   * screen-reader list, which can open a card while a card is open — and
   * each one stacked another half-opaque sheet over the water that nothing
   * would ever take away. Three of those and the pond is unreadable, with
   * no way back but a reload.
   *
   * A function that leaves something behind is a function you have to
   * remember to call in the right order, so it cleans up after itself
   * instead.
   */
  document.querySelector(".p-card")?.remove();
  document.querySelector(".p-scrim")?.remove();

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
      /*
       * ══ TWO VIEWS OF ONE FACT, FROM TWO SOURCES ══
       * The sentence above comes from `duck.bumps`, polled with the pond
       * every twenty seconds. This row comes from its own request, made
       * when the card opens. Between a bump and the next poll they
       * disagree, and the card said "nobody has bumped it yet" directly
       * above a row of four people who had.
       *
       * The row is the fresher and more specific answer — it names them —
       * so it corrects the sentence rather than sitting under it
       * contradicting it. Seen against the bench, where the two come from
       * different fixtures; the same window exists in production, just
       * narrower.
       */
      bumpers.append(el("p", "p-field-label", t("pond.28")));
      const row = el("div", "p-bumprow");
      for (const b of res.bumpers) {
        /*
         * ══ A FACE HERE IS A ROUTE TO A DUCK ══
         * These were `div`s with a `title`. A title is a tooltip on a
         * desktop, nothing at all on a phone, and invisible to a screen
         * reader — so the row said "here are the people who bumped this
         * duck" and then refused to take you to any of them, silently, by
         * not being a control.
         *
         * The prototype settled this and wrote down why: three routes
         * reach a duck card — tapping the water, the list, and here — and
         * all three should leave you looking at the same thing.
         *
         * Disabled rather than dead when that duck is not in the pond in
         * front of you: it may have been taken out, or whistled away by a
         * filter. A control that looks live and does nothing teaches
         * people that taps do not work.
         */
        /*
         * ══ EVERY FACE IS LIVE, AND THEY ALL LOOK IT ══
         * These used to dim when their duck was not in the pond in front
         * of you, so a row of five could come out bright-dim-bright, which
         * reads as a rendering fault rather than as information — reported
         * as exactly that.
         *
         * And the information was wrong anyway. A bumper is missing from
         * the view far more often because the pond payload is CAPPED than
         * because the duck has gone; dimming it says "this one has left"
         * when the truth is "not in the slice I am holding".
         *
         * So they are all drawn the same and they all work. A duck that is
         * on screen gets the camera and its card; one that is not gets its
         * own public page, which is where a duck you cannot see lives.
         */
        const said = b.count === 1
          ? t("live.bumps.one")
          : t("live.bumps", { n: String(b.count) });
        const box = button(
          "p-bumper", "",
          () => {
            // Re-resolved on the press, not captured at draw time: a poll
            // between the two replaces every duck object in the view.
            const now = view.findBySlug(b.slug);
            if (now) {
              dismiss();
              view.lookAt(now.id, true);
              openDuckCard(view, now);
              return;
            }
            location.href = `/d/${encodeURIComponent(b.slug)}`;
          },
          t("live.sr.bumper", { name: b.name || b.slug, bumps: said }),
        );
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
      /*
       * ══ NOT WHILE THE CARD IS STILL ARRIVING ══
       * `p-rise` moves the card by 102% OF ITS OWN HEIGHT, and this row
       * adds about seventy pixels to that height. Revealed mid-flight, the
       * card re-measures and jumps FURTHER off-screen before carrying on
       * up — measured at 390x844 as 259 → 282 → 353px inside the first
       * 25ms, with the transform tracking each one.
       *
       * On the bench the fetch returns instantly so the jump happens
       * during the first frames; on a real network it lands later and the
       * card grows after it has already settled. Both are the same defect:
       * a value derived from something live, captured, and never
       * reconciled when the live thing moved — the same shape as the water
       * buffer, and the eighth instance of it in this project.
       *
       * So the row waits for the animation to finish. There is nothing to
       * wait for when reduced motion is on or the card is already home,
       * and `animationend` would never fire in those cases, so the check
       * is on whether one is actually running.
       */
      const settle = (): void => {
        if (!bumpers.isConnected) return;
        /*
         * The corrected sentence goes with the row, not before it. It can
         * wrap from one line to two — the other 23px of the measured
         * 259 → 282 → 353 — and correcting the text while the card is
         * still rising moves the card for the same reason the row does.
         */
        showStats(bumpsToShow(duck.bumps, res.bumpers));
        bumpers.hidden = false;
      };
      const running = panel.getAnimations?.().filter((a) => a.playState === "running") ?? [];
      if (running.length) {
        void Promise.all(running.map((a) => a.finished.catch(() => {}))).then(settle);
      } else {
        settle();
      }
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

  /*
   * `/e/<key>` is the private link — the only credential a duck has, and
   * the whole reason coming back is worth doing.
   *
   * ══ REMEMBER IT, AND LAND ON THE POND ══
   * Two things were wrong here, and they had the same cause: this route
   * treated the key as an argument to one screen rather than as the answer
   * to "whose duck is this browser holding".
   *
   * `rememberEditKey` was called in exactly ONE place — the release flow,
   * when a duck is made in this browser. So a private link opened anywhere
   * else did not tell the pond anything. And anywhere else is the whole
   * point of the link: you text it to yourself, you open it on a laptop,
   * you come back after clearing Safari. In all of those the pond had no
   * idea you owned a duck, so the bar showed "tap a card to begin", there
   * was no say button, no settings, and bumping was impossible — bump
   * needs your key to prove the duck doing the bumping is yours.
   *
   * Reported exactly that way: "I can't bump other ducks or chat or jump
   * to settings once I'm at the pond."
   *
   * So the key is remembered FIRST, before the pond is built, because the
   * bar reads it while building.
   *
   * And the destination is the pond, not the settings form. The link is
   * the way back to the PLACE; settings is something you do once you are
   * there, and it is one tap away on the gear. Landing inside a form was
   * answering "take me back to my duck" with a page of fields.
   */
  if (b.view === "edit" && b.editKey) {
    rememberEditKey(b.editKey);
    await pondScreen({ mine: b.editKey });
    return;
  }

  /*
   * ══ RESOLVE THE TAP BEFORE RENDERING IT ══
   * This ran AFTER `pondScreen`, and the order was the bug David kept
   * seeing: the arrival gate asks `claimIsFresh`, and freshness is only
   * recorded once a claim has been attempted. So the first tap of an
   * already-spent armed card looked fresh, the arrival was suppressed,
   * the claim then failed, and he landed on the pond with a Decorate it
   * button instead of his fortune. Every browser lost its first tap that
   * way, which is exactly the tap that matters.
   *
   * So the network half happens first, and the URL is left intact for
   * `pondScreen` to read. By the time the arrival gate asks, the answer
   * is true.
   */
  const url = new URL(location.href);
  let outcome: ClaimResult = { kind: "none" };
  if (claimIsFresh(url)) {
    outcome = await resolveClaim(url);
    /*
     * ══ REMEMBERED AFTER THE ANSWER, NOT BEFORE THE QUESTION ══
     * This wrote the counter first, which buried claims that had never
     * happened: lose the network on the way out, or close the tab
     * mid-flight, and the browser recorded a counter the server had never
     * seen. The card was then unclaimable from that browser until its
     * storage was cleared — for a claim nobody had made.
     *
     * `resolveClaim` returns "refused" for a network failure as well as
     * for a real refusal, so only the answers that prove the server
     * actually decided something are recorded.
     *
     * ══ AND A QUESTION IS NOT AN ANSWER ══
     * `takeover` is excluded, and it is the one that was wrong. The
     * server is explicit that asking spends nothing — "the counter is NOT
     * spent, no epoch is touched" — precisely so somebody who decides not
     * to take a card over has lost nothing and their card is still armed.
     * Recording it here contradicted that from the other side: the server
     * kept the gesture live, and this browser wrote it off. The card was
     * then genuinely claimable by everyone EXCEPT the person holding it,
     * and the symptom is silence — no question, no refusal, no setup,
     * just the pond, which is indistinguishable from four blows that
     * never registered.
     *
     * One belief, two copies, only one updated. Again.
     *
     * So the counter is recorded where an answer actually exists: on
     * decline, and on both outcomes of confirm. A question that is never
     * answered — the tab is closed, the phone locks — stays fresh, which
     * is correct: nothing happened, so nothing was spent.
     */
    if (claimIsSpent(outcome.kind)) rememberClaimAttempt(url);
  }

  /*
   * ══ A COIN BEATS A QUESTION ══
   * The tap has been resolved, so the pond is told what it was rather
   * than left to work it out.
   *
   * And a fortune is never interrupted. David inserted a coin, tapped,
   * and was asked whether he wanted to take over a card — instead of
   * being given the fortune he had just paid for. The armed tag is why:
   * `&g=` is never cleared, so a card that was set up months ago still
   * looks like it is claiming on every single tap.
   *
   * An armed tap deals no fortune — the firmware makes sure of it — so a
   * tap that DID deal one is somebody playing, not somebody setting a
   * card up. Their coin wins, and the question is simply not asked.
   */
  const dealt = Number(url.searchParams.get("d") ?? 0) >= 1;
  const asking = outcome.kind === "takeover" && !dealt;
  const pond = await pondScreen({
    ...b,
    arrive: !(outcome.kind === "claimed" || asking),
  });

  if (url.searchParams.has("t")) {
    // The credential comes out of the URL on every tap that carries one,
    // claim or not: a shared or bookmarked link should never carry a
    // signature around.
    history.replaceState(null, "", url.pathname);
  }

  const root = document.querySelector<HTMLElement>(".p-overlay")!;

  if (outcome.kind === "claimed") {
    cardSetup({ root, onDone: () => root.replaceChildren() });
    return;
  }

  /*
   * ══ SOMEBODY ELSE KEEPS THIS CARD ══
   * Four blows cannot say who is holding the card, so the server does not
   * guess: it names the keeper and waits. Taking a card over is a real
   * thing to want — it is what the gesture is FOR — and it is also what
   * happens by accident when a keeper blows on their own card, which is
   * how David lost his own settings twice.
   *
   * Nothing has been spent. Leaving it alone costs nothing and the card
   * is still armed.
   */
  if (asking && outcome.kind === "takeover") {
    const who = outcome.keeper;
    const { root: sheetRoot, body } = makeSheet(true);
    body.append(
      el("p", "p-title", who ? t("live.claim.held", { keeper: who }) : t("keeper.31")),
      el("p", "p-body", t("keeper.32")),
    );
    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("keeper.33"), () => {
        void resolveClaim(url, true).then((r) => {
          // Answered, so now it is spent — whichever way it went. A
          // confirm that succeeded burnt the counter on the server; one
          // that was refused proves the server had already retired it.
          // Neither is worth asking again, and this path recorded
          // nothing at all before.
          if (claimIsSpent(r.kind)) rememberClaimAttempt(url);
          root.replaceChildren();
          if (r.kind === "claimed") {
            cardSetup({ root, onDone: () => root.replaceChildren() });
            return;
          }
          // Somebody got there first, or the gesture went stale between
          // the question and the answer. The tap is still a tap.
          pond.startRelease();
        });
      }),
      /*
       * Back to the pond. The question is only ever asked on a tap that
       * dealt no fortune, so there is nothing waiting to be decorated —
       * and somebody who has just declined to take a card over wants to
       * be put down, not moved on.
       */
      button("p-btn p-btn-quiet", t("keeper.34"), () => {
        /*
         * Declining IS an answer, so it is recorded here rather than at
         * the moment the question went up. Same counter, asked once. The
         * card stays armed and the server still holds the gesture — so
         * the card is not lost, it simply stops interrogating somebody
         * who has already said no.
         *
         * Blowing four times again is the way back to it. Note that on a
         * card still inside its five-minute setup window those four
         * blows RETIRE the claim instead (firmware `claim_setup_wait`) —
         * the coin has to come out and go back in first.
         */
        rememberClaimAttempt(url);
        root.replaceChildren();
      }),
    );
    body.append(actions);
    root.append(sheetRoot);
    return;
  }

  /*
   * A refusal only speaks up when there is nothing else to do. If this tap
   * also dealt a coin the person came to make a duck, and an apology about
   * card setup on top of the arrival is an error message standing in front
   * of the thing they actually wanted.
   */
  if (outcome.kind === "refused" && Number(url.searchParams.get("d") ?? 0) < 1) {
      /*
       * ══ A REFUSED CLAIM USED TO SAY NOTHING AT ALL ══
       * The server refuses four different ways — no secret, unknown card,
       * bad token, counter already used — and deliberately returns the
       * same opaque 403 for all of them, so that somebody walking the
       * counter space learns nothing. Right.
       *
       * But the CLIENT then swallowed that too, and the result was a card
       * you had just blown into four times opening an ordinary pond, with
       * no hint that anything had been refused. Indistinguishable from the
       * gesture not having worked — which is exactly how it was reported.
       *
       * So it says so. Still without distinguishing the four, because
       * that distinction is the thing being protected: the sentence names
       * the two causes a person can actually act on and tells them the
       * one thing to try.
       */
      const { root: sheetRoot, body } = makeSheet(true);
      body.append(
        el("p", "p-title", t("live.claim.no")),
        el("p", "p-body", t("live.claim.no.body")),
      );
      /*
       * ══ NAME THE CARD ══
       * "this card is not one the pond knows" is true and useless. The
       * serial is stamped on the card in somebody's hand, so printing it
       * gives away nothing and turns a vague refusal into something they
       * can act on — or quote to whoever keeps the pond.
       *
       * It diagnosed its own first real failure: a newly flashed card,
       * refused because it had never been recorded, and the only way to
       * find out was a database query.
       */
      const serial = url.searchParams.get("c");
      if (serial && /^[A-Za-z0-9]{6,12}$/.test(serial)) {
        body.append(el("p", "p-note", t("live.claim.no.card", { serial })));
      }
      body.append(button("p-btn", t("mine.05"), () => root.replaceChildren()));
      root.replaceChildren(sheetRoot);
  }
}

void main();
