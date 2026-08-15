/**
 * The people who bumped you, circling your duck.
 *
 * ══ A RING OF DUCKS, NOT A LIST OF NAMES ══
 * You find out that somebody bumped you by COMING BACK — there is no
 * notification, which is the whole point of a private link and no account.
 * So the one screen where you find out has to be worth arriving at, and a
 * number beside the word "bumps" is not.
 *
 * Everything here obeys the same rules as the pond it belongs to:
 *
 *   QUANTISED. Twenty-four stops around the circle, hard-switched, ticking
 *   every 420ms. A smooth orbit at 60fps would be the one thing on screen
 *   that is not stop-motion, and it would read as a loading spinner.
 *
 *   SQUASHED. The vertical radius is 0.74 of the horizontal, so it reads as
 *   a ring lying ON the water rather than a circle standing up in the air.
 *
 *   SNAPPED. Every duck lands on its own pixel grid. A sprite drawn at a
 *   fractional offset is resampled, and this pond never resamples anything.
 *
 * The maths is separate from the drawing so it can be checked without a
 * canvas: `orbitAt` is the whole layout, and it is pure.
 */

import { GRID, decodePaint } from "./codec.js";
import { drawDuck } from "./render.js";

/** Stops around the circle. Hard-switched, never interpolated. */
export const STOPS = 24;
/** How long one stop lasts. Slower than the pond's own tick: this is idle. */
export const STEP_MS = 420;
/** Ticks per stop, so the ring turns slowly enough to read the names. */
const TICKS_PER_STOP = 3;
/*
 * ══ THEY SPREAD BY HOW MANY THERE ARE ══
 * This was a fixed six stops apart, which is a quarter of the circle — and
 * the server returns up to FIVE bumpers. The fifth lands on 30 stops, which
 * is stop 6 again, exactly on top of the first: one duck drawn over another
 * with both names in the same place.
 *
 * The gap is the circle divided by however many turned up, so any number of
 * them is evenly spread and no two can ever coincide.
 */
/** A ring on water, not a hoop in the air. */
const SQUASH = 0.74;
/** Radius as a fraction of the canvas — clears the duck in the middle. */
const RADIUS = 0.38;

/**
 * The canvas edge, in pixels.
 *
 * Square, and drawn well above its display size — it is scaled DOWN by CSS
 * to fit a phone, and scaling a pixel sprite down is the one direction that
 * costs nothing.
 */
export const ORBIT_SIZE = 620;

/** Sprite pixels per side, for a duck in the ring and for yours. */
const ORBIT_CELL = 6;
const CENTRE_CELL = 10;

export interface OrbitSpot {
  /** Top-left of the sprite, already snapped to its own grid. */
  x: number;
  y: number;
  /** Facing the way it is going. */
  flip: boolean;
  /**
   * Whether this duck's name goes above it rather than below.
   *
   * ══ A LABEL BELONGS ON THE OUTSIDE OF THE RING ══
   * Always-below puts the top duck's name INSIDE the circle, straight over
   * the duck in the middle — so the one duck the screen is about wears
   * somebody else's name across it. Radiating outward, every label lands on
   * empty water and the middle stays clear.
   */
  labelAbove: boolean;
}

/**
 * Where the `i`th of `n` bumpers sits at tick `t`.
 *
 * `size` is the canvas edge in pixels; the ring is sized from it, so one
 * function serves any canvas.
 */
export function orbitAt(i: number, t: number, size: number, of = 4): OrbitSpot {
  const centre = size / 2;
  const radius = size * RADIUS;
  // Not a whole number of stops for every count, and that is fine: the
  // stops quantise the TURNING, not where each duck sits around the ring.
  const step = Math.floor(t / TICKS_PER_STOP) + (i * STOPS) / Math.max(1, of);
  const angle = ((step % STOPS) / STOPS) * Math.PI * 2;

  const x = centre + Math.cos(angle) * radius - (GRID * ORBIT_CELL) / 2;
  const y = centre + Math.sin(angle) * radius * SQUASH - (GRID * ORBIT_CELL) / 2;
  return {
    x: Math.round(x / ORBIT_CELL) * ORBIT_CELL,
    y: Math.round(y / ORBIT_CELL) * ORBIT_CELL,
    // Going left means facing left. Without this they moonwalk half the way
    // round, which is the sort of thing you feel before you can name.
    flip: Math.cos(angle) < 0,
    // Above the centre line means the name goes above the duck: away from
    // the middle, where there is nothing to collide with.
    labelAbove: Math.sin(angle) < 0,
  };
}

export interface OrbitDuck {
  name: string;
  fortune: number;
  tint: number;
  paint?: string;
  stickers?: { id: string; x: number; y: number }[];
}

/**
 * Draw one frame: your duck in the middle, everyone who bumped it around.
 *
 * `t` is a tick count, not a timestamp — the caller owns the clock, so a
 * paused screen simply stops calling and nothing has to be told.
 */
export function drawOrbit(
  ctx: CanvasRenderingContext2D,
  mine: OrbitDuck,
  wavers: readonly OrbitDuck[],
  t: number,
  size: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);

  /*
   * The label floor. ~12 display pixels once the canvas is scaled down to
   * fit a phone — below that a name is decoration rather than something a
   * person is meant to read, and the whole point is that these are people.
   */
  const fontSize = Math.round(size * 0.042);

  wavers.forEach((w, i) => {
    const at = orbitAt(i, t, size, wavers.length);
    drawDuck(
      ctx,
      {
        fortune: w.fortune, tint: w.tint,
        paint: w.paint ? decodePaint(w.paint) : null,
        stickers: w.stickers ?? null,
        flip: at.flip,
      },
      at.x, at.y, ORBIT_CELL,
    );

    if (!w.name) return;
    // A name on a white chip, because it lands on water as often as not.
    ctx.font = `600 ${fontSize}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const width = ctx.measureText(w.name).width;
    const chipH = fontSize * 1.45;
    /*
     * Kept inside the canvas. A name can be eighteen characters, and a
     * chip centred on a duck at the left or right of the ring runs off the
     * edge — so the longest names, which are the ones hardest to read
     * anyway, were the ones getting cut in half.
     */
    const half = width / 2 + fontSize * 0.45;
    const bx = Math.min(
      size - half,
      Math.max(half, at.x + (GRID * ORBIT_CELL) / 2),
    );
    const by = at.labelAbove
      ? at.y - fontSize * 0.35 - chipH
      : at.y + GRID * ORBIT_CELL + fontSize * 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(bx - width / 2 - fontSize * 0.45, by, width + fontSize * 0.9, chipH);
    ctx.fillStyle = "#0b3d52";
    ctx.fillText(w.name, bx, by + fontSize * 0.22);
  });

  // Yours, in the middle, bigger — and drawn last so nothing orbits over it.
  const half = (GRID * CENTRE_CELL) / 2;
  drawDuck(
    ctx,
    {
      fortune: mine.fortune, tint: mine.tint,
      paint: mine.paint ? decodePaint(mine.paint) : null,
      stickers: mine.stickers ?? null,
    },
    Math.round((size / 2 - half) / CENTRE_CELL) * CENTRE_CELL,
    Math.round((size / 2 - half) / CENTRE_CELL) * CENTRE_CELL,
    CENTRE_CELL,
  );

  // Canvas text state is global; leave it as it was found.
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/** Matches --mono in app.css. */
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
