/**
 * The pond camera.
 *
 * ══ EVERY RULE HERE WAS BOUGHT WITH A BUG ══
 * docs/pond/POND-CAMERA.md is the reasoning; this is the implementation, and
 * it follows that document rather than improving on it. The changelog in
 * UI.md records what each rule cost: "deleting clamping deleted most of the
 * camera bugs in this project". Rewriting any of this from first principles
 * is how those bugs come back.
 *
 * The five that matter, and what breaks without them:
 *
 *  1. **Zoom is an integer.** At 4.7 pixels per sprite pixel, some pixels
 *     land on 4 and their neighbours on 5, so outlines crawl. Smooth motion
 *     comes from rendering at the NEAREST integer and applying the leftover
 *     as a CSS scale.
 *  2. **The world wraps.** No edges, no clamping. Every distance measures
 *     the short way round.
 *  3. **Position and zoom interpolate together**, one easing. Splitting them
 *     into "travel, then zoom" was tried, to work around a bug; it felt
 *     worse and the bug was the real problem.
 *  4. **Sprites quantise to CANVAS pixels, never the world grid.** Two rules
 *     meant every camera move ended with every duck snapping half a cell as
 *     the rule changed. A rule that changes is worse than either rule.
 *  5. **The world holds still during a camera move.** Otherwise ducks lurch
 *     underneath a gliding view and it reads as the zoom stuttering.
 */

/*
 * ══ EVERY NUMBER THAT DECIDES HOW THE POND FEELS ══
 * Each one lives beside the paragraph explaining it, because a tuning file
 * full of bare numbers is a file nobody can safely change. This is the map.
 *
 *   camera.ts   CELLS                       the zoom ladder, integers only
 *               HOME_CELL                   where the pond opens
 *               CAM_UI / CAM_MOMENT         glide durations, ms
 *               FLING_TAU                   how long a flick keeps going
 *               FLING_REST                  when it has stopped
 *               FLING_MAX_SCREEN_PX_PER_MS  the speed limit on a flick
 *               SETTLE_TAU                  pinch settling onto a rung
 *               OVERSCAN                    canvas margin beyond the frame
 *               worldSide / duckSpread      how big the pond is, and how
 *                                           far the ducks spread inside it
 *
 *   gestures.ts VELOCITY_WINDOW_MS          how far back a flick is measured
 *               TAP_SLOP_PX                 tap vs drag
 *               DOUBLE_TAP_MS / _SLOP_PX    double tap to zoom
 *
 *   app.css     --step-fade / --step-press  stepped DOM motion
 *               .p-canvas width/height      OVERSCAN's other half
 *
 * Changing any of these needs no other change. Changing CELLS to
 * non-integers does — see rule 1.
 */

/** Device pixels per sprite pixel. Integers only — see rule 1. */
export const CELLS = [2, 3, 4, 6, 8] as const;
export type Cell = (typeof CELLS)[number];
export const HOME_CELL: Cell = 4;

/** Anything answering a control: zoom, home, whistle, opening a duck card. */
export const CAM_UI = 480;
/** The one thing watched rather than operated: a duck being released. */
export const CAM_MOMENT = 1100;

/**
 * ══ INERTIA ══
 *
 * A flick keeps travelling and slows down, the way a thrown thing does. The
 * model is the one every platform settled on — EXPONENTIAL DECAY:
 *
 *   v *= exp(-dt / FLING_TAU)
 *
 * UIScrollView expresses the same thing as a per-millisecond
 * `decelerationRate`; 0.998 corresponds to a time constant of about 325 ms,
 * which is the number that reads as "normal" rather than icy or sticky.
 *
 * **There is no rubber-banding, and there never will be.** The world wraps,
 * so there are no edges to bounce off — which deletes the hardest part of
 * scroll physics. Do not add it back.
 */
export const FLING_TAU = 325;

/** Below this, in sprite pixels per ms, the flick has stopped. */
export const FLING_REST = 0.004;

/**
 * A flick can be as fast as a finger can move, which on a small world is a
 * teleport. Capped in SCREEN pixels per ms so the limit means the same
 * thing at every zoom.
 */
export const FLING_MAX_SCREEN_PX_PER_MS = 4;

