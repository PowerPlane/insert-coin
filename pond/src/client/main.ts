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

import { ApiError, api, recallEditKey, type ReportReason, type SessionState } from "./api.js";
import { button, ditherEdge, field } from "./dom.js";
import { mineScreen } from "./mine.js";
import { FORTUNES } from "./sprites.js";
import { CAM_UI } from "./camera.js";
import { cardSetup, claimFromUrl } from "./keeper.js";
import { releaseFlow } from "./release-flow.js";
import { PondView, type Placed } from "./pond-view.js";
import { drawDuck } from "./render.js";
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

  const view = new PondView({
    canvas,
    onTapDuck: (d) => openDuckCard(view, d),
    onTapWater: (wx, wy) => view.splash(wx, wy),
  });

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

  root.append(stage, hud, zoom, cta, wordmark, overlay);


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

  const refresh = async (): Promise<void> => {
    try {
      const res = await api.pond();
      ducks = res.ducks;
      view.setDucks(ducks);
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
  const mine = recallEditKey();

  async function syncCta(): Promise<void> {
    cta.replaceChildren();
    const session = await api.session().catch(() => ({ active: false }) as SessionState);
    buildCta(session);
  }

  function buildCta(session: SessionState): void {
    if (session.active && !session.spent) {
    // A fortune is waiting. This is the only CTA that ever appears, and it
    // is the whole reason the pond can be the default screen: someone with
    // nothing to make sees a pond, not a form.
    /*
     * Quiet, not the duck-yellow primary. The prototype reserves yellow for
     * the one real action on a MAKING screen; over the water this is a way
     * back into a flow you have already started, and a yellow slab there
     * competes with the pond it is sitting on. `.btn.g` in the prototype.
     */
    const go = el("button", "p-btn p-btn-quiet", t("arrival.04"));
    go.type = "button";
    go.addEventListener("click", () => {
      // The pollers stop; the WATER DOES NOT. A pond that freezes the
      // moment you start decorating stops being a place you are making
      // something for.
      pausePolling();
      releaseFlow({
        root: overlay,
        fortune: session.fortune ?? 1,
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
        onDone: (made) => {
          // Back to the water, and the camera goes to look at what they
          // just made — the one move that is watched rather than operated.
          overlay.replaceChildren();
          resumePolling();
          // The duck enters with its fortune's own arrival — FLOW.md § 06.
          // The camera takes CAM_MOMENT rather than CAM_UI: this is the one
          // thing that is watched rather than operated.
          void syncCta();
          void refresh().then(() => {
            view.lookAt(made.id, true);
            const duck = view.find(made.id);
            if (duck) view.arrive(duck);
          });
        },
      });
    });
      cta.append(go);
      return;
    }
    if (mine) {
    // "Find my duck" was removed on purpose — once your duck is in the
    // pond there is no action you still owe it, so the CTA hides entirely.
    const back = el("button", "p-btn p-btn-quiet", t("mine.05"));
    back.type = "button";
      back.addEventListener("click", () => {
        const d = ducks.find((x) => x.id === bootstrap.duck?.id);
        if (d) view.lookAt(d.id);
      });
      cta.append(back);
    }
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
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shortDate(created: number): string {
  const d = new Date(created * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function openDuckCard(view: PondView, duck: Placed): void {
  // Above the card, not behind it.
  view.lookAtAbove(duck.id);
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
        cv.width = 64;
        cv.height = 64;
        const c = cv.getContext("2d");
        if (c) {
          c.imageSmoothingEnabled = false;
          drawDuck(c, b, 0, 0, 64 / 24);
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
          showStats(res.bumps);
          /*
           * Your duck swims over and knocks theirs. That is the whole
           * reason this is called a bump: a counter going up is a like,
           * and two ducks touching is a bump.
           *
           * Animated on success rather than on tap, so a bump the cap
           * refused never shows a duck crossing the pond for nothing. The
           * card closes to get out of the way of the thing it started.
           */
          if (view.bumpDuck(res.from, duck.id)) dismiss();
          else view.splash(duck.wx, duck.wy);
          bump.textContent = "✓";
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
