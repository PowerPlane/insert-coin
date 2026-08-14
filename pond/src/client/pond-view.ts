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
import { GRID, decodePaint } from "./codec.js";
import {
  advanceParticles, douseMist, splashDroplets, type Particle,
} from "./particles.js";
import { DWELL } from "./render.js";
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
  /** The heading it is currently wandering along, in radians. */
  head?: number;
  /** Stable per-duck character: where on the ring it aims, and how hard it pulls. */
  r?: number;
  /** True while the whistle has pushed it out of the frame. */
  shoved?: boolean;
  /** A bump in flight: where it left, where it stops, and when it set off. */
  dartFromX?: number;
  dartFromY?: number;
  dartToX?: number;
  dartToY?: number;
  dartAt?: number;
  dartTarget?: string;
  /** Left over from being bumped, or from bumping. Decays to nothing. */
  vx?: number;
  vy?: number;
}

/*
 * ══ A BUMP IS A DUCK CROSSING THE POND ══
 * Not a counter going up. Your duck swims over, touches theirs, and both
 * are knocked apart — which is the whole reason the interaction is called
 * a bump and not a like.
 *
 * Fixed duration whatever the distance, so a bump across the pond is a
 * FASTER duck rather than a longer wait. At 12fps a variable duration
 * reads as a glitch; a constant one reads as intent.
 */
const DART_MS = 420;
/** Stop this much short — measured in sprite cells — so they touch, not overlap. */
const DART_STOP_SHORT = GRID * 0.7;
/** What the bumped duck takes, along the axis of the hit. */
const KNOCK_X = 3.6;
const KNOCK_Y = 2.4;
/** What you take back. Less: you were the one moving. */
const REBOUND_X = 1.6;
const REBOUND_Y = 1.1;
/*
 * A knock decays through the same DRIFT_DECAY every other velocity uses.
 * There were separate KNOCK_DECAY and KNOCK_REST constants here, declared
 * and referenced by nothing — two numbers claiming to govern behaviour
 * that was actually governed elsewhere, which is worse than no constant.
 */

/**
 * How far down the visible frame a duck sits when its card is open.
 *
 * The card owns the bottom of the screen, so dead centre is behind it.
 * A third of the way down clears the panel and stays under the HUD.
 */
const DUCK_ABOVE_SHEET = 0.32;

/*
 * ══ THE POND IS ALIVE, AND THE DUCKS KEEP THEIR SPACE ══
 * A pond of perfectly still ducks is a diagram. Two rules make it a place:
 *
 * WANDER — each duck holds a HEADING that meanders, rather than a fixed
 * drift. A constant drift is a straight line, and a straight line always
 * ends somewhere; a heading that wobbles keeps them milling about in open
 * water, which is what ducks actually do.
 *
 * SEPARATE — they push apart. Two ducks occupying one spot read as one
 * duck, and a duck you cannot tap separately is a duck you cannot open.
 * Contact distance always; elbow room as well when nobody has been
 * whistled for, because a flock that has been called is MEANT to be close.
 */
const WANDER_TURN = 0.55;
const WANDER_X = 0.14;
const WANDER_Y = 0.11;
/** Velocity carried between frames. Lower is stickier. */
const DRIFT_DECAY = 0.86;
/** Cells per second, before decay. */
const DRIFT_SPEED = 8;
/** Touching. */
const SEP_CONTACT = GRID * 0.86;
/** Comfortable. Only enforced when the pond is not gathered. */
const SEP_ROOM = GRID * 1.75;
const SEP_STRENGTH = 0.06;
/** Elbow room pushes far more gently than contact does. */
const SEP_ROOM_SCALE = 0.16;

/*
 * ══ THE WHISTLE'S FORCES ══
 * Every one of these is an impulse applied once per world tick. They are
 * small because they compound: a called duck is pulled every tick for as
 * long as the whistle is up, so the flock keeps milling instead of parking.
 */