/**
 * How long the pinch takes to settle onto a rung once the fingers lift.
 *
 * Zoom is an integer ladder; a pinch is continuous. The remainder renders
 * as a CSS scale, so mid-pinch is a legal state — it just is not a resting
 * one. Short, because it is the tail of a gesture rather than a move.
 */
export const SETTLE_TAU = 90;

/**
 * The canvas is drawn at 150% of its frame and clipped.
 *
 * A camera transform can translate as well as scale, and a translate slides
 * an edge into view however large the scale is. The margin means there is
 * always real, rendered water outside the visible edge to move into.
 */
export const OVERSCAN = 1.5;

export interface Camera {
  /** World coordinates at the centre of the view, in sprite pixels. */
  x: number;
  y: number;
  /** Continuous zoom. The integer part selects the render; the rest is CSS. */
  cell: number;
}

interface Move {
  from: Camera;
  to: Camera;
  start: number;
  ms: number;
}

/** A flick, decaying. Sprite pixels per millisecond. */
interface Fling {
  vx: number;
  vy: number;
  last: number;
}

/** One easing for both position and zoom — see rule 3. */
export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * How big the world is, in sprite pixels.
 *
 * More cards means a bigger pond, never a more crowded one. The 2.4× floor
 * exists so there is somewhere to drag to even when the pond is nearly
 * empty — without it the world equalled the frame at default zoom and
 * panning did nothing, which reads as broken rather than as "you have seen
 * it all".
 */
export function worldSide(frameSpritePx: number, ducks: number): number {
  return Math.max(frameSpritePx * 2.4, duckSpread(ducks));
}

/**
 * How far the POPULATION spreads, which is not the same as how far you can
 * pan.
 *
 * `worldSide` has a 2.4x floor so there is somewhere to drag to even when
 * the pond is nearly empty. Scattering ducks across all of that is a
 * different thing, and doing it put three ducks in a 1036-pixel world with
 * a 432-pixel window — an empty screen and no way to know which way to
 * look.
 *
 * So ducks occupy this much, centred, and the extra world is water around
 * them. More cards means a bigger pond, never a more crowded one; an empty
 * pond means a small crowd in a large lake, not three specks in a desert.
 */
export function duckSpread(ducks: number): number {
  return Math.ceil(Math.sqrt(Math.max(ducks, 1)) * 34);
}

/**
 * The shortest signed distance from `a` to `b` on a wrapping axis.
 *
 * This is what "the world wraps" actually means in arithmetic: a duck one
 * pixel off the left edge is one pixel away, not a world away. Every
 * distance in this file goes through here.
 */
export function wrapDelta(a: number, b: number, side: number): number {
  let d = (b - a) % side;
  if (d > side / 2) d -= side;
  if (d < -side / 2) d += side;
  return d;
}

/** Bring a coordinate back into [0, side). Never clamps — see rule 2. */
export function wrap(v: number, side: number): number {
  return ((v % side) + side) % side;
}

export class PondCamera {
  private move: Move | null = null;
  private flung: Fling | null = null;
  /** Set while fingers are on the glass, so the world holds still. */
  held = false;

  constructor(
    public cam: Camera = { x: 0, y: 0, cell: HOME_CELL },
    /** The world is square. */
    public side = 1,
  ) {}

  /**
   * Is anything moving the view right now?
   *
   * This is what drives BOTH the display-rate redraw and the world freeze,
   * and it deliberately includes a finger on the glass. Before it did, a
   * drag fell through to the 83 ms stop-motion path and tracked a thumb at
   * twelve frames a second — the exact thing POND-CAMERA's two-clocks rule
   * exists to prevent, and invisible in a screenshot.
   */
  get moving(): boolean {
    return this.move !== null || this.flung !== null || this.held || this.settling;
  }

  /** Mid-pinch, cell is off the ladder and easing back onto it. */
  private get settling(): boolean {
    return !this.held && Math.abs(this.cam.cell - nearestCell(this.cam.cell)) > 0.001;
  }

  /**
   * Start a move. Position and zoom travel together, one easing.
   *
   * The target is resolved through `wrapDelta`, so gliding to a duck near
   * the seam goes the short way round rather than scrolling the whole world.
   */
  glide(to: Partial<Camera>, ms = CAM_UI, now = performance.now()): void {
    const from = { ...this.cam };
    const target: Camera = {
      x: to.x === undefined ? from.x : from.x + wrapDelta(from.x, to.x, this.side),
      y: to.y === undefined ? from.y : from.y + wrapDelta(from.y, to.y, this.side),
      cell: to.cell === undefined ? from.cell : clampCell(to.cell),
    };
    this.move = { from, to: target, start: now, ms };
  }

