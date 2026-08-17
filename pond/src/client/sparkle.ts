/**
 * The sparkle engine — moved from byproductlab.com, not reinvented.
 *
 * SCREENS.md § 06 is explicit about this: "Not new animation — the sparkle
 * engine already on byproductlab.com, moved." The shapes, the schedule and
 * the constants come from that site's `Base.astro`, so an arrival in the
 * pond and a sparkle on the shop are recognisably the same hand. Anything
 * invented here instead would be a second dialect of the same idea, which
 * is worse than either.
 *
 * ══ EVERY PIXEL IS SCHEDULED BY ITS DISTANCE FROM THE CENTRE ══
 * A shape builds outward and unbuilds outward, one pixel at a time, on
 * `steps(1)`. Nothing fades: a pixel is on or it is off.
 *
 *   on   = d·36ms + jitter        builds centre → out
 *   HOLD = 170ms                  the whole shape is always seen
 *   off  = onMax + HOLD + d·42ms  unbuilds centre → out
 *
 * **That 170 ms hold is the whole thing.** Without it the pixels are still
 * arriving as the first ones leave, and the shape never exists as a shape —
 * it reads as twinkle rather than as something deliberate appearing.
 *
 * The distance is MANHATTAN, not Euclidean. On a 9×9 grid that is what
 * makes a bloom open as a diamond rather than as a disc, which is the
 * difference between pixel art and a circle drawn with pixels.
 */

/** Per-pixel delay outward, building. */
const ON_PER_PX = 36;
/** Per-pixel delay outward, unbuilding. Slower, so it lingers. */
const OFF_PER_PX = 42;
/** The whole shape is seen for this long before it starts leaving. */
const HOLD = 170;
/** A tail after the last pixel leaves, so the shape is not cut off. */
const TAIL = 80;
/** Under reduced motion the whole shape is simply shown, for this long. */
const STATIC_MS = 420;

/**
 * The shapes, as they are drawn on the shop.
 *
 * `p` is the petal colour, `c` the core. `r` in the sun is a ray, and
 * deliberately takes the petal colour — the rule is "core or not", so a
 * third letter costs nothing and reads better in the source.
 */
export const SHAPES = {
  bloom: [
    "....p....", "...ppp...", "..ppppp..", ".ppcccpp.", "ppccpccpp",
    ".ppcccpp.", "..ppppp..", "...ppp...", "....p....",
  ],
  flower: [".ppp.", "ppppp", "ppcpp", "ppppp", ".ppp."],
  sparkle: ["...p...", "...p...", "...p...", "pppcppp", "...p...", "...p...", "...p..."],
  ring: ["...p...", "..p.p..", ".p...p.", "p..c..p", ".p...p.", "..p.p..", "...p..."],
  sun: [
    "....r....", ".r..r..r.", "...ccc...", "..ccccc..", "r.ccccc.r",
    "..ccccc..", "...ccc...", ".r..r..r.", "....r....",
  ],
  cloud: ["...ppp.....", "..ppppppp..", ".ppppppppp.", "ppppppppppp", ".pp.ppp.pp."],
} as const;

export interface SparklePixel {
  /** World position, already offset from the shape's centre. */
  x: number;
  y: number;
  colour: string;
  /** When this pixel appears and disappears, relative to the arrival. */
  on: number;
  off: number;
  /** Sprite pixels per side. The shop draws some shapes at 1.5. */
  size: number;
  /** A flower petal, which may fall off when the flower goes. See `shed`. */
  sheds: boolean;
}

/**
 * Schedule one shape's pixels into `list`.
 *
 * `cell` is the shop's own scale knob: the drawn pixel is `cell / 2` sprite
 * pixels, so 2 draws at 1 and 3 draws at 1.5. Keeping its odd units means
 * the numbers below can be copied from `Base.astro` unchanged, which is the
 * point of porting rather than rewriting.
 *
 * `random` is injectable so the jitter can be pinned in a test.
 */
export function spawnShape(
  list: SparklePixel[],
  x: number,
  y: number,
  shape: readonly string[],
  petal: string,
  core: string,
  cell: number,
  delay = 0,
  random: () => number = Math.random,
): void {
  const rows = shape.length;
  const cols = shape[0]!.length;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const size = cell / 2;

  const cells: { x: number; y: number; d: number; core: boolean }[] = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const ch = shape[ry]![rx];
      if (ch === "." || ch === undefined) continue;
      // Manhattan: a diamond, not a disc.
      cells.push({ x: rx, y: ry, d: Math.abs(rx - cx) + Math.abs(ry - cy), core: ch === "c" });
    }
  }
  if (!cells.length) return;

  const onMax = Math.max(...cells.map((c) => c.d)) * ON_PER_PX + 28;
  // Only a flower sheds, and only its petals. The shop identifies a flower
  // by its width, which is fine there and too clever to copy: the caller
  // knows what it asked for, so the shape itself is compared.
  const isFlower = shape === SHAPES.flower;
  for (const c of cells) {
    list.push({
      // Placed from the shape's own centre, in sprite units.
      x: x + (c.x - cols / 2) * size,
      y: y + (c.y - rows / 2) * size,
      colour: c.core ? core : petal,
      on: delay + Math.round(c.d * ON_PER_PX + random() * 28),
      // Everything waits for the slowest pixel, holds, then leaves outward.
      off: delay + Math.round(onMax + HOLD + c.d * OFF_PER_PX + random() * 36),
      size,
      sheds: isFlower && !c.core,
    });
  }
}

/** How long a set of shapes runs for, so the caller knows when it is done. */
export function duration(pixels: SparklePixel[]): number {
  return pixels.reduce((m, p) => Math.max(m, p.off), 0) + TAIL;
}