/** Toward its own spot on the ring. Scaled per duck by its own character. */
const CALL_PULL = 0.0075;
/** Tangential, so they arc in rather than beeline. */
const CALL_SWIRL = 0.10;
/** The ring is an ellipse — a circle reads as a diagram. */
const RING_SQUASH = 0.8;
/** Called ducks are packed tight, so they need their own stronger pass. */
const CALL_SEPARATE = 0.13;
/** Out, and briskly: being asked to leave should look like leaving. */
const EVICT_PUSH = 1.35;
/** Around the rim, so they part rather than piling on one side. */
const EVICT_FAN = 0.5;
/** Back in, once the whistle clears. Gentler than being pushed out. */
const RETURN_PULL = 0.30;

/*
 * ══ HOW HARD THE WATER WAS HIT ══
 * `splash` takes an amplitude and derives the radius, so the callers carry
 * only relative weight and cannot disagree about units. The prototype's
 * numbers, and its scale: radius = 14 + amplitude * 7.
 */
const SPLASH_BASE = 14;
const SPLASH_PER_AMPLITUDE = 7;

/** A finger on the water. The unit everything else is measured against. */
export const SPLASH_TAP = 2.4;
/** A duck landing — the heaviest thing that happens to this pond. */
export const SPLASH_LAND = 2.6;
/** Two ducks touching. A nudge, not a whole hand. */
const SPLASH_BUMP = 1.5;
/** A fire going out: mostly steam, little water moved. */
export const SPLASH_DOUSE = 1.1;

/** Rings live 480ms; more than this on screen at once cannot be told apart. */
const MAX_RIPPLES = 12;

/** How far a splash shoves the ducks floating near it, in sprite cells. */
const SHOCKWAVE_REACH = 26;
/** And how hard, per unit of amplitude. */
const SHOCKWAVE_FORCE = 1.5;

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
  /** A burning duck was tapped. The fire is already out on screen. */
  onDouseDuck?: (duck: Placed) => void;
  onTapWater?: (wx: number, wy: number) => void;
}

export class PondView {
  readonly camera = new PondCamera({ x: 0, y: 0, cell: HOME_CELL }, 1);

  private ctx: CanvasRenderingContext2D;
  private readonly gestures: Gestures;
  private water: WaterBuffer | null = null;
  private ducks: Placed[] = [];
  private ripples: Ripple[] = [];
  /** Thrown pixels: droplets, mist, streamers. */
  private particles: Particle[] = [];
  private frame = 0;
  private lastWorldTick = 0;
  /** For the wander's dt. Clamped, so a backgrounded tab does not teleport. */
  private lastFrameAt = 0;
  private lastDebug = 0;
  /** The active whistle, or null. Held as the predicate so the force field
   *  can ask it every tick rather than working from a stale snapshot. */
  private whistling: ((d: Placed) => boolean) | null = null;
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

