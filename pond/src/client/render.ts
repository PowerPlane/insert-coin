/**
 * Drawing ducks and water.
 *
 * Everything here obeys two rules taken from the card itself:
 *
 *  1. Nothing tweens. Positions are snapped to whole pixels and frames are
 *     hard-switched — the Game & Watch law from byproductlab.com's DESIGN.md.
 *  2. The clock is uneven. The card's duck walk holds each frame for
 *     {180, 380, 280, 180} ms; a metronome reads as a machine, that wobble
 *     reads as a hand.
 */

import { decodePaint } from "./codec.js";
import {
  BEAK_COLOUR,
  BURNING_TINT,
  DUCKS,
  EYE_COLOUR,
  FLAME,
  FLAME_COLOURS,
  FORTUNES,
  GRID,
  PAINT_COLOURS,
  TINTS,
  flameMask,
} from "./sprites.js";
import type { Sticker } from "./types.js";
import { prefersReducedMotion } from "./viewport.js";
import { STICKERS, STICKER_PALETTE } from "./stickers.js";

/** The card's own uneven dwell pattern, normalised. */
export const DWELL = [1.0, 1.45, 0.85, 1.25] as const;

export interface Drawable {
  fortune: number;
  tint: number;
  paint?: Uint8Array | string | null;
  stickers?: Sticker[] | null;
  burning?: boolean;
  flip?: boolean;
  frame?: number;
}

function tintOf(d: Drawable): string {
  if (d.burning) return BURNING_TINT;
  return TINTS[d.tint] ?? TINTS[0]!;
}

function paintCells(d: Drawable): Uint8Array | null {
  if (!d.paint) return null;
  return typeof d.paint === "string" ? decodePaint(d.paint) : d.paint;
}

/**
 * Composite a duck at (px, py) with `s` device pixels per sprite pixel.
 *
 * Order is deliberate: base → paint → eye → stickers.
 * The eye redraws over paint so a duck can never lose its face, and
 * stickers draw last so a hat is never buried under someone's brushwork.
 */
export function drawDuck(
  ctx: CanvasRenderingContext2D,
  d: Drawable,
  px: number,
  py: number,
  s: number,
): void {
  const key = FORTUNES[d.fortune]?.key ?? "little";
  const rows = DUCKS[key]!;
  const body = tintOf(d);
  const flip = Boolean(d.flip);
  const at = (x: number) => (flip ? GRID - 1 - x : x);

  if (d.burning) drawFlames(ctx, key, px, py, s, flip, d.frame ?? 0);

  for (let y = 0; y < GRID; y++) {
    const row = rows[y]!;
    for (let x = 0; x < GRID; x++) {
      const c = row[x];
      if (c === ".") continue;
      ctx.fillStyle = c === "A" ? body : c === "O" ? BEAK_COLOUR : EYE_COLOUR;
      ctx.fillRect(px + at(x) * s, py + y * s, s, s);
    }
  }

  const paint = paintCells(d);
  if (paint) {
    for (let i = 0; i < paint.length; i++) {
      const v = paint[i]!;
      if (!v) continue;
      const colour = PAINT_COLOURS[v - 1];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(px + at(i % GRID) * s, py + Math.floor(i / GRID) * s, s, s);
    }
    // The face survives whatever was painted over it.
    for (let y = 0; y < GRID; y++) {
      const row = rows[y]!;
      for (let x = 0; x < GRID; x++) {
        if (row[x] !== "K") continue;
        ctx.fillStyle = EYE_COLOUR;
        ctx.fillRect(px + at(x) * s, py + y * s, s, s);
      }
    }
  }

  for (const st of d.stickers ?? []) drawSticker(ctx, st, px, py, s, flip);
}