/** Under reduced motion the shape is simply present, then gone. */
export function visibleAt(p: SparklePixel, elapsed: number, reduced: boolean): boolean {
  return reduced ? elapsed < STATIC_MS : elapsed >= p.on && elapsed < p.off;
}

/* ── the four arrivals, exactly as the shop stages them ─────────────────── */

/**
 * The shop's own pair. 大吉 is the only arrival that wears it — the shapes
 * and the streamers both, so the burst is one colour idea rather than two
 * lists that drift apart the first time somebody retunes half of it.
 */
export const SHOP_PAIR = ["#3ac1f2", "#ffc831"] as const;
const WHITE = "#ffffff";

/**
 * The arrival for a fortune, scheduled and ready to draw.
 *
 * The offsets and delays are the shop's. They are not on a circle and not
 * evenly spaced, and that is deliberate: six shapes stepped 110ms apart at
 * hand-picked offsets read as a burst going off, where anything laid out
 * on a ring reads as a loading spinner.
 */
export function arrival(
  fortune: number,
  wx: number,
  wy: number,
  random: () => number = Math.random,
): SparklePixel[] {
  const out: SparklePixel[] = [];
  const at = (
    x: number, y: number, shape: readonly string[],
    petal: string, core: string, cell: number, delay: number,
  ) => spawnShape(out, wx + x, wy + y, shape, petal, core, cell, delay, random);

  if (fortune === 0) {
    // 大吉 — the loudest, and it should be: nobody else got this today.
    at(0, -16, SHAPES.sparkle, SHOP_PAIR[0], SHOP_PAIR[1], 3, 0);
    at(-18, -4, SHAPES.bloom, SHOP_PAIR[1], WHITE, 2, 110);
    at(16, -10, SHAPES.ring, WHITE, SHOP_PAIR[0], 3, 220);
    at(-6, -28, SHAPES.sparkle, SHOP_PAIR[1], WHITE, 2, 330);
    at(22, 8, SHAPES.bloom, SHOP_PAIR[0], SHOP_PAIR[1], 2, 440);
    at(-24, -20, SHAPES.ring, SHOP_PAIR[1], WHITE, 2, 560);
    return out;
  }

  if (fortune === 1) {
    // 小吉 — flowers bloom around the duck, and leave petals behind.
    at(-10, -12, SHAPES.flower, "#f2a9b4", "#f6e7a9", 2, 0);
    at(8, -6, SHAPES.flower, "#ffc2da", WHITE, 2, 180);
    at(-2, 6, SHAPES.flower, "#f2a9b4", "#f6e7a9", 2, 340);
    return out;
  }

  if (fortune === 2) {
    /*
     * 末吉 — a sun rises, and a cloud drifts over and covers it.
     * Non-committal, which is the point of 末吉. The cloud starts late so
     * it reads as arriving rather than as appearing.
     */
    at(-4, -26, SHAPES.sun, "#ffe07a", "#ffca00", 2, 0);
    at(-2, -24, SHAPES.cloud, WHITE, "#e6f4fa", 2, 620);
    return out;
  }

  /*
   * 凶 has no shapes at all. It arrives ALIGHT and the water puts it out —
   * which is physics, not decoration, and lives in pond-view with the fire.
   * Closing that loop with the object matters: on the card you watched a
   * duck catch fire, and the first thing the pond does is put it out.
   */
  return out;
}

/** 凶 burns for about three stop-motion frames before the water wins. */
export const BAD_LUCK_BURN_MS = 620;
/** And the mist comes off partway through, not at the end. */
export const BAD_LUCK_MIST_AT_MS = 480;

/**
 * 小吉 leaves petals — for about three minutes, drifting, and they dither
 * out rather than blinking away. The only arrival that leaves anything.
 */
export const PETAL_LIFE_MS = 3 * 60 * 1000;

/** How many of a flower's petals come loose when it goes. */
const SHED_CHANCE = 0.4;

export interface Petal {
  wx: number;
  wy: number;
  /** Sprite units per second, both axes. Petals do not fall in formation. */
  vx: number;
  vy: number;
  /** A clock reading: when this petal comes loose. */
  born: number;
  colour: string;
}

/**
 * The petals a set of arrival pixels will leave behind.
 *
 * ══ PETALS COME OUT OF THE FLOWERS, NOT OUT OF THIN AIR ══
 * The first version scattered nine petals on a ring around the duck the
 * moment it landed. That is the right number in the wrong place: what makes
 * this read as flowers SHEDDING is that each petal appears exactly where a
 * petal of the flower was, at the moment that flower stops being there. On
 * a ring they read as confetti, and confetti has nothing to do with 小吉.
 *
 * Deriving them here, up front, means the whole thing stays a schedule —
 * no per-frame bookkeeping about which flower has expired, and a petal
 * cannot be shed twice.
 */
export function petalsFrom(
  pixels: SparklePixel[],
  start: number,
  random: () => number = Math.random,
): Petal[] {
  const out: Petal[] = [];
  for (const p of pixels) {
    if (!p.sheds || random() >= SHED_CHANCE) continue;
    out.push({
      wx: p.x,
      wy: p.y,
      // Two axes, and small: a petal drifts, it does not travel.
      vx: (random() - 0.5) * 0.5,
      vy: (random() - 0.5) * 0.4,
      // The instant its own pixel stops being part of the flower.
      born: start + p.off,
      colour: p.colour,
    });
  }
  return out;
}

/** Sprite units per second per unit of a petal's velocity. */
export const PETAL_SPEED = 2;
