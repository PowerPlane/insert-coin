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

import { ApiError, api, recallEditKey, type SessionState } from "./api.js";
import { CAM_UI } from "./camera.js";
import { PondView, type Placed } from "./pond-view.js";
import { setLang, t, type Lang } from "./strings.js";
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
async function pondScreen(bootstrap: Bootstrap): Promise<void> {
  root.replaceChildren();

  const stage = el("div", "p-stage");
  const canvas = el("canvas", "p-canvas");
  stage.append(canvas);

  const hud = el("div", "p-hud");
  const count = el("button", "p-count");
  count.type = "button";
  hud.append(count);

  const cta = el("div", "p-cta");

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

  root.append(stage, hud, zoom, cta);


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
  window.addEventListener("resize", fit);
  view.start();
  syncZoom();
  // A pinch changes the zoom without touching a button, so the buttons have
  // to notice. Cheap, and only while something is happening.
  setInterval(syncZoom, 500);

  // ── the pond itself ───────────────────────────────────────────────────
  let ducks: PondDuck[] = [];
  const refresh = async (): Promise<void> => {
    try {
      const res = await api.pond();
      ducks = res.ducks;
      view.setDucks(ducks);
      // "The count is the whistle" — tapping it opens the gather list.
      count.textContent =
        ducks.length === 0
          ? t("live.count.none")
          : ducks.length === 1
            ? t("live.count.one")
            : t("live.count", { n: String(ducks.length) });
    } catch (err) {
      count.textContent =
        err instanceof ApiError && err.status === 0 ? t("live.offline") : t("live.error");
    }
  };
  await refresh();

  // ── what this visitor can do ──────────────────────────────────────────
  const session = await api.session().catch(() => ({ active: false }) as SessionState);
  const mine = recallEditKey();

  if (session.active && !session.spent) {
    // A fortune is waiting. This is the only CTA that ever appears.
    const go = el("button", "p-btn", t("arrival.04"));
    go.type = "button";
    go.addEventListener("click", () => {
      // The decorating flow is the next cluster of screens; until it lands
      // this at least proves the session survived the tap.
      location.href = "/#studio";
    });
    cta.append(go);
  } else if (mine) {
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

  // Arrival zoom: land at arm's length from your own duck rather than
  // somewhere out there.
  if (bootstrap.duck) view.lookAt(bootstrap.duck.id, true);

  // The pond is polled. A fire that ignites on someone else's read should
  // show up here within a reasonable time without a socket.
  setInterval(refresh, 20_000);
}

/**
 * A duck's card.
 *
 * Deliberately not a route: the camera glides to the duck and the card
 * opens over the water, so closing it puts you back where you were.
 */
function openDuckCard(view: PondView, duck: Placed): void {
  view.lookAt(duck.id);
  view.splash(duck.wx, duck.wy);

  const existing = document.querySelector(".p-card");
  existing?.remove();

  const card = el("div", "p-card");
  const name = el("p", "p-card-name", duck.name || t("pond.24"));
  card.append(name);

  if (duck.keeper) card.append(el("p", "p-card-via", t("live.via", { keeper: duck.keeper })));
  if (duck.message) card.append(el("p", "p-card-msg", duck.message));

  const stats = el("p", "p-card-stats");
  stats.textContent = `${duck.bumps} · ${duck.rescues}`;
  card.append(stats);

  const close = el("button", "p-btn p-btn-quiet", t("pond.37"));
  close.type = "button";
  close.addEventListener("click", () => card.remove());
  card.append(close);

  root.append(card);
}

async function main(): Promise<void> {
  const b = boot();
  setLang((document.documentElement.lang as Lang) || "en");

  // Every view is the pond today; the decorating flow, the duck card and
  // settings land in the next clusters. Keeping one entry point means the
  // camera never has to be torn down and rebuilt between screens.
  await pondScreen(b);
}

void main();
