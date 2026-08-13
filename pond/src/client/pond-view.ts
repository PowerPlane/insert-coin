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
  easeInOutCubic,
  HOME_CELL,
  OVERSCAN,
  PondCamera,
  duckSpread,
  project,
  worldSide,
  wrap,
  wrapDelta,
} from "./camera.js";
import { Gestures } from "./gestures.js";
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
import {
  PETAL_LIFE_MS,
  type Petal,
  type SparklePixel,
  arrival,
  duration as sparkleDuration,
  petals,
} from "./sparkle.js";
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
  /** Where the duck is being pulled to, while a whistle is active. */
  tx?: number;
  ty?: number;
  /** Where it lives when nobody is whistling. */
  homeX?: number;
  homeY?: number;
  /** Where this leg of the journey started. Cleared when it arrives. */
  gx?: number;
  gy?: number;
}

/** How long a duck takes to arc in, or back out again. */
const GATHER_MS = 900;

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
  private readonly gestures: Gestures;
  private water: WaterBuffer | null = null;
  private ducks: Placed[] = [];
  private ripples: Ripple[] = [];
  private frame = 0;
  private lastWorldTick = 0;
  private lastDebug = 0;
  private gatherStart = 0;
  private sparkles: SparklePixel[] = [];
  private sparkleStart = 0;
  private petals: Petal[] = [];
  private readonly debugging =
    typeof location !== "undefined" && location.search.includes("debug");
  // Two different kinds of handle. Holding both in one field and cancelling
  // it as both was an id-collision waiting to happen: cancelAnimationFrame
  // and clearTimeout share a numeric space, so stopping the view could
  // cancel an unrelated animation somewhere else on the page.
  private raf = 0;
  private timer = 0;
  private running = false;
  /** Visible frame in sprite pixels — NOT the overscanned canvas. */
  private frameSprite = { w: 0, h: 0 };

  constructor(private readonly opts: PondViewOptions) {
    this.ctx = opts.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.gestures = new Gestures(opts.canvas, {
      // The CONTINUOUS cell, not the render cell. Mid-pinch they differ by
      // up to 25%, and every screen-to-world conversion would be wrong by
      // that much — taps landing on the wrong duck, drags outrunning the
      // finger.
      scale: () => this.camera.cam.cell / this.dpr(),
      dpr: () => this.dpr(),
      camera: this.camera,
      onTap: (cx, cy) => this.tap(cx, cy),
    });
  }

  private dpr(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  /** Screen point to world point, through the same numbers used to draw. */
  private toWorld(clientX: number, clientY: number): { wx: number; wy: number } {
    const rect = this.opts.canvas.getBoundingClientRect();
    const cell = this.camera.cam.cell / this.dpr();
    return {
      wx: wrap(this.camera.cam.x + (clientX - (rect.left + rect.width / 2)) / cell, this.camera.side),
      wy: wrap(this.camera.cam.y + (clientY - (rect.top + rect.height / 2)) / cell, this.camera.side),
    };
  }

  private tap(clientX: number, clientY: number): void {
    const { wx, wy } = this.toWorld(clientX, clientY);
    const hit = this.hitTest(wx, wy);
    if (hit) this.opts.onTapDuck?.(hit);
    else this.opts.onTapWater?.(wx, wy);
  }

  /**
   * Take a fresh pond from the server.
   *
   * ══ A DUCK ALREADY HERE KEEPS WHERE IT IS ══
   * The pond is polled every twenty seconds, and re-placing everything on
   * each poll threw away anything that had moved a duck since — most
   * visibly the whistle, which survived exactly until the next refresh and
   * then silently put everyone back. Placement is deterministic so nothing
   * jumped, which is what made it hard to see rather than easy.
   *
   * So: known ducks keep their position and whatever the whistle did to
   * them, new ducks are placed, and departed ones are dropped.
   */
  setDucks(ducks: PondDuck[]): void {
    const wasEmpty = this.ducks.length === 0;
    const previous = new Map(this.ducks.map((d) => [d.id, d]));

    this.camera.side = worldSide(Math.max(this.frameSprite.w, this.frameSprite.h), ducks.length);
    const placed = placeDucks(ducks, this.camera.side);

    this.ducks = placed.map((fresh) => {
      const old = previous.get(fresh.id);
      if (!old) return fresh;
      // Server-side facts are new; where it sits is ours.
      return {
        ...fresh,
        wx: old.wx, wy: old.wy, flip: old.flip,
        tx: old.tx, ty: old.ty,
        homeX: old.homeX, homeY: old.homeY,
        gx: old.gx, gy: old.gy,
      };
    });

    // Open looking at the ducks. The camera starts at the world origin,
    // which is a corner — and a corner of a pond 2.4 frames wide is water
    // with nothing in it.
    if (wasEmpty) this.camera.snap({ x: this.camera.side / 2, y: this.camera.side / 2 });
  }

  /**
   * The whistle.
   *
   * In the Wii Mii Plaza you blow a whistle and every Mii runs over. The
   * card is already a thing you blow into, so the pond borrows the gesture
   * — and the duck COUNT is the whistle, so it costs no chrome over the
   * water.
   *
   * Two details that are the whole difference between a flock and a bug:
   *
   *  1. **Called ducks aim at their own spot on a loose ring**, not at one
   *     point. A crowd converging on a single point packs into a hexagonal
   *     lattice and reads as a crystal.
   *
   *  2. **Everyone else is pushed CLEAR OF THE FRAME, not dimmed.** A faded
   *     duck still reads as being in the way. They fan around the rim
   *     rather than jamming into a corner, and clearing the whistle pulls
   *     them back, so the pond refills.
   */
  gather(match: ((d: Placed) => boolean) | null): void {
    const { side } = this.camera;
    const cx = this.camera.cam.x;
    const cy = this.camera.cam.y;

    for (const d of this.ducks) {
      // Remember home once, so repeated whistles do not drift the pond.
      d.homeX ??= d.wx;
      d.homeY ??= d.wy;
    }

    if (!match) {
      for (const d of this.ducks) {
        d.tx = d.homeX;
        d.ty = d.homeY;
      }
      this.gatherStart = performance.now();
      return;
    }

    const called = this.ducks.filter(match);
    const rest = this.ducks.filter((d) => !match(d));

    // A ring sized to the crowd, so twenty ducks are not stacked and three
    // are not scattered across the horizon.
    const radius = Math.max(24, Math.min(this.frameSprite.w, this.frameSprite.h) * 0.28);
    called.forEach((d, i) => {
      const a = (i / Math.max(called.length, 1)) * Math.PI * 2;
      // A little jitter per duck, so the ring is a gathering rather than a
      // dial. Derived from the id, so it does not shimmer between frames.
      const wobble = 0.82 + 0.36 * hashId(d.id + "r");
      d.tx = wrap(cx + Math.cos(a) * radius * wobble, side);
      d.ty = wrap(cy + Math.sin(a) * radius * wobble, side);
    });

    // Everyone else fans around the rim, outside the frame, keeping their
    // own angle so they go the short way out and come back the same way.
    const out = Math.max(this.frameSprite.w, this.frameSprite.h) * 0.78;
    rest.forEach((d) => {
      const a = hashId(d.id + "o") * Math.PI * 2;
      d.tx = wrap(cx + Math.cos(a) * out, side);
      d.ty = wrap(cy + Math.sin(a) * out, side);
    });

    this.gatherStart = performance.now();
  }

  /** True while ducks are still travelling, so the loop stays at display rate. */
  private get gathering(): boolean {
    return this.gatherStart > 0 && performance.now() - this.gatherStart < GATHER_MS;
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
    // Resizing changes the world, so the ducks have to be laid out in the
    // new one — otherwise they keep positions measured against the old
    // size and drift out of the population area. Placement is a pure
    // function of ids, so nothing shuffles.
    this.camera.side = worldSide(
      Math.max(this.frameSprite.w, this.frameSprite.h),
      this.ducks.length,
    );
    if (this.ducks.length) this.ducks = placeDucks(this.ducks, this.camera.side);
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

      this.advanceGather(now);
      this.draw(now);

      // Publish state into the DOM, throttled, behind `?debug`.
      //
      // The pond is canvas, so none of this is inspectable otherwise. It
      // goes in the DOM rather than on `window` because a browser
      // automation tool evaluates in an ISOLATED WORLD: it shares the DOM
      // but not page globals, so a `window` handle reads back as undefined
      // from outside — and `window.pond` is doubly useless, because an
      // element with id="pond" already claims that name.
      if (this.debugging && now - this.lastDebug > 50) {
        this.lastDebug = now;
        this.opts.canvas.dataset.pond = JSON.stringify(this.debug());
      }

      // Display rate while moving or rippling; stop-motion otherwise.
      // Display rate whenever the view is under anyone's control — a
      // finger, a fling, a glide, a settle — and stop-motion otherwise.
      if (camMoving || this.ripples.length || this.gathering || this.sparkles.length) {
        this.raf = requestAnimationFrame(loop);
      } else {
        this.timer = window.setTimeout(() => {
          this.raf = requestAnimationFrame(loop);
        }, WORLD_MS);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.gestures.destroy();
  }

  /**
   * Play a fortune's arrival over a duck.
   *
   * 小吉 is the only one that leaves anything behind: petals, for about
   * three minutes, drifting and dithering out rather than blinking away.
   */
  arrive(duck: Placed): void {
    const now = performance.now();
    this.sparkles = arrival(duck.fortune, duck.wx, duck.wy);
    this.sparkleStart = now;
    if (duck.fortune === 1) this.petals.push(...petals(duck.wx, duck.wy, now));
    this.splash(duck.wx, duck.wy, 18);
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

  /**
   * Move each duck toward wherever the whistle put it.
   *
   * Eased, and through `wrapDelta`, so a duck on the far side of the seam
   * comes the short way round rather than swimming the length of the world.
   */
  private advanceGather(now: number): void {
    if (this.gatherStart === 0) return;
    const p = Math.min(1, (now - this.gatherStart) / GATHER_MS);
    const e = easeInOutCubic(p);
    const { side } = this.camera;

    for (const d of this.ducks) {
      if (d.tx === undefined || d.ty === undefined) continue;
      const fromX = d.gx ?? d.wx;
      const fromY = d.gy ?? d.wy;
      d.gx ??= fromX;
      d.gy ??= fromY;
      d.wx = wrap(fromX + wrapDelta(fromX, d.tx, side) * e, side);
      d.wy = wrap(fromY + wrapDelta(fromY, d.ty, side) * e, side);
    }

    if (p >= 1) {
      this.gatherStart = 0;
      for (const d of this.ducks) {
        d.gx = undefined;
        d.gy = undefined;
      }
    }
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

    // ── arrivals, over the ducks ────────────────────────────────────────
    //
    // Drawn as whole sprite pixels on the same grid as everything else, so
    // a sparkle is the same size as a pixel of duck. Anything smoother
    // would be the one thing on screen that is not stop-motion.
    if (this.sparkles.length) {
      const t = now - this.sparkleStart;
      for (const p of this.sparkles) {
        if (t < p.on || t > p.off) continue;
        const at = project(
          p.x, p.y, this.camera.cam, renderCell,
          canvas.width, canvas.height, this.camera.side,
        );
        ctx.fillStyle = p.colour;
        ctx.fillRect(at.x, at.y, renderCell, renderCell);
      }
      if (t > sparkleDuration(this.sparkles)) this.sparkles = [];
    }

    // Petals outlive their arrival: 小吉 leaves them for about three
    // minutes. They dither out — dropped pixels, never a fade — because
    // opacity is the one thing this pond never animates.
    if (this.petals.length) {
      this.petals = this.petals.filter((p) => now - p.born < PETAL_LIFE_MS);
      for (const p of this.petals) {
        const age = (now - p.born) / PETAL_LIFE_MS;
        // Toward the end, drop pixels rather than fading them.
        if (age > 0.6 && (this.frame + Math.round(p.wx)) % 3 < Math.round((age - 0.6) * 7)) {
          continue;
        }
        const at = project(
          p.wx + (now - p.born) * p.drift, p.wy, this.camera.cam, renderCell,
          canvas.width, canvas.height, this.camera.side,
        );
        ctx.fillStyle = p.colour;
        ctx.fillRect(at.x, at.y, renderCell, renderCell);
      }
    }

    // The sub-integer remainder ONLY. The render stays on an integer grid;
    // the motion stays continuous. Dividing by OVERSCAN here was wrong —
    // the element's 150% width already places it, and scaling it back down
    // shrank every duck by a further third on top of the backing-store bug.
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  /** Nearest duck within a forgiving radius. Front-most wins. */
  private hitTest(wx: number, wy: number): Placed | undefined {
    let best: Placed | undefined;
    let bestD = 16; // sprite pixels — a duck is 24 wide
    for (const d of this.ducks) {
      // The one wrap implementation, not a fourth copy of the arithmetic.
      const dist = Math.hypot(
        wrapDelta(wx, d.wx, this.camera.side),
        wrapDelta(wy, d.wy, this.camera.side),
      );
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }
}
