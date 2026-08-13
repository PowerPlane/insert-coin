/**
 * The studio — colour, stickers, paint.
 *
 * ══ WHY DECORATING COMES BEFORE SIGNING ══
 * By the time anyone is asked for their name they have already spent
 * minutes making something, so the ask lands as signing your own work
 * rather than filling in a form. FLOW.md § The happy path.
 *
 * Nothing here is required. A duck released untouched is a duck.
 */

import { GRID, clampPaintValue, encodePaint } from "./codec.js";
import { el, button } from "./dom.js";
import { drawDuck } from "./render.js";
import { PAINT_COLOURS, TINTS } from "./sprites.js";
import { MAX_STICKERS, SLOT_ORIGIN, STICKERS } from "./stickers.js";
import { t } from "./strings.js";
import type { Sticker } from "./types.js";

export interface StudioState {
  tint: number;
  stickers: Sticker[];
  paint: Uint8Array;
}

type Tab = "colour" | "stickers" | "draw";

export interface StudioOptions {
  fortune: number;
  state: StudioState;
  onChange: (state: StudioState) => void;
  onNext: () => void;
  onBack: () => void;
}

/** The duck is 24x24; this is how many screen pixels each cell gets. */
const EDIT_CELL = 12;

export function studioScreen(root: HTMLElement, opts: StudioOptions): void {
  const { state } = opts;

  root.replaceChildren();
  const wrap = el("div", "p-screen");

  const nav = el("div", "p-nav");
  nav.append(
    button("p-chip", t("studio.01"), opts.onBack),
    el("span", "p-nav-title", t("studio.02")),
    button("p-chip", t("studio.17"), opts.onNext),
  );

  // ── the duck being made ───────────────────────────────────────────────
  const canvas = el("canvas", "p-edit");
  canvas.width = GRID * EDIT_CELL;
  canvas.height = GRID * EDIT_CELL;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("studio.04"));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawDuck(
      ctx,
      { fortune: opts.fortune, tint: state.tint, paint: state.paint, stickers: state.stickers },
      0,
      0,
      EDIT_CELL,
    );
    opts.onChange(state);
  };

  // ── tabs ──────────────────────────────────────────────────────────────
  let tab: Tab = "colour";
  const panel = el("div", "p-panel");
  const tabs = el("div", "p-tabs");

  const setTab = (next: Tab) => {
    tab = next;
    [...tabs.children].forEach((c) =>
      c.classList.toggle("on", (c as HTMLElement).dataset.tab === next),
    );
    drawPanel();
  };

  for (const [key, label] of [
    ["colour", t("studio.08")],
    ["stickers", t("studio.09")],
    ["draw", t("studio.10")],
  ] as [Tab, string][]) {
    const b = button("p-tab", label, () => setTab(key));
    b.dataset.tab = key;
    tabs.append(b);
  }

  // ── the panels ────────────────────────────────────────────────────────
  function drawPanel(): void {
    panel.replaceChildren();
    if (tab === "colour") return colourPanel();
    if (tab === "stickers") return stickerPanel();
    return paintPanel();
  }

  function colourPanel(): void {
    const swatches = el("div", "p-swatches");
    TINTS.forEach((colour, i) => {
      const b = button("p-swatch", "", () => {
        state.tint = i;
        redraw();
        drawPanel();
      }, `${t("studio.11")} ${i + 1}`);
      b.style.background = colour;
      b.classList.toggle("on", state.tint === i);
      swatches.append(b);
    });
    panel.append(swatches);
  }

  function stickerPanel(): void {
    const hint = el("p", "p-hint", t("studio.18"));
    const grid = el("div", "p-stickers");

    for (const [id, def] of Object.entries(STICKERS)) {
      const already = state.stickers.find((s) => s.id === id);
      const b = button("p-sticker", "", () => {
        if (already) {
          state.stickers = state.stickers.filter((s) => s.id !== id);
        } else {
          // Six is the cap the schema enforces; dropping the oldest is
          // kinder than refusing, because the tap already happened.
          if (state.stickers.length >= MAX_STICKERS) state.stickers.shift();
          const [ox, oy] = SLOT_ORIGIN[def.slot];
          state.stickers.push({ id, x: ox, y: oy });
        }
        redraw();
        drawPanel();
      }, def.name);
      b.classList.toggle("on", Boolean(already));

      // Draw the sticker itself as the button's face.
      const c = el("canvas", "p-sticker-art");
      const cell = 4;
      c.width = def.rows[0]!.length * cell;
      c.height = def.rows.length * cell;
      const cc = c.getContext("2d")!;
      cc.imageSmoothingEnabled = false;
      def.rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === ".") return;
          cc.fillStyle =
            (STICKER_COLOURS as Record<string, string>)[ch] ?? "#2B2B24";
          cc.fillRect(x * cell, y * cell, cell, cell);
        });
      });
      b.append(c);
      grid.append(b);
    }
    panel.append(hint, grid);
  }

  function paintPanel(): void {
    let colour = 1;
    let brush = 1;
    let erasing = false;

    const tools = el("div", "p-tools");
    const brush1 = button("p-chip", t("studio.13"), () => {
      brush = 1;
      erasing = false;
      syncTools();
    });
    const brush2 = button("p-chip", t("studio.14"), () => {
      brush = 2;
      erasing = false;
      syncTools();
    });
    const erase = button("p-chip", t("studio.15"), () => {
      erasing = !erasing;
      syncTools();
    });
    const syncTools = () => {
      brush1.classList.toggle("on", brush === 1 && !erasing);
      brush2.classList.toggle("on", brush === 2 && !erasing);
      erase.classList.toggle("on", erasing);
    };
    syncTools();

    const undo = button("p-chip", "↶", () => {
      const last = history.pop();
      if (last) {
        state.paint = last;
        redraw();
      }
    }, t("studio.05"));
    const clear = button("p-chip", "×", () => {
      history.push(state.paint.slice());
      state.paint = new Uint8Array(GRID * GRID);
      redraw();
    }, t("studio.06"));

    tools.append(brush1, brush2, erase, undo, clear);

    const swatches = el("div", "p-swatches");
    PAINT_COLOURS.forEach((c, i) => {
      const b = button("p-swatch", "", () => {
        colour = i + 1; // 0 is "no paint here"
        erasing = false;
        syncTools();
        drawPanel();
      }, `${t("studio.16")} ${i + 1}`);
      b.style.background = c;
      b.classList.toggle("on", colour === i + 1);
      swatches.append(b);
    });

    // Painting happens on the duck canvas itself, so what you touch is what
    // you get — no separate paint surface to line up with the drawing.
    let painting = false;
    const paintAt = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID);
      for (let dy = 0; dy < brush; dy++) {
        for (let dx = 0; dx < brush; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= GRID || py >= GRID) continue;
          state.paint[py * GRID + px] = erasing ? 0 : clampPaintValue(colour);
        }
      }
      redraw();
    };

    canvas.onpointerdown = (e) => {
      history.push(state.paint.slice());
      if (history.length > 24) history.shift();
      painting = true;
      canvas.setPointerCapture(e.pointerId);
      paintAt(e);
    };
    canvas.onpointermove = (e) => {
      if (painting) paintAt(e);
    };
    canvas.onpointerup = () => {
      painting = false;
    };

    panel.append(tools, swatches);
  }

  const history: Uint8Array[] = [];

  wrap.append(nav, canvas, tabs, panel);
  root.append(wrap);
  setTab("colour");
  redraw();
}

/** Mirrors STICKER_PALETTE, which is not exported as an index signature. */
const STICKER_COLOURS: Record<string, string> = {
  k: "#2B2B24", w: "#FFFFFF", r: "#FF4B4B", y: "#FFCA00", b: "#3FB5D8",
  g: "#5AD08A", p: "#FF6FA5", o: "#FF8953", n: "#8B5E34", s: "#C9D6DC",
};

/** What the API wants: paint as base64, stickers as plain objects. */
export function toPayload(state: StudioState): {
  tint: number;
  stickers: Sticker[];
  paint: string;
} {
  const painted = state.paint.some((v) => v !== 0);
  return {
    tint: state.tint,
    stickers: state.stickers,
    // Empty means empty. Sending 384 characters of zeros would store a
    // blank layer on every duck that never used the brush.
    paint: painted ? encodePaint(state.paint) : "",
  };
}