/*
 * ══ THE ONE DUCK YOU ARE LOOKING FOR ══
 * Thirteen ducks, all the same size, all bobbing. Without a label the duck
 * you just made is the one duck on screen you cannot find — which is the
 * whole reason the arrival exists.
 *
 * Gold on dark brown, sized in CELLS so it grows with the zoom rather than
 * floating at a fixed size over shrinking art. Below cell 3 it is not
 * drawn at all: four screen pixels of type is not text, and zoomed out you
 * are reading the shape of the crowd rather than names.
 */
export const TAG = {
  MIN_CELL: 3,
  /** In sprite cells, measured from the duck's top-left. */
  X: 4, Y: -6, W: 16, H: 5,
  BACK: "#FFCA00",
  INK: "#4A3A06",
  TEXT: "YOU",
} as const;

export function drawTag(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  s: number,
): void {
  if (s < TAG.MIN_CELL) return;
  // Never above the top of the canvas: a tag drawn off-screen is the one
  // label you needed and the one you cannot see.
  const top = Math.max(0, py + TAG.Y * s);
  ctx.fillStyle = TAG.BACK;
  ctx.fillRect(px + TAG.X * s, top, TAG.W * s, TAG.H * s);
  ctx.fillStyle = TAG.INK;
  ctx.font = `bold ${4 * s}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(TAG.TEXT, px + (TAG.X + TAG.W / 2) * s, top + (TAG.H / 2) * s);
  // Canvas text state is global; leave it as it was found.
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/** Matches --mono in app.css. */
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export function drawSticker(
  ctx: CanvasRenderingContext2D,
  st: Sticker,
  px: number,
  py: number,
  s: number,
  flip = false,
): void {
  const def = STICKERS[st.id];
  if (!def) return;
  for (let y = 0; y < def.rows.length; y++) {
    const row = def.rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === ".") continue;
      const gx = st.x - def.ax + x;
      const gy = st.y - def.ay + y;
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
      ctx.fillStyle = STICKER_PALETTE[c as keyof typeof STICKER_PALETTE] ?? EYE_COLOUR;
      ctx.fillRect(px + (flip ? GRID - 1 - gx : gx) * s, py + gy * s, s, s);
    }
  }
}

/**
 * Flames flicker by dropping pixels — SHAPE only, never brightness.
 *
 * 70 ms is ~14 Hz, inside the 3–60 Hz band WCAG 2.3.1 restricts. It is safe
 * here only because the area is tiny and the luminance swing is small, so
 * the rule is: never flicker brightness, never more than one duck's worth
 * of area, never the background.
 */
function drawFlames(
  ctx: CanvasRenderingContext2D,
  key: string,
  px: number,
  py: number,
  s: number,
  flip: boolean,
  frame: number,
): void {
  const mask = flameMask(key);
  const reduce = prefersReducedMotion();
  const f = reduce ? 0 : frame;
  for (let y = 0; y < FLAME.FIELD; y++) {
    for (let x = 0; x < FLAME.FIELD; x++) {
      if (!mask[y * FLAME.FIELD + x]) continue;
      const seed = (x * 7 + y * 13 + f * 5) % 11;
      if (!reduce && seed < 3) continue;
      ctx.fillStyle = seed > 8 ? FLAME_COLOURS[1] : FLAME_COLOURS[0];
      const ox = flip ? FLAME.FIELD - 1 - x : x;
      ctx.fillRect(px + (ox - FLAME.OFFSET) * s, py + (y - FLAME.OFFSET) * s, s, s);
    }
  }
}

// `prefersReducedMotion` used to live here. It is a fact about the viewing
// conditions, not about drawing, and it now sits beside `watchSize` in
// viewport.ts — where the other thing the OS can change under us lives.

/* ── water ─────────────────────────────────────────────────────────────
   Flat depth bands dithered with a 4×4 ordered (Bayer) matrix. The
   dithering is what makes a flat surface read as pixel art rather than a
   gradient — the pixels themselves are the texture. */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Shallow to deep, hung off the brand pond ramp (field-200 → field-900). */
const WATER = [
  [0xcf, 0xef, 0xfa], [0xaf, 0xe4, 0xf5], [0x8e, 0xdc, 0xee], [0x6b, 0xcb, 0xe4],
  [0x4f, 0xbb, 0xda], [0x3f, 0xb5, 0xd8], [0x2e, 0x9b, 0xc0], [0x1f, 0x80, 0xa4],
] as const;

/**
 * Canvas pixel memory is little-endian ABGR, not ARGB. Packing it the
 * obvious way swaps red and blue and turns the whole pond cream.
 */
const packLE = (r: number, g: number, b: number): number =>
  (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);

const WATER_LE = WATER.map(([r, g, b]) => packLE(r!, g!, b!));

export interface WaterBuffer {
  canvas: HTMLCanvasElement;
  image: ImageData;
  words: Uint32Array;
  cols: number;
  rows: number;
}

export function createWaterBuffer(cols: number, rows: number): WaterBuffer {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(cols, rows);
  return { canvas, image, words: new Uint32Array(image.data.buffer), cols, rows };
}

/**
 * Paint the water into its 1-px-per-cell buffer, then blow it up with
 * smoothing off. Far cheaper than tens of thousands of fillRect calls, and
 * exactly as crisp.
 */
export function drawWater(buf: WaterBuffer, frame: number, deep = true): void {
  const { words, cols, rows } = buf;
  for (let y = 0; y < rows; y++) {
    const depth = deep ? 0.7 + (y / rows) * 4.1 : 1.0 + (y / rows) * 2.4;
    for (let x = 0; x < cols; x++) {
      let k = Math.floor(depth + (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.62);
      // Sparse drifting sparkle. Dense enough and it reads as static.
      if ((x * 7 + y * 11 + (frame >> 1)) % 149 === 0) k -= 2;
      else if ((x * 3 + y * 5 - (frame >> 2)) % 71 === 0) k -= 1;
      words[y * cols + x] = WATER_LE[k < 0 ? 0 : k > 7 ? 7 : k]!;
    }
  }
  buf.canvas.getContext("2d")!.putImageData(buf.image, 0, 0);
}

export function blitWater(
  ctx: CanvasRenderingContext2D,
  buf: WaterBuffer,
  w: number,
  h: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf.canvas, 0, 0, w, h);
}

/* ── ripples ───────────────────────────────────────────────────────────
   Discrete events, not a wave simulation. A simulation has to dissipate
   energy, so its ripples always linger; these expand on an ease-out curve
   and are gone in 480 ms. */

export const RIPPLE_MS = 480;
export const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);

export interface Ripple {
  x: number;
  y: number;
  t: number;
  max: number;
}

export function drawRipples(
  buf: WaterBuffer,
  ripples: Ripple[],
  now: number,
): void {
  const { words, cols, rows } = buf;
  for (const r of ripples) {
    const p = (now - r.t) / RIPPLE_MS;
    if (p >= 1) continue;
    const rad = easeOut(p) * r.max;
    const fade = 1 - p;
    const x0 = Math.max(1, Math.floor(r.x - rad - 2));
    const x1 = Math.min(cols - 1, Math.ceil(r.x + rad + 2));
    const y0 = Math.max(1, Math.floor(r.y - rad - 2));
    const y1 = Math.min(rows - 1, Math.ceil(r.y + rad + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - r.x, y - r.y) - rad;
        if (d < -1.6 || d > 1.1) continue;
        const lift = d < -0.4 ? (fade > 0.45 ? 2 : 1) : fade > 0.3 ? 1 : 0;
        if (!lift) continue;
        const i = y * cols + x;
        const cur = WATER_LE.indexOf(words[i]! >>> 0);
        words[i] = WATER_LE[Math.max(0, (cur < 0 ? 2 : cur) - lift)]!;
      }
    }
  }
  buf.canvas.getContext("2d")!.putImageData(buf.image, 0, 0);
}
