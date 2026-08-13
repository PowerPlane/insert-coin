/**
 * The sparkle engine — moved, not rewritten.
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
 * it reads as twinkle rather than as something deliberate appearing. It is
 * exactly what a rewrite loses, so it is a named constant here and FLOW.md
 * says so too.
 */

/** Per-pixel delay outward, building. */
const ON_PER_PX = 36;
/** Per-pixel delay outward, unbuilding. Slower, so it lingers. */
const OFF_PER_PX = 42;
/** The whole shape is seen for this long before it starts leaving. */
const HOLD = 170;

export interface SparklePixel {
  x: number;
  y: number;
  colour: string;
  /** When this pixel appears and disappears, relative to the shape's start. */
  on: number;
  off: number;
}

export interface Shape {
  /** Sprite-pixel offsets from the shape's own centre. */
  cells: { x: number; y: number; colour: string }[];
  /** Where the shape sits, in world coordinates. */
  wx: number;
  wy: number;
  /** When the shape starts, relative to the arrival. */
  at: number;
}

/**
 * Schedule a shape's pixels.
 *
 * The jitter is deterministic per pixel rather than random per frame: a
 * shape that re-schedules itself every draw shimmers, which is the exact
 * opposite of stop-motion.
 */
export function schedule(shape: Shape): SparklePixel[] {
  let maxOn = 0;
  const withDistance = shape.cells.map((c) => {
    const d = Math.hypot(c.x, c.y);
    const jitter = ((Math.abs(c.x * 31 + c.y * 17) % 7) - 3) * 6;
    const on = Math.max(0, d * ON_PER_PX + jitter);
    maxOn = Math.max(maxOn, on);
    return { ...c, d, on };
  });

  return withDistance.map((c) => ({
    x: c.x,
    y: c.y,
    colour: c.colour,
    on: shape.at + c.on,
    // Everything waits for the slowest pixel, holds, then leaves outward.
    off: shape.at + maxOn + HOLD + c.d * OFF_PER_PX,
  }));
}

/** How long a set of shapes runs for, so the caller knows when it is done. */
export function duration(pixels: SparklePixel[]): number {
  return pixels.reduce((m, p) => Math.max(m, p.off), 0);
}

/* ── the four arrivals ─────────────────────────────────────────────────── */

const GOLD = ["#FFCA00", "#FFE9A8", "#FF8953"];
const PETAL = ["#FF6FA5", "#FF8FB8", "#FFFFFF"];
const SUN = ["#FFCA00", "#FFE9A8"];
const CLOUD = ["#FFFFFF", "#C9D6DC"];

/** A ring of pixels, which is what a firework and a flower both are. */
function ring(radius: number, count: number, colours: string[], phase = 0) {
  return Array.from({ length: count }, (_, i) => {
    const a = phase + (i / count) * Math.PI * 2;
    return {
      x: Math.round(Math.cos(a) * radius),
      y: Math.round(Math.sin(a) * radius),
      colour: colours[i % colours.length]!,
    };
  });
}

/**
 * 大吉 — pixel fireworks. Seven shapes over 700 ms, two waves of radiating
 * pixels. The loudest by a distance, and it should be: this is the one
 * fortune nobody else got today.
 */
function greatLuck(wx: number, wy: number): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const spread = 14 + (i % 3) * 5;
    shapes.push({
      wx: wx + Math.cos(a) * spread,
      wy: wy + Math.sin(a) * spread * 0.7,
      at: (i / 7) * 700,
      // Two waves: an inner burst and an outer one behind it.
      cells: [...ring(3, 8, GOLD), ...ring(6, 12, GOLD, 0.26)],
    });
  }
  return shapes;
}

/** 小吉 — flowers bloom around the duck, and leave petals behind. */
function littleLuck(wx: number, wy: number): Shape[] {
  return [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    return {
      wx: wx + Math.cos(a) * 13,
      wy: wy + Math.sin(a) * 9,
      at: i * 160,
      cells: [{ x: 0, y: 0, colour: "#FFCA00" }, ...ring(2, 6, PETAL)],
    };
  });
}

/**
 * 末吉 — a sun rises, and a cloud drifts over and covers it.
 *
 * Non-committal, which is the point of 末吉. The cloud starts late and off
 * to one side so it reads as arriving rather than as appearing.
 */
function uncertain(wx: number, wy: number): Shape[] {
  return [
    {
      wx, wy: wy - 14, at: 0,
      cells: [...ring(4, 10, SUN), ...ring(6, 14, SUN, 0.3)],
    },
    {
      wx: wx + 8, wy: wy - 12, at: 520,
      cells: [
        ...ring(3, 8, CLOUD),
        { x: -4, y: 1, colour: CLOUD[0]! },
        { x: 4, y: 1, colour: CLOUD[1]! },
        { x: 0, y: 2, colour: CLOUD[0]! },
      ],
    },
  ];
}

/**
 * 凶 — arrives already burning, and the water puts it out in mist.
 *
 * This closes the loop with the object: on the card you watched a duck
 * catch fire, and the first thing the pond does is put it out. Nobody has
 * to be told that.
 */
function badLuck(wx: number, wy: number): Shape[] {
  return [
    {
      wx, wy: wy - 10, at: 0,
      cells: [...ring(2, 6, ["#FF4B4B", "#FF8953"]), ...ring(4, 9, ["#FF8953"], 0.4)],
    },
    {
      wx, wy: wy - 4, at: 420,
      cells: [...ring(5, 12, ["#FFFFFF", "#EDFAFE"]), ...ring(8, 16, ["#EDFAFE"], 0.2)],
    },
  ];
}

/** The arrival for a fortune, scheduled and ready to draw. */
export function arrival(fortune: number, wx: number, wy: number): SparklePixel[] {
  const shapes =
    fortune === 0 ? greatLuck(wx, wy)
    : fortune === 1 ? littleLuck(wx, wy)
    : fortune === 2 ? uncertain(wx, wy)
    : badLuck(wx, wy);

  // Each shape's pixels carry their own world position, so the caller does
  // not have to track which shape a pixel belonged to.
  return shapes.flatMap((s) =>
    schedule(s).map((p) => ({ ...p, x: s.wx + p.x, y: s.wy + p.y })),
  );
}

/**
 * 小吉 leaves petals — for about three minutes, drifting, and they dither
 * out rather than blinking away. The only arrival that leaves anything.
 */
export const PETAL_LIFE_MS = 3 * 60 * 1000;

export interface Petal {
  wx: number;
  wy: number;
  drift: number;
  born: number;
  colour: string;
}

export function petals(wx: number, wy: number, now: number): Petal[] {
  return Array.from({ length: 9 }, (_, i) => ({
    wx: wx + Math.cos((i / 9) * Math.PI * 2) * (8 + (i % 3) * 4),
    wy: wy + Math.sin((i / 9) * Math.PI * 2) * (6 + (i % 2) * 3),
    // A gentle sideways drift, different per petal so they do not move as
    // one sheet.
    drift: ((i % 5) - 2) * 0.0022,
    born: now,
    colour: PETAL[i % PETAL.length]!,
  }));
}