  /** Jump with no animation. For arrival, and for a finger on the glass. */
  snap(to: Partial<Camera>): void {
    this.move = null;
    if (to.x !== undefined) this.cam.x = wrap(to.x, this.side);
    if (to.y !== undefined) this.cam.y = wrap(to.y, this.side);
    if (to.cell !== undefined) this.cam.cell = clampCell(to.cell);
  }

  /** Drag by a world delta, in sprite pixels. Wraps; never clamps. */
  pan(dxSprite: number, dySprite: number): void {
    this.move = null;
    this.flung = null;
    this.cam.x = wrap(this.cam.x - dxSprite, this.side);
    this.cam.y = wrap(this.cam.y - dySprite, this.side);
  }

  /**
   * Zoom about a point, keeping the world under it still.
   *
   * The anchor is what makes a pinch feel like handling the water rather
   * than operating a slider: whatever is between the fingers stays between
   * the fingers.
   *
   * `ax`/`ay` are offsets from the view centre in DEVICE pixels, because
   * that is what `cell` is denominated in — "device pixels per sprite
   * pixel". Passing CSS pixels instead under-corrects by exactly the
   * device-pixel ratio, which on a 2x screen is half: measured as 24.75
   * world pixels of drift at a 200-pixel anchor, which is
   * `200 x (2 - 1) x (1/8)` to the decimal.
   */
  zoomAbout(nextCell: number, ax: number, ay: number): void {
    this.move = null;
    const from = this.cam.cell;
    const to = clampCell(nextCell);
    if (to === from) return;
    // The world point under the anchor must not move: its offset from the
    // camera scales by exactly the zoom ratio.
    this.cam.x = wrap(this.cam.x + ax * (1 / from - 1 / to), this.side);
    this.cam.y = wrap(this.cam.y + ay * (1 / from - 1 / to), this.side);
    this.cam.cell = to;
  }

  /**
   * Zoom about a point, but TRAVEL there.
   *
   * `zoomAbout` lands instantly, which is right for a pinch: the fingers
   * are already moving continuously, so the camera must track them frame
   * for frame and any easing would lag behind the hand.
   *
   * A double tap is not continuous. It is a discrete request, like the zoom
   * buttons — and those glide. Landing it instantly made the pond jump,
   * which reads as a glitch rather than as a move, and loses the sense of
   * the water being a place you travel over.
   *
   * The destination is the same arithmetic `zoomAbout` does; the only
   * difference is that it is handed to `glide` instead of assigned.
   */
  glideAbout(nextCell: number, ax: number, ay: number, ms = CAM_UI): void {
    const from = this.cam.cell;
    const to = clampCell(nextCell);
    if (to === from) return;
    // Keep the world point under the anchor still: its offset from the
    // camera scales by exactly the zoom ratio.
    const k = 1 / from - 1 / to;
    this.glide(
      { x: wrap(this.cam.x + ax * k, this.side), y: wrap(this.cam.y + ay * k, this.side), cell: to },
      ms,
    );
  }

  /**
   * Release a flick. Velocity is in WORLD units per millisecond, already
   * measured across a buffer rather than from the last event — a single
   * delta is mostly sensor noise, and a finger that paused before lifting
   * must not fling.
   */
  fling(vx: number, vy: number, now = performance.now()): void {
    const speed = Math.hypot(vx, vy);
    if (speed < FLING_REST) return;
    const cap = (FLING_MAX_SCREEN_PX_PER_MS / this.cam.cell) / speed;
    const k = Math.min(1, cap);
    this.move = null;
    this.flung = { vx: vx * k, vy: vy * k, last: now };
  }

  /** A finger has landed: stop everything and hand over control. */
  grab(): void {
    this.move = null;
    this.flung = null;
    this.held = true;
  }

  release(): void {
    this.held = false;
  }

