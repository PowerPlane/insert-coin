/**
 * The pond — the water, the ducks, and the finger on the glass.
 *
 * ══ TWO CLOCKS, ONE RENDER ══
 * The world ticks at ~12 fps because stop-motion is the look. The camera is
 * direct manipulation and has to track a finger at display rate. So the
 * camera redraws on `requestAnimationFrame` WHILE IT IS MOVING and not
 * otherwise; an idle pond costs one draw per stop-motion frame.
 *
 * And the world holds still for the length of a camera move — otherwise the
 * ducks lurch two or three times underneath a smoothly gliding view, which
 * reads as the zoom stuttering even though the zoom is fine.
 *
 * Placement is deliberately NOT random per frame: each duck's position is
 * derived from its own id, so the pond looks the same every time you open
 * it. A pond that rearranges itself between visits is not a place.
 */

import {
  CAM_MOMENT,
  CAM_UI,
  HOME_CELL,
  duckSpread,
  OVERSCAN,
  PondCamera,
  project,
  worldSide,
  wrap,
} from "./camera.js";
import {
  RIPPLE_MS,
  type Ripple,
  blitWater,
  createWaterBuffer,
  drawDuck,
  drawRipples,
  drawWater,
  prefersReducedMotion,
  type WaterBuffer,
} from "./render.js";
import { decodePaint } from "./codec.js";
import type { PondDuck } from "./types.js";

/** Stop-motion. The look, not a performance ceiling. */
const WORLD_FPS = 12;
const WORLD_MS = 1000 / WORLD_FPS;

/** How far apart ducks are kept, in sprite pixels. */
const SEPARATION = 30;

export interface Placed extends PondDuck {
  wx: number;
  wy: number;
  flip: boolean;
}

/**
 * A stable pseudo-random number from a duck's id.
 *
 * Every duck sits where its id says, so the pond is the same place each
 * time it is opened. Reshuffling on every load would make it a feed.
 */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Scatter the ducks, then push them apart.
 *
 * Best-candidate sampling would be better still, but separation on a
 * uniform grid is O(n) and enough at pond scale: what matters is that ducks
 * never overlap, because two ducks in the same water read as one duck with
 * a rendering bug.
 */
export function placeDucks(ducks: PondDuck[], side: number): Placed[] {
  // Ducks occupy the population area, centred in the world — NOT the whole
  // world, which has a floor of 2.4 frames so there is somewhere to drag to.
  // Scattering across all of it put three ducks in a 1036-pixel world seen
  // through a 432-pixel window: an empty screen, and no way to know which
  // way to look.
  const spread = Math.min(duckSpread(ducks.length), side);
  const origin = (side - spread) / 2;

  const placed: Placed[] = ducks.map((d) => {
    const a = hashId(d.id);
    const b = hashId(d.id + "y");
    return {
      ...d,
      wx: origin + a * spread,
      wy: origin + b * spread,
      flip: hashId(d.id + "f") > 0.5,
    };
  });

  // A few relaxation passes. More than this and it stops being worth it.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        let dx = b.wx - a.wx;
        let dy = b.wy - a.wy;
        // Separation has to respect the wrap, or ducks pile up along a seam
        // that does not exist.
        if (dx > side / 2) dx -= side;
        if (dx < -side / 2) dx += side;
        if (dy > side / 2) dy -= side;
        if (dy < -side / 2) dy += side;

        const dist = Math.hypot(dx, dy);
        if (dist >= SEPARATION || dist === 0) continue;

        const push = (SEPARATION - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.wx = wrap(a.wx - ux * push, side);
        a.wy = wrap(a.wy - uy * push, side);
        b.wx = wrap(b.wx + ux * push, side);
        b.wy = wrap(b.wy + uy * push, side);
      }
    }
  }

  return placed;
}

export interface PondViewOptions {
  canvas: HTMLCanvasElement;
  onTapDuck?: (duck: Placed) => void;
  onTapWater?: (wx: number, wy: number) => void;
}

export class PondView {
  readonly camera = new PondCamera({ x: 0, y: 0, cell: HOME_CELL }, 1);

  private ctx: CanvasRenderingContext2D;
  private water: WaterBuffer | null = null;
  private ducks: Placed[] = [];
  private ripples: Ripple[] = [];
  private frame = 0;
  private lastWorldTick = 0;
  private lastDebug = 0;
  private readonly debugging =
    typeof location !== "undefined" && location.search.includes("debug");
  private raf = 0;
  private running = false;
  /** Visible frame in sprite pixels — NOT the overscanned canvas. */
  private frameSprite = { w: 0, h: 0 };