  /**
   * Returns whether a duck was hit — which decides whether the tap is
   * allowed to begin a double-tap. Double-tapping a duck would open its
   * card and then zoom the water behind it; tapping water only makes a
   * ripple, so a second tap there costs nothing to reinterpret.
   */
  private tap(clientX: number, clientY: number): boolean {
    const { wx, wy } = this.toWorld(clientX, clientY);
    const hit = this.hitTest(wx, wy);
    if (hit) {
      /*
       * ══ A FIRE IS PUT OUT, NOT READ ══
       * Tapping a burning duck opens its card in the same gesture that
       * would put the fire out, and the card wins — so the one thing the
       * pond asks of a passer-by was unreachable. It is also the only
       * thing somebody with no duck of their own can DO here: they cannot
       * bump, they cannot release, but they can help.
       *
       * So fire is checked first, and reading the card takes a second tap.
       */
      if (hit.burning) {
        this.douse(hit);
        this.opts.onDouseDuck?.(hit);
        return true;
      }
      this.opts.onTapDuck?.(hit);
      return true;
    }
    this.opts.onTapWater?.(wx, wy);
    return false;
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
      /*
       * Server facts are new; everything about how it is MOVING is ours.
       * Dropping these on a poll restarted the flock every twenty seconds:
       * a duck mid-swim toward a whistle would forget it was called, and a
       * duck that had been pushed out would forget to come back.
       */
      return {
        ...fresh,
        wx: old.wx, wy: old.wy, flip: old.flip,
        vx: old.vx, vy: old.vy,
        head: old.head, r: old.r, shoved: old.shoved,
        dartAt: old.dartAt, dartTarget: old.dartTarget,
        dartFromX: old.dartFromX, dartFromY: old.dartFromY,
        dartToX: old.dartToX, dartToY: old.dartToY,
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
    /*
     * Recording the whistle is the whole of this method now.
     *
     * It used to compute a destination for every duck and tween them there
     * over 900ms: a ring position for the called, a rim position for the
     * rest. They arrived in formation and stopped, which is what made it
     * read as things being ARRANGED rather than as a flock answering —
     * linear, eased once, and dead on arrival.
     *
     * `advanceWhistle` applies forces every tick instead, for as long as
     * the whistle is up, so the ducks swim in past each other, jostle for
     * room when they get there, and keep milling.
     */
    this.whistling = match;
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
    this.fitWater(cell);
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

      /*
       * ══ THE WORLD MOVES ON THE TICK, NOT ON THE FRAME ══
       * Every force below is an IMPULSE — `vx += dx * pull` — tuned for one
       * stop-motion tick. Running them on requestAnimationFrame applied
       * them about five times as often, which made separation five times
       * stiffer than intended and the wander churn five times faster.
       *
       * And the world genuinely holds still during a camera move (rule 5):
       * ducks lurching underneath a gliding view reads as the zoom
       * stuttering. Only the frame counter used to be gated; the physics
       * kept running.
       *
       * DWELL is why it does not tick like a metronome. 80/116/68/100 ms is
       * a hand doing this, not a clock — and it was dead code, exported and
       * imported by nobody, so the pond had been running at a flat 83.33.
       */
      const wait = WORLD_MS * DWELL[this.frame % DWELL.length]!;
      if (!camMoving && now - this.lastWorldTick >= wait) {
        const dt = Math.min(0.25, (now - this.lastWorldTick) / 1000);
        this.lastWorldTick = now;
        this.frame++;
        this.step(dt);
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
      if (this.debugging && now - this.lastDebug > 50) {
        this.lastDebug = now;
        this.opts.canvas.dataset.pond = JSON.stringify(this.debug());
      }

      // Display rate while moving or rippling; stop-motion otherwise.
      // Display rate whenever the view is under anyone's control — a
      // finger, a fling, a glide, a settle — and stop-motion otherwise.
      if (camMoving || this.ripples.length || this.sparkles.length || this.particles.length) {
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
    this.splash(duck.wx, duck.wy, SPLASH_LAND);
  }

  /**
   * A ripple where something happened. Discrete rings, not a wave sim.
   *
   * Ripples are drawn INTO the water buffer, in buffer pixels, before it is
   * scaled up — so they dither with the water instead of sitting on top of
   * it as smooth circles. That is why this converts through the projection
   * rather than storing world coordinates.
   */
  /**
   * Put a duck's fire out.
   *
   * Optimistic: the flame stops and the steam goes up before the server is
   * asked, because the water is the ANSWER to the gesture and half a
   * second of nothing would read as the tap having missed. Being late is
   * not an error — the server credits the first rescuer and shrugs at the
   * rest, so the worst case is somebody seeing steam for a fire that was
   * already out, which is exactly what happens at a real pond.
   */
  /**
   * Size the water buffer to the zoom.
   *
   * ══ A BUFFER SIZED FOR ONE ZOOM AND USED AT ANOTHER ══
   * The buffer is one pixel per SPRITE cell, so its size depends on the
   * cell — and it was only ever built during `resize`. Zoom from 4 to 8 and
   * the buffer kept the width for 4 while ripples were projected through
   * the current cell of 8: every coordinate came out at half its proper
   * range, so a tap at the bottom right rippled at the top left. The
   * water's own dither was stretched by the same factor.
   *
   * The same shape as the iOS stretch bug — something derived from a live
   * value, cached, and never recomputed when that value moved.
   */
  private fitWater(cell: number): void {
    const { canvas } = this.opts;
    const cols = Math.ceil(canvas.width / cell);
    const rows = Math.ceil(canvas.height / cell);
    if (this.water && this.water.cols === cols && this.water.rows === rows) return;
    this.water = createWaterBuffer(cols, rows);
  }

  douse(duck: Placed): void {
    duck.burning = false;
    douseMist(this.particles, duck.wx, duck.wy);
    this.splash(duck.wx, duck.wy, SPLASH_DOUSE);
  }

  splash(wx: number, wy: number, amplitude = 1): void {
    /*
     * ══ AMPLITUDE, NOT RADIUS ══
     * Callers used to pass a radius in cells, so every one of them had to
     * know how big a ripple should be — and they disagreed. Worse, the
     * prototype's third argument is an amplitude, so copying a number
     * across from it silently produced a ripple a sixth of the intended
     * size. That happened once already, to the bump.
     *
     * Now a caller says how HARD the water was hit, on a scale where 1 is
     * an ordinary touch, and the radius is derived in one place.
     */
    const max = SPLASH_BASE + amplitude * SPLASH_PER_AMPLITUDE;
    this.ripples.push({ x: wx, y: wy, t: performance.now(), max });

    // Water thrown, not just a ring. A ripple alone reads as a diagram of
    // an impact; the droplets are the impact.
    splashDroplets(this.particles, wx, wy, amplitude);

    /*
     * And the ducks nearby feel it. A splash that moves the water but not
     * the things floating on it is the single clearest tell that this is a
     * drawing rather than a pond.
     */
    const { side } = this.camera;
    for (const d of this.ducks) {
      const dx = wrapDelta(wx, d.wx, side);
      const dy = wrapDelta(wy, d.wy, side);
      const dist = Math.hypot(dx, dy) || 1;
      if (dist >= SHOCKWAVE_REACH) continue;
      const f = (1 - dist / SHOCKWAVE_REACH) * amplitude * SHOCKWAVE_FORCE;
      d.vx = (d.vx ?? 0) + (dx / dist) * f;
      d.vy = (d.vy ?? 0) + (dy / dist) * f;
    }
    /*
     * A hand dragged across the water can queue hundreds of rings, each
     * one a full pass over the water buffer. Twelve is the prototype's
     * cap and is more than can be told apart on screen; the oldest goes,
     * because it is the faintest.
     */
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
  }

  /**
   * Back to the pond's own framing: the middle of the world, at the zoom it
   * opens on.
   *
   * "Everyone" is the show-me-everything action, so it is also the way
   * home. Without it there is no way to undo a zoom and a pan except by
   * hand, and somebody who has wandered off to a corner has no route back.
   */
  home(): void {
    const centre = this.camera.side / 2;
    this.camera.glide({ x: centre, y: centre, cell: HOME_CELL }, CAM_UI);
  }

  /** Centre on a duck. `moment` is the one thing watched, not operated. */
  lookAt(id: string, moment = false): void {
    const d = this.find(id);
    if (!d) return;
    this.camera.glide({ x: d.wx, y: d.wy, cell: HOME_CELL }, moment ? CAM_MOMENT : CAM_UI);
  }

  /**
   * Bring a duck to where it can still be SEEN once its card is up.
   *
   * `lookAt` centres it, and the card covers the bottom of the screen — so
   * tapping a duck put a panel over the exact thing you tapped. The
   * prototype parks it `DUCK_ABOVE_SHEET` of the way down the visible
   * frame instead, which is high enough to clear the panel and low enough
   * not to sit under the HUD.
   *
   * Zoom is only ever raised, never lowered: somebody who has deliberately
   * zoomed in to look at one corner should not be yanked back out because
   * they tapped something.
   */
  lookAtAbove(id: string, clearBelowCss = 0): void {
    const d = this.find(id);
    if (!d) return;
    const cell = Math.max(this.camera.cam.cell, HOME_CELL);

    /*
     * The visible frame, computed from the canvas box and the zoom we are
     * ABOUT to be at — not from `frameSprite`, which is only recalculated
     * on resize and is therefore stale the moment anybody zooms. That
     * staleness is why a duck tapped at 8x landed near the top of the
     * screen instead of in the water.
     */
    const rect = this.opts.canvas.getBoundingClientRect();
    const dpr = this.dpr();
    const frameH = ((rect.height / OVERSCAN) * dpr) / cell;

    /*
     * Centre it in the water that is actually LEFT, rather than at a fixed
     * fraction of the whole frame. The card's height changes with the
     * message and the bumper row, so a constant can only be right for one
     * card; measuring is right for all of them.
     */
    const visibleCss = Math.max(0, rect.height / OVERSCAN - clearBelowCss);
    const yFrac = clearBelowCss > 0 ? visibleCss / 2 / (rect.height / OVERSCAN) : DUCK_ABOVE_SHEET;

    this.camera.glide({ x: d.wx, y: d.wy + frameH * (0.5 - yFrac), cell }, CAM_UI);
  }

  /**
   * Move each duck toward wherever the whistle put it.
   *
   * Eased, and through `wrapDelta`, so a duck on the far side of the seam
   * comes the short way round rather than swimming the length of the world.
   */
  /**
   * Send one duck to bump another.
   *
   * Returns false if it cannot: no such duck, the same duck twice, or one
   * already mid-flight. The caller should not report a bump it did not
   * get to watch.
   */
  bumpDuck(fromId: string, toId: string): boolean {
    const from = this.ducks.find((d) => d.id === fromId);
    const to = this.ducks.find((d) => d.id === toId);
    if (!from || !to || from === to || from.dartAt) return false;

    const { side } = this.camera;
    const dx = wrapDelta(from.wx, to.wx, side);
    const dy = wrapDelta(from.wy, to.wy, side);
    const dist = Math.hypot(dx, dy) || 1;
    // Short of them, not into them. Ducks that overlap read as one duck.
    const stop = Math.max(0, dist - DART_STOP_SHORT);

    from.dartFromX = from.wx;
    from.dartFromY = from.wy;
    from.dartToX = from.wx + (dx / dist) * stop;
    from.dartToY = from.wy + (dy / dist) * stop;
    from.dartTarget = to.id;
    from.flip = dx < 0;
    // Reduced motion still bumps — it just does not travel. The knock and
    // the splash are the information; the swim is the flourish.
    from.dartAt = prefersReducedMotion() ? 1 : performance.now();
    return true;
  }

  /**
   * Push overlapping ducks apart.
   *
   * Spatially hashed into buckets the size of the search radius, so this
   * stays linear as the pond fills — the naive pairwise version is 10,000
   * comparisons at a hundred ducks, every frame, on a phone.
   */
  private separate(roomy: boolean): void {
    this.separateSome(this.ducks, SEP_STRENGTH, roomy);
  }

  /** The same rule over an arbitrary set, at an arbitrary strength. */
  private separateSome(list: Placed[], strength: number, roomy: boolean): void {
    const { side } = this.camera;
    const g = roomy ? SEP_ROOM : SEP_CONTACT;
    const buckets = new Map<string, Placed[]>();
    const ducks = list;
    const keyOf = (x: number, y: number) =>
      `${Math.floor(wrap(x, side) / g)},${Math.floor(wrap(y, side) / g)}`;

    for (const d of ducks) {
      const k = keyOf(d.wx, d.wy);
      const arr = buckets.get(k);
      if (arr) arr.push(d);
      else buckets.set(k, [d]);
    }

    for (const d of ducks) {
      const cx = Math.floor(wrap(d.wx, side) / g);
      const cy = Math.floor(wrap(d.wy, side) / g);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = buckets.get(`${cx + ox},${cy + oy}`);
          if (!arr) continue;
          for (const o of arr) {
            if (o === d) continue;
            const dx = wrapDelta(d.wx, o.wx, side);
            const dy = wrapDelta(d.wy, o.wy, side);
            const dist = Math.hypot(dx, dy);
            if (dist <= 0.01 || dist >= g) continue;
            const f =
              dist < SEP_CONTACT
                ? ((SEP_CONTACT - dist) / dist) * strength
                : roomy
                  ? ((SEP_ROOM - dist) / dist) * strength * SEP_ROOM_SCALE
                  : 0;
            if (!f) continue;
            d.vx = (d.vx ?? 0) - dx * f;
            d.vy = (d.vy ?? 0) - dy * f;
          }
        }
      }
    }
  }

  /** Advance any bump in flight, and let the knock from one settle. */
  private advanceDarts(now: number, dt: number): void {
    const { side } = this.camera;

    for (const d of this.ducks) {
      if (d.dartAt) {
        const p = d.dartAt === 1 ? 1 : Math.min(1, (now - d.dartAt) / DART_MS);
        // Ease out: quick off the mark, arriving gently, which is what
        // makes the contact read as a touch rather than a collision.
        const e = 1 - Math.pow(1 - p, 3);
        d.wx = wrap(d.dartFromX! + (d.dartToX! - d.dartFromX!) * e, side);
        d.wy = wrap(d.dartFromY! + (d.dartToY! - d.dartFromY!) * e, side);
        d.vx = 0;
        d.vy = 0;

        if (p >= 1) {
          const target = this.ducks.find((o) => o.id === d.dartTarget);
          if (target) {
            const ax = wrapDelta(d.wx, target.wx, side);
            const ay = wrapDelta(d.wy, target.wy, side);
            const m = Math.hypot(ax, ay) || 1;
            // The splash goes where they actually touch, between the two.
            this.splash(d.wx + ax * 0.5, d.wy + ay * 0.5, SPLASH_BUMP);
            target.vx = (target.vx ?? 0) + (ax / m) * KNOCK_X;
            target.vy = (target.vy ?? 0) + (ay / m) * KNOCK_Y;
            d.vx = -(ax / m) * REBOUND_X;
            d.vy = -(ay / m) * REBOUND_Y;
          }
          d.dartAt = undefined;
          d.dartTarget = undefined;
        }
        continue;
      }

      // A heading that meanders, not a fixed drift. A straight line always
      // ends somewhere; a wobble keeps them milling in open water.
      d.head ??= Math.random() * Math.PI * 2;
      d.head += (Math.random() - 0.5) * WANDER_TURN;
      const dx = Math.cos(d.head) * WANDER_X;
      const dy = Math.sin(d.head) * WANDER_Y;

      d.vx = (d.vx ?? 0) * DRIFT_DECAY;
      d.vy = (d.vy ?? 0) * DRIFT_DECAY;
      d.wx = wrap(d.wx + (d.vx + dx) * dt * DRIFT_SPEED, side);
      d.wy = wrap(d.wy + (d.vy + dy) * dt * DRIFT_SPEED, side);
      // Which way it is facing follows where it is going, not where it was
      // put — a duck swimming backwards is the first thing anyone notices.
      if (Math.abs(d.vx + dx) > 0.12) d.flip = d.vx + dx < 0;
    }
  }

  /**
   * One tick of the world.
   *
   * Order matters: the whistle's forces are added first, separation is
   * layered on top of them, and only then is velocity integrated — so a
   * duck being called and a duck being pushed off it resolve together in
   * the same tick rather than fighting across two.
   */
  private step(dt: number): void {
    this.advanceWhistle();
    // Contact always; elbow room only when nobody has been called, because
    // a flock that has been whistled for is MEANT to be close.
    this.separate(this.whistling === null);
    this.advanceDarts(performance.now(), dt);
    advanceParticles(this.particles, dt);
  }

  /**
   * ══ THE WHISTLE IS A FORCE FIELD, NOT A DESTINATION ══
   *
   * The first version tweened every called duck to a computed spot over
   * 900ms and stopped. It arrived as a perfect ring and then froze, which
   * reads as a diagram assembling itself — the opposite of a flock.
   *
   * The prototype never computes a destination. It applies forces every
   * tick, for as long as the whistle is up, and the shape that emerges is
   * a consequence rather than a target:
   *
   *   * Each duck has a stable character `r`, so it aims at ITS OWN spot on
   *     a loose ellipse and pulls at ITS OWN rate. Everyone converging on
   *     one pixel at one speed packs into a hexagonal lattice, which is
   *     what made the first version read as a crystal.
   *   * A tangential swirl means they arc in rather than beeline.
   *   * Uncalled ducks are pushed out briskly and fanned around the rim, so
   *     they leave rather than being deleted — and they are flagged, so
   *     clearing the whistle brings back exactly the ones it moved.
   */
  private advanceWhistle(): void {
    const { side } = this.camera;
    const gx = this.camera.cam.x;
    const gy = this.camera.cam.y;
    const frameW = this.frameSprite.w;
    const frameH = this.frameSprite.h;

    if (this.whistling) {
      const called: Placed[] = [];
      // Just past the frame, and never further than the world can absorb —
      // or "outside the frame" becomes "against the wall".
      const clear = Math.min(Math.max(frameW, frameH) * 0.52 + GRID, side * 0.42);

      for (const d of this.ducks) {
        if (d.dartAt) continue;
        d.r ??= hashId(d.id + "r");

        if (this.whistling(d)) {
          const angle = d.r * Math.PI * 2;
          const ring = (0.3 + d.r * 0.8) * GRID * 1.9;
          const tx = gx + Math.cos(angle) * ring;
          const ty = gy + Math.sin(angle) * ring * RING_SQUASH;
          const dx = wrapDelta(d.wx, tx, side);
          const dy = wrapDelta(d.wy, ty, side);
          const dist = Math.hypot(dx, dy) || 1;
          const pull = CALL_PULL * (0.65 + d.r * 0.8);
          d.vx = (d.vx ?? 0) + dx * pull;
          d.vy = (d.vy ?? 0) + dy * pull;
          // Tangential: they arc in rather than beelining.
          d.vx += (-dy / dist) * CALL_SWIRL;
          d.vy += (dx / dist) * CALL_SWIRL;
          called.push(d);
          continue;
        }

        const dx = wrapDelta(gx, d.wx, side);
        const dy = wrapDelta(gy, d.wy, side);
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < clear) {
          d.vx = (d.vx ?? 0) + (dx / dist) * EVICT_PUSH;
          d.vy = (d.vy ?? 0) + (dy / dist) * EVICT_PUSH;
          // Around the rim rather than straight out, so they part instead
          // of piling up on one side.
          d.vx += (-dy / dist) * EVICT_FAN;
          d.vy += (dx / dist) * EVICT_FAN;
          d.shoved = true;
        }
      }

      // A second, stronger pass over the flock only: called ducks are
      // packed tightly by the pull and need more room from each other than
      // the ambient rule gives.
      this.separateSome(called, CALL_SEPARATE, false);
      return;
    }

    /*
     * Whistle cleared. Only the ducks it actually MOVED come back — the
     * rest were never anywhere else. Without this they drift home on
     * ordinary wander, which takes minutes and leaves a ring of them
     * parked outside the frame in the meantime.
     */
    const inner = Math.hypot(frameW, frameH) * 0.42;
    for (const d of this.ducks) {
      if (d.dartAt || !d.shoved) continue;
      const dx = wrapDelta(d.wx, gx, side);
      const dy = wrapDelta(d.wy, gy, side);
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > inner) {
        d.vx = (d.vx ?? 0) + (dx / dist) * RETURN_PULL;
        d.vy = (d.vy ?? 0) + (dy / dist) * RETURN_PULL;
      } else {
        d.shoved = false;
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
      // Follow the zoom. Cheap when nothing changed: it compares two ints.
      this.fitWater(renderCell);

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

    /*
     * Thrown pixels, over everything. They are in the air, so they go last
     * — and they never fade: a pixel is on or it is off, the same rule the
     * water and the ducks follow.
     */
    for (const p of this.particles) {
      const at = project(
        p.x, p.y, this.camera.cam, renderCell,
        canvas.width, canvas.height, this.camera.side,
      );
      ctx.fillStyle = p.colour;
      ctx.fillRect(at.x, at.y, renderCell, renderCell);
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
