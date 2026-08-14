/**
 * Duck art.
 *
 * The four fortune sprites are derived from David's own `ducky-*.svg` in
 * docs/nfc-ducky/assets — rasterised at 24×24 with 6× supersampling and a
 * 42% coverage threshold, then hand-finished with an orange beak and an ink
 * eye. `tools/pixelize.html` regenerates them if the source art changes.
 *
 * Three flat colours only: body, beak, eye. No outline, no shading, no
 * highlight — the same flat blocks as the original SVGs.
 *
 * Because the base sprite is CODE rather than per-duck data, improving this
 * file improves every duck already in the pond, with no migration.
 *
 * Character codes: A body (tinted) · O beak · K eye · . transparent
 */

export const GRID = 24;

export const DUCKS: Record<string, string[]> = {
  great: [
    "........................", "........................", "........................",
    "............AAAAA.......", "...........AAAAAA.......", "..........AAAAAAAA......",
    "..........AAAAAAAAAA....", ".....AA...AAAAAAAAA.....", ".....AAAA..AAAAAA.......",
    ".....AAAAAAAAAAAAA......", "......AAAAAAAAAAAAA.....", "......AAAAAAAAAAAAA.....",
    ".......AAAAAAAAAAAAA....", "......AAAAAAAAAAAAAA....", "....AAAAAAAAAAAAAAAA....",
    ".....AAAAAAAAAAAAAA.....", ".....AAAAAAAAAAAAAA.....", "......AAAAAAAAAAAA......",
    ".......AAAAAAAAAA.......", ".........AAAAAAA........", "........................",
    "........................", "........................", "........................",
  ],
  little: [
    "........................", "........................", "..............A.........",
    "............AAAAA.......", "...........AAAAAAA......", "..........AAAAAAAAAAA...",
    "..........AAAAAAAAAAA...", "..........AAAAAAAAAA....", "...........AAAAAAAA.....",
    "...........AAAAAAA......", "..AAA......AAAAAAAA.....", "..AAAAAAAAAAAAAAAAAA....",
    "..AAAAAAAAAAAAAAAAAAA...", "..AAAAAAAAAAAAAAAAAAA...", "...AAAAAAAAAAAAAAAAAA...",
    "...AAAAAAAAAAAAAAAAAA...", "....AAAAAAAAAAAAAAAA....", "....AAAAAAAAAAAAAAAA....",
    ".....AAAAAAAAAAAAAA.....", ".......AAAAAAAAAAA......", ".........AAAAAA.........",
    "........................", "........................", "........................",
  ],
  uncertain: [
    "........................", "........................", "........................",
    "........................", "........................", ".............AAAA.......",
    "............AAAAAA......", "...........AAAAAAAA.....", "...........AAAAAAAA.....",
    "...........AAAAAAAA.....", "..........AAAAAAAAA.....", ".......AAAAAAAAAAAAA....",
    "....AAAAAAAAAAAAA.......", "....AAAAAAAAAAAAA.......", "....AAAAAAAAAAAAA.......",
    "....AAAAAAAAAAAAA.......", ".....AAAAAAAAAAAA.......", "......AAAAAAAAAA........",
    ".......AAAAAAAA.........", "........................", "........................",
    "........................", "........................", "........................",
  ],
};

/**
 * 凶 is an ORDINARY duck. Its body only turns orange while it is alight,
 * so the fire is a genuine surprise rather than something you can see
 * coming across the pond. Same silhouette as 小吉 by design.
 */
DUCKS.bad = DUCKS.little!.slice();

/** Beak cells, per sprite. Applied after the silhouette. */
const BEAKS: Record<string, [number, number][]> = {
  great: [[6, 18], [6, 19], [7, 17], [7, 18]],
  little: [[5, 18], [5, 19], [5, 20], [6, 18], [6, 19], [6, 20]],
  uncertain: [[10, 17], [10, 18], [11, 18], [11, 19]],
};
/** A chunky 2×2 dot — the most cartoony read at this size. */
const EYES: Record<string, [number, number][]> = {
  great: [[4, 14], [4, 15], [5, 14], [5, 15]],
  little: [[4, 15], [4, 16], [5, 15], [5, 16]],
  uncertain: [[8, 15], [8, 16], [9, 15], [9, 16]],
};
BEAKS.bad = BEAKS.little!;
EYES.bad = EYES.little!;

for (const key of Object.keys(DUCKS)) {
  const rows = DUCKS[key]!.map((r) => r.split(""));
  for (const [y, x] of BEAKS[key] ?? []) if (rows[y]?.[x] === "A") rows[y]![x] = "O";
  for (const [y, x] of EYES[key] ?? []) if (rows[y]?.[x] === "A") rows[y]![x] = "K";
  DUCKS[key] = rows.map((r) => r.join(""));
}

export const FORTUNES = [
  { key: "great", jp: "大吉", en: "Great luck" },
  { key: "little", jp: "小吉", en: "Little luck" },
  { key: "uncertain", jp: "末吉", en: "Uncertain" },
  { key: "bad", jp: "凶", en: "Bad luck" },
] as const;

export const BEAK_COLOUR = "#EF9F4E";
export const EYE_COLOUR = "#2B2B24";

/** Body tints. Index is stored per duck; order is therefore permanent. */
export const TINTS = [
  "#FFCA00", "#FFE9A8", "#FFB068", "#FF8973",
  "#FF8FB8", "#C08BE0", "#5CC7E4", "#3FB5D8",
  "#7BDCA4", "#9DBE6A", "#FFFFFF", "#5A6660",
] as const;

