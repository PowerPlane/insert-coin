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
import { el, button, sheet } from "./dom.js";
import { drawDuck } from "./render.js";
import {
  FORTUNES, PAINT_COLOURS, STICKER_GRAB_SLACK, TINTS, slotOnDuck, stickerAt,
} from "./sprites.js";
import { MAX_STICKERS, SLOT_ORIGIN, STICKERS, type SlotName } from "./stickers.js";
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

/**
 * The backing store is 12 device pixels per sprite pixel; CSS scales it
 * down to fit. Rendering at a fixed high resolution and letting the layout
 * decide the displayed size keeps the sprite crisp on every screen without
 * the canvas being resized — and `image-rendering: pixelated` means scaling
 * down costs nothing.
 */
const EDIT_CELL = 12;

/** The outline on a sticker being moved. The pond's ink, not a system blue. */
const SELECT_INK = "#0b3d52";

export function studioScreen(root: HTMLElement, opts: StudioOptions): void {
  const { state } = opts;

  root.replaceChildren();
  const { root: sheetRoot, body: wrap } = sheet();

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
    /*
     * The sticker in hand wears an outline. Without it there is no way to
     * tell "I have picked this up" from "I tapped and nothing happened" —
     * and on a small sticker under a fingertip, the sticker itself is the
     * part you cannot see.
     *
     * Drawn OUTSIDE the sticker's box, on the same pixel grid as
     * everything else, so it reads as a mark on the art rather than a
     * browser widget that has wandered in.
     */
    if (dragging >= 0) {
      const st = state.stickers[dragging];
      const def = st ? STICKERS[st.id] : undefined;
      if (st && def) {
        ctx.strokeStyle = SELECT_INK;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          (st.x - def.ax) * EDIT_CELL - 1,
          (st.y - def.ay) * EDIT_CELL - 1,
          def.rows[0]!.length * EDIT_CELL + 2,
          def.rows.length * EDIT_CELL + 2,
        );
      }
    }
    opts.onChange(state);
  };

  /*
   * ══ THE TOOLS BELONG TO THE STUDIO, NOT TO A PANEL ══
   * These lived inside `paintPanel`, which is torn down and rebuilt on
   * every tap — including the tap that picks a colour. So choosing any
   * colour immediately reset the choice to the first one, and a duck could
   * only ever be painted in one colour.
   */
  let colour = 1;
  let brush = 1;
  let erasing = false;

  // ── what a touch on the duck means ────────────────────────────────────
  //
  // ONE set of handlers, branching on the current tab. They used to be
  // installed by `paintPanel`, so once you had visited Draw they stayed
  // bound for the rest of the session: tapping your duck to move a sticker
  // painted on it instead.

  /** Which cell of the duck a pointer is over. Outside the duck reads as null. */
  const cellOf = (e: PointerEvent): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID);
    return x < 0 || y < 0 || x >= GRID || y >= GRID ? null : { x, y };
  };

  let painting = false;
  /** Index of the sticker being moved, or -1. Also drives the outline. */
  let dragging = -1;

  const paintAt = (c: { x: number; y: number }) => {
    for (let dy = 0; dy < brush; dy++) {
      for (let dx = 0; dx < brush; dx++) {
        const px = c.x + dx;
        const py = c.y + dy;
        if (px >= GRID || py >= GRID) continue;
        state.paint[py * GRID + px] = erasing ? 0 : clampPaintValue(colour);
      }
    }
    redraw();
  };

  canvas.onpointerdown = (e) => {
    const c = cellOf(e);
    if (!c) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    if (tab === "stickers") {
      /*
       * Pick a sticker up. A tap that lands on nothing does nothing: the
       * tray is where stickers come FROM, and it already puts each one on
       * its own slot — a hat on the head — so the duck only has to answer
       * for moving what is already there.
       */
      dragging = stickerAt(state.stickers, c.x, c.y, STICKER_GRAB_SLACK);
      if (dragging >= 0) redraw();
      return;
    }

    if (tab !== "draw") return;
    history.push(state.paint.slice());
    if (history.length > 24) history.shift();
    painting = true;
    paintAt(c);
  };

  canvas.onpointermove = (e) => {
    const c = cellOf(e);
    if (!c) return;
    if (dragging >= 0) {
      // Straight to the cell under the finger, snapped to the grid — the
      // sticker follows the pointer rather than trailing behind wherever it
      // was grabbed, which is what makes it feel picked up.
      state.stickers[dragging] = { ...state.stickers[dragging]!, x: c.x, y: c.y };
      redraw();
      return;
    }
    if (painting) paintAt(c);
  };

  const release = () => {
    painting = false;
    if (dragging >= 0) {
      dragging = -1;
      redraw();
    }
  };
  canvas.onpointerup = release;
  // A pointer can be taken away — a system gesture, a call arriving. The
  // sticker has to be put down either way, or it follows the next touch.
  canvas.onpointercancel = release;

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
          // Resolved against THIS duck: the four sprites are different
          // sizes, so one table of coordinates does not fit them all.
          const [ox, oy] = slotOnDuck(SLOT_ORIGIN[def.slot], FORTUNES[opts.fortune]?.key ?? "little");
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

    // "?" rather than a die: this is a question the duck answers.
    const surprise = button("p-chip", "?", () => {
      state.tint = Math.floor(Math.random() * TINTS.length);
      state.stickers = surpriseStickers(opts.fortune);
      redraw();
      drawPanel();
    }, t("studio.07"));

    tools.append(brush1, brush2, erase, undo, clear, surprise);

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

    panel.append(tools, swatches);
  }

  const history: Uint8Array[] = [];

  wrap.append(nav, canvas, tabs, panel);
  root.append(sheetRoot);
  setTab("colour");
  redraw();
}

/** Mirrors STICKER_PALETTE, which is not exported as an index signature. */
const STICKER_COLOURS: Record<string, string> = {
  k: "#2B2B24", w: "#FFFFFF", r: "#FF4B4B", y: "#FFCA00", b: "#3FB5D8",
  g: "#5AD08A", p: "#FF6FA5", o: "#FF8953", n: "#8B5E34", s: "#C9D6DC",
};

/** What the API wants: paint as base64, stickers as plain objects. */
/**
 * ══ SURPRISE ME ══
 * A duck nobody chose, which is a different pleasure from one you built —
 * and the fastest way to find out that hats exist at all.
 *
 * It fills roughly half the slots rather than all six, because a duck
 * wearing every accessory at once is not a surprise, it is a pile. Each
 * chosen slot takes one of its own stickers, so hats land on the head and
 * bags at the side: the placement goes through `slotOnDuck`, so this is
 * correct on all four ducks and not only on 小吉.
 */
const SLOT_CHANCE = 0.55;

export function surpriseStickers(fortune: number): Sticker[] {
  const key = FORTUNES[fortune]?.key ?? "little";
  const bySlot = new Map<SlotName, string[]>();
  for (const [id, def] of Object.entries(STICKERS)) {
    bySlot.set(def.slot, [...(bySlot.get(def.slot) ?? []), id]);
  }

  const picked: Sticker[] = [];
  for (const [slot, ids] of bySlot) {
    if (Math.random() >= SLOT_CHANCE) continue;
    if (picked.length >= MAX_STICKERS) break;
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const [x, y] = slotOnDuck(SLOT_ORIGIN[slot], key);
    picked.push({ id, x, y });
  }
  return picked;
}

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
