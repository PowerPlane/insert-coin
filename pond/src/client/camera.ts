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

/** Device pixels per sprite pixel. Integers only — see rule 1. */
export const CELLS = [2, 3, 4, 6, 8] as const;
export type Cell = (typeof CELLS)[number];
export const HOME_CELL: Cell = 4;

/** Anything answering a control: zoom, home, whistle, opening a duck card. */
export const CAM_UI = 480;
/** The one thing watched rather than operated: a duck being released. */
export const CAM_MOMENT = 1100;

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
  return Math.max(frameSpritePx * 2.4, Math.ceil(Math.sqrt(Math.max(ducks, 1)) * 34));
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

  constructor(
    public cam: Camera = { x: 0, y: 0, cell: HOME_CELL },
    /** The world is square. */
    public side = 1,
  ) {}

  /** True while a move is running — the world holds still meanwhile (rule 5). */
  get moving(): boolean {
    return this.move !== null;
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

  /** Drag by a screen delta, in sprite pixels. Wraps; never clamps. */
  pan(dxSprite: number, dySprite: number): void {
    this.move = null;
    this.cam.x = wrap(this.cam.x - dxSprite, this.side);
    this.cam.y = wrap(this.cam.y - dySprite, this.side);
  }

  /** Advance any running move. Returns true while still animating. */
  tick(now = performance.now()): boolean {
    const m = this.move;
    if (!m) return false;

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