/** While burning, 凶's body reads as this instead of its tint. */
export const BURNING_TINT = "#FF8953";

/** The paint overlay palette. Index 0 is "unpainted". Order is permanent. */
export const PAINT_COLOURS = [
  "#FFFFFF", "#2B2B24", "#FF4B4B", "#FF8953",
  "#FFCA00", "#5AD08A", "#3FB5D8", "#0FB1EC",
  "#A06BD8", "#FF6FA5", "#8B5E34", "#16718F",
  "#EDFAFE", "#C08508", "#FFE9A8",
] as const;

/**
 * Flames, generated from whichever silhouette they wrap rather than drawn
 * once — the flame art in the source SVG hugs a much smaller duck than the
 * one that floats in the pond.
 *
 * A thin ring around the outline plus licks rising off the back, tallest
 * over the body and tapering at the edges, and nothing below the waterline
 * because flames rise.
 */
const FLAME_FIELD = 32;
const FLAME_OFFSET = 4;
const flameCache = new Map<string, Uint8Array>();

export function flameMask(key: string): Uint8Array {
  const cached = flameCache.get(key);
  if (cached) return cached;

  const rows = DUCKS[key] ?? DUCKS.little!;
  const solid = (x: number, y: number): boolean => {
    const sx = x - FLAME_OFFSET;
    const sy = y - FLAME_OFFSET;
    return sx >= 0 && sy >= 0 && sx < GRID && sy < GRID && rows[sy]![sx] !== ".";
  };

  const mask = new Uint8Array(FLAME_FIELD * FLAME_FIELD);
  for (let y = 0; y < FLAME_FIELD; y++) {
    for (let x = 0; x < FLAME_FIELD; x++) {
      if (solid(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (solid(x + dx, y + dy)) { near = true; break; }
        }
      }
      if (near) mask[y * FLAME_FIELD + x] = 1;
    }
  }

  let minX = FLAME_FIELD;
  let maxX = 0;
  let bottom = 0;
  for (let x = 0; x < FLAME_FIELD; x++) {
    for (let y = 0; y < FLAME_FIELD; y++) {
      if (!solid(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > bottom) bottom = y;
    }
  }
  const mid = (minX + maxX) / 2;
  const half = Math.max(1, (maxX - minX) / 2);
  for (let x = minX; x <= maxX; x++) {
    let top = -1;
    for (let y = 0; y < FLAME_FIELD; y++) if (solid(x, y)) { top = y; break; }
    if (top < 0) continue;
    const bell = 1 - Math.pow(Math.abs(x - mid) / half, 1.7);
    const h = Math.round(bell * 7) + ((x * 7) % 3);
    for (let k = 1; k <= h; k++) {
      const y = top - 1 - k;
      if (y >= 0) mask[y * FLAME_FIELD + x] = 1;
    }
  }
  // Nothing burns below the waterline.
  for (let y = bottom - 2; y < FLAME_FIELD; y++) {
    for (let x = 0; x < FLAME_FIELD; x++) mask[y * FLAME_FIELD + x] = 0;
  }

  flameCache.set(key, mask);
  return mask;
}

export const FLAME = { FIELD: FLAME_FIELD, OFFSET: FLAME_OFFSET } as const;
export const FLAME_COLOURS = ["#FF4B4B", "#FF8953"] as const;

/**
 * ══ ONE SLOT TABLE, FOUR DIFFERENT DUCKS ══
 * `SLOT_ORIGIN` in stickers.ts says where a hat or a bag lands. It is one
 * table, measured on 小吉 — and the four ducks are not the same duck:
 *
 *     小吉 / 凶   rows  2..20   height 19
 *     大吉        rows  3..19   height 17
 *     末吉        rows  5..18   height 14
 *
 * 末吉 is not 小吉 shifted down, it is a SMALLER duck, inset at both ends.
 * So a hat pinned at row 2 sat on 小吉's head and floated three rows above
 * 末吉's — and because "surprise me" places into these same slots, it
 * produced a duck that was wrong rather than one that was random.
 *
 * A single vertical offset would fix the hat and then push the bag off the
 * bottom of the smaller duck, because the error is a difference in SIZE,
 * not in position. So the reference point is read as a FRACTION of 小吉's
 * inked box and resolved against whichever duck is being decorated. Every
 * slot lands on the same part of the animal on all four, and a fifth duck
 * drawn later needs no table of its own.
 *
 * This lives here rather than beside the table because stickers.ts is
 * generated by tools/gen-stickers.py and would lose it on the next run.
 */

/** The sprite `SLOT_ORIGIN` was measured against. */
const SLOT_REFERENCE = "little";

function inkedBox(key: string): { x: number; y: number; w: number; h: number } {
  const rows = DUCKS[key] ?? DUCKS[SLOT_REFERENCE]!;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    });
  });
  // Spans, not indices — and never zero, so a one-pixel duck cannot divide by it.
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** Where a slot measured on 小吉 lands on the duck actually being decorated. */
export function slotOnDuck(origin: readonly [number, number], fortuneKey: string): [number, number] {
  const ref = inkedBox(SLOT_REFERENCE);
  const box = inkedBox(fortuneKey);
  return [
    Math.round(box.x + ((origin[0] - ref.x) / ref.w) * box.w),
    Math.round(box.y + ((origin[1] - ref.y) / ref.h) * box.h),
  ];
}