  /** Advance whatever is moving. Returns true while still animating. */
  tick(now = performance.now()): boolean {
    // A finger on the glass drives the camera directly; nothing to advance,
    // but the view is still "moving" so the world stays frozen.
    if (this.held) return true;

    if (this.flung) {
      const f = this.flung;
      const dt = Math.max(0, now - f.last);
      f.last = now;
      // Exponential decay — the model UIScrollView expresses as a
      // per-millisecond decelerationRate. tau = 325 ms reads as "normal".
      const decay = Math.exp(-dt / FLING_TAU);
      // Distance travelled while decaying over dt, in closed form, so the
      // result does not depend on frame rate.
      const travel = FLING_TAU * (1 - decay);
      this.cam.x = wrap(this.cam.x - f.vx * travel, this.side);
      this.cam.y = wrap(this.cam.y - f.vy * travel, this.side);
      f.vx *= decay;
      f.vy *= decay;
      if (Math.hypot(f.vx, f.vy) < FLING_REST) this.flung = null;
      this.settle(now, dt);
      return this.flung !== null || this.settling;
    }

    if (!this.move) {
      if (this.settling) {
        this.settle(now, 16);
        return true;
      }
      return false;
    }

    const m = this.move;

    const p = Math.min(1, (now - m.start) / m.ms);
    const e = easeInOutCubic(p);

    this.cam.x = wrap(m.from.x + (m.to.x - m.from.x) * e, this.side);
    this.cam.y = wrap(m.from.y + (m.to.y - m.from.y) * e, this.side);
    this.cam.cell = m.from.cell + (m.to.cell - m.from.cell) * e;

    if (p >= 1) {
      this.move = null;
      return false;
    }
    return true;
  }

  /**
   * Ease an off-ladder zoom back onto the nearest rung.
   *
   * Mid-pinch the cell is continuous, which is a legal render state — the
   * remainder is a CSS scale. It is not a legal RESTING state, because at
   * rest an integer cell is what keeps outlines from crawling.
   */
  private settle(now: number, dt: number): void {
    if (this.held) return;
    const target = nearestCell(this.cam.cell);
    const k = 1 - Math.exp(-dt / SETTLE_TAU);
    this.cam.cell += (target - this.cam.cell) * k;
    if (Math.abs(this.cam.cell - target) < 0.001) this.cam.cell = target;
  }

  /**
   * How to draw this frame.
   *
   * `renderCell` is the integer the canvas is drawn at; `scale` is the
   * leftover, applied as a CSS transform about the centre. The remainder is
   * at most ±25%, which the overscan covers — so the render is always on an
   * integer grid and the motion is still continuous.
   */
  frame(): { renderCell: Cell; scale: number } {
    const nearest = nearestCell(this.cam.cell);
    return { renderCell: nearest, scale: this.cam.cell / nearest };
  }

  /** The next zoom step in or out, or null at the end of the range. */
  step(direction: 1 | -1): Cell | null {
    const i = CELLS.indexOf(nearestCell(this.cam.cell));
    const next = CELLS[i + direction];
    return next ?? null;
  }
}

/** The nearest legal integer zoom. */
export function nearestCell(cell: number): Cell {
  let best: Cell = CELLS[0];
  let bestD = Infinity;
  for (const c of CELLS) {
    const d = Math.abs(c - cell);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function clampCell(cell: number): number {
  return Math.max(CELLS[0], Math.min(CELLS[CELLS.length - 1]!, cell));
}

/**
 * Where a world point lands on the canvas, in CANVAS pixels.
 *
 * Rounded here and nowhere else — rule 4. Sprites quantise to canvas pixels,
 * never to the world grid: snapping to `round(x) * CELL` locks a duck to
 * multiples of CELL, so it jumps in CELL-sized steps whenever the view
 * moves.
 *
 * `canvasW`/`canvasH` are the OVERSCANNED dimensions. Anything measuring a
 * fraction of what a person can actually see must use the visible frame
 * instead — measuring "a third of the way down" against the canvas put a
 * duck 5% down the screen, behind the notch.
 */
export function project(
  wx: number,
  wy: number,
  cam: Camera,
  renderCell: number,
  canvasW: number,
  canvasH: number,
  side: number,
): { x: number; y: number } {
  const dx = wrapDelta(cam.x, wx, side);
  const dy = wrapDelta(cam.y, wy, side);
  return {
    x: Math.round(canvasW / 2 + dx * renderCell),
    y: Math.round(canvasH / 2 + dy * renderCell),
  };
}