  constructor(private readonly opts: PondViewOptions) {
    this.ctx = opts.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.attachGestures();
  }

  setDucks(ducks: PondDuck[]): void {
    const wasEmpty = this.ducks.length === 0;
    this.camera.side = worldSide(Math.max(this.frameSprite.w, this.frameSprite.h), ducks.length);
    this.ducks = placeDucks(ducks, this.camera.side);
    // Open looking at the ducks. The camera starts at the world origin,
    // which is a corner — and a corner of a pond 2.4 frames wide is water
    // with nothing in it.
    if (wasEmpty) this.camera.snap({ x: this.camera.side / 2, y: this.camera.side / 2 });
  }

  /** What the view actually believes, for debugging against a real browser. */
  debug(): Record<string, unknown> {
    const { renderCell, scale } = this.camera.frame();
    return {
      cam: { ...this.camera.cam },
      side: this.camera.side,
      renderCell,
      scale,
      frameSprite: this.frameSprite,
      canvas: [this.opts.canvas.width, this.opts.canvas.height],
      water: this.water ? [this.water.cols, this.water.rows] : null,
      ducks: this.ducks.map((d) => ({
        id: d.id,
        wx: Math.round(d.wx),
        wy: Math.round(d.wy),
        at: project(
          d.wx, d.wy, this.camera.cam, renderCell,
          this.opts.canvas.width, this.opts.canvas.height, this.camera.side,
        ),
      })),
    };
  }

  /** Find a duck by id, for the arrival zoom and the whistle. */
  find(id: string): Placed | undefined {
    return this.ducks.find((d) => d.id === id);
  }

  /**
   * Resize to the element, at 150% overscan.
   *
   * The camera addresses the canvas, but only the middle two-thirds is ever
   * seen. Anything measuring a fraction of what a person can see must use
   * `frameSprite` — measuring against the canvas put a duck 5% down the
   * screen, behind the notch.
   */
  resize(): void {
    const el = this.opts.canvas;
    // The ELEMENT is already 150% of the stage — `width: 150%` in app.css.
    // So the backing store is its own rect at device resolution, and
    // multiplying by OVERSCAN again here made the canvas 2.25x too large,
    // which is 2.25x too small a duck. Overscan lives in exactly one place:
    // the stylesheet.
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (el.width === w && el.height === h) return;

    el.width = w;
    el.height = h;
    this.ctx.imageSmoothingEnabled = false;

    const cell = this.camera.frame().renderCell;
    // The VISIBLE frame is the stage, which is the element divided back
    // down by the overscan — not the element itself. Measuring against the
    // element is what put a duck 5% down the screen, behind the notch.
    this.frameSprite = {
      w: (rect.width / OVERSCAN) * dpr / cell,
      h: (rect.height / OVERSCAN) * dpr / cell,
    };
    // Water is drawn at one water-pixel per sprite-pixel and scaled up.
    this.water = createWaterBuffer(Math.ceil(w / cell), Math.ceil(h / cell));
    this.camera.side = worldSide(
      Math.max(this.frameSprite.w, this.frameSprite.h),
      this.ducks.length,
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      const camMoving = this.camera.tick(now);

      // The world holds still while the camera moves — rule 5.
      if (!camMoving && now - this.lastWorldTick >= WORLD_MS) {
        this.lastWorldTick = now;
        this.frame++;
      }

      this.draw(now);

      // Publish state into the DOM, throttled, behind `?debug`.
      //
      // The pond is canvas, so none of this is inspectable otherwise. It
      // goes in the DOM rather than on `window` because a browser
      // automation tool evaluates in an ISOLATED WORLD: it shares the DOM
      // but not page globals, so a `window` handle reads back as undefined
      // from outside — and `window.pond` is doubly useless, because an
      // element with id="pond" already claims that name.
      if (this.debugging && now - this.lastDebug > 400) {
        this.lastDebug = now;
        this.opts.canvas.dataset.pond = JSON.stringify(this.debug());
      }

      // Display rate while moving or rippling; stop-motion otherwise.
      if (camMoving || this.ripples.length) {
        this.raf = requestAnimationFrame(loop);
      } else {
        this.raf = window.setTimeout(() => requestAnimationFrame(loop), WORLD_MS) as unknown as number;
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.raf);
  }

  /**
   * A ripple where something happened. Discrete rings, not a wave sim.
   *
   * Ripples are drawn INTO the water buffer, in buffer pixels, before it is
   * scaled up — so they dither with the water instead of sitting on top of
   * it as smooth circles. That is why this converts through the projection
   * rather than storing world coordinates.
   */
  splash(wx: number, wy: number, max = 14): void {
    this.ripples.push({ x: wx, y: wy, t: performance.now(), max });
  }

  /** Centre on a duck. `moment` is the one thing watched, not operated. */
  lookAt(id: string, moment = false): void {
    const d = this.find(id);
    if (!d) return;
    this.camera.glide({ x: d.wx, y: d.wy, cell: HOME_CELL }, moment ? CAM_MOMENT : CAM_UI);
  }

  private draw(now: number): void {
    const { canvas } = this.opts;
    const { renderCell, scale } = this.camera.frame();
    const { ctx } = this;

    if (this.water) {
      drawWater(this.water, this.frame);

      // Into the buffer, before the blit: a ripple should dither with the
      // water rather than sit on top of it as a smooth circle. Buffer
      // pixels are sprite pixels, so world coordinates convert by the same
      // projection the ducks use, divided back down by the cell size.
      if (this.ripples.length) {
        const inBuffer = this.ripples.map((r) => {
          const p = project(
            r.x, r.y, this.camera.cam, renderCell,
            canvas.width, canvas.height, this.camera.side,
          );
          return { ...r, x: Math.round(p.x / renderCell), y: Math.round(p.y / renderCell) };
        });
        drawRipples(this.water, inBuffer, now);
      }

      blitWater(ctx, this.water, canvas.width, canvas.height);
    }

    // Back to front, so a duck lower in the water overlaps one above it.
    const sorted = [...this.ducks].sort((a, b) => a.wy - b.wy);
    for (const d of sorted) {
      const p = project(
        d.wx, d.wy, this.camera.cam, renderCell,
        canvas.width, canvas.height, this.camera.side,
      );
      // Cheap cull. The overscan means "off canvas" is genuinely invisible.
      const pad = 24 * renderCell;
      if (p.x < -pad || p.y < -pad || p.x > canvas.width + pad || p.y > canvas.height + pad) {
        continue;
      }
      drawDuck(
        ctx,
        {
          fortune: d.fortune,
          tint: d.tint,
          paint: d.paint ? decodePaint(d.paint) : null,
          stickers: d.stickers,
          burning: d.burning,
          flip: d.flip,
          // Reduced motion never removes information — a still duck is
          // still a duck, it just does not walk.
          frame: prefersReducedMotion() ? 0 : this.frame,
        },
        p.x - 12 * renderCell,
        p.y - 12 * renderCell,
        renderCell,
      );
    }

    this.ripples = this.ripples.filter((r) => now - r.t < RIPPLE_MS);

    // The sub-integer remainder ONLY. The render stays on an integer grid;
    // the motion stays continuous. Dividing by OVERSCAN here was wrong —
    // the element's 150% width already places it, and scaling it back down
    // shrank every duck by a further third on top of the backing-store bug.
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  /** Drag to pan, tap to open. A tap is a press that did not travel far. */
  private attachGestures(): void {
    const el = this.opts.canvas;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const spritePerPx = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return dpr / this.camera.frame().renderCell;
    };

    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = spritePerPx();
      this.camera.pan(dx * k, dy * k);
    });

    el.addEventListener("pointerup", (e) => {
      dragging = false;
      // 8 px of slop: a finger never holds perfectly still, and a tap that
      // needs stillness reads as an unresponsive button.
      if (moved > 8) return;

      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { renderCell } = this.camera.frame();
      const cx = (e.clientX - rect.left) * dpr;
      const cy = (e.clientY - rect.top) * dpr;
      // Screen to world, through the same projection used to draw.
      const wx = wrap(this.camera.cam.x + (cx - (rect.width * dpr) / 2) / renderCell, this.camera.side);
      const wy = wrap(this.camera.cam.y + (cy - (rect.height * dpr) / 2) / renderCell, this.camera.side);

      const hit = this.hitTest(wx, wy);
      if (hit) this.opts.onTapDuck?.(hit);
      else this.opts.onTapWater?.(wx, wy);
    });
  }

  /** Nearest duck within a forgiving radius. Front-most wins. */
  private hitTest(wx: number, wy: number): Placed | undefined {
    let best: Placed | undefined;
    let bestD = 16; // sprite pixels — a duck is 24 wide
    for (const d of this.ducks) {
      let dx = d.wx - wx;
      let dy = d.wy - wy;
      const s = this.camera.side;
      if (dx > s / 2) dx -= s;
      if (dx < -s / 2) dx += s;
      if (dy > s / 2) dy -= s;
      if (dy < -s / 2) dy += s;
      const dist = Math.hypot(dx, dy);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }
}
