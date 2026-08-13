/**
 * Fingers on the glass.
 *
 * Extracted from PondView so that class stays a compositor: this file owns
 * pointers, velocity and the arithmetic of two fingers, and hands the
 * camera plain instructions.
 *
 * ══ WHAT MAKES A DRAG FEEL LIKE HANDLING WATER ══
 *
 *  1. **Velocity comes from a BUFFER, not the last event.** A single delta
 *     is mostly sensor noise, and — more importantly — a finger that slid
 *     across and then paused before lifting would still carry the velocity
 *     of the slide. Measuring across ~120 ms means a deliberate stop
 *     naturally yields nothing to fling, without a special case.
 *
 *  2. **Two fingers pan AND zoom at once.** The centroid's movement pans,
 *     the distance between them zooms, and the zoom is anchored on the
 *     centroid so the water between the fingers stays between the fingers.
 *     Handling them as separate modes makes a pinch feel like operating two
 *     controls badly rather than holding one thing.
 *
 *  3. **Transitions rebaseline.** Lifting one finger of two, or adding a
 *     second, must not jump: the remaining state is re-measured rather than
 *     carried over.
 *
 * The physics live in PondCamera — decay, capping, anchoring, settling —
 * so they can be tested without a browser. This file is the part that needs
 * a real thumb.
 */

import type { PondCamera } from "./camera.js";
import { prefersReducedMotion } from "./render.js";

/** How far back velocity is measured. Long enough to smooth, short enough to feel like now. */
const VELOCITY_WINDOW_MS = 120;

/** A press that travels less than this is a tap, not a drag. */
const TAP_SLOP_PX = 8;

interface Sample {
  t: number;
  x: number;
  y: number;
}

export interface GestureTarget {
  /** CSS pixels per world unit — the CONTINUOUS cell, not the render cell. */
  scale(): number;
  /** CSS pixels to device pixels. `camera.cell` is denominated in device pixels. */
  dpr(): number;
  camera: PondCamera;
  onTap(clientX: number, clientY: number): void;
}

export class Gestures {
  /** Live pointers, each with a short trail of where it has been. */
  private readonly points = new Map<number, Sample[]>();
  private travelled = 0;
  /** Distance between two fingers when the pinch was last measured. */
  private pinchGap = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly target: GestureTarget,
  ) {
    el.addEventListener("pointerdown", this.down);
    el.addEventListener("pointermove", this.move);
    el.addEventListener("pointerup", this.up);
    el.addEventListener("pointercancel", this.up);
    // A trackpad or a mouse wheel is not a finger, but it is the obvious
    // thing to try on a desktop, and doing nothing reads as broken.
    el.addEventListener("wheel", this.wheel, { passive: false });
  }

  destroy(): void {
    this.el.removeEventListener("pointerdown", this.down);
    this.el.removeEventListener("pointermove", this.move);
    this.el.removeEventListener("pointerup", this.up);
    this.el.removeEventListener("pointercancel", this.up);
    this.el.removeEventListener("wheel", this.wheel);
  }

  private trail(id: number): Sample[] {
    let t = this.points.get(id);
    if (!t) {
      t = [];
      this.points.set(id, t);
    }
    return t;
  }

  private push(e: PointerEvent): void {
    const t = this.trail(e.pointerId);
    t.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    // Keep only the window. Everything older cannot contribute to velocity.
    while (t.length > 2 && e.timeStamp - t[0]!.t > VELOCITY_WINDOW_MS) t.shift();
  }

  private latest(): Sample[] {
    return [...this.points.values()].map((t) => t[t.length - 1]!).filter(Boolean);
  }

  private centroid(): { x: number; y: number } {
    const now = this.latest();
    const sum = now.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / now.length, y: sum.y / now.length };
  }

  private gap(): number {
    const [a, b] = this.latest();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly down = (e: PointerEvent): void => {
    this.push(e);
    if (this.points.size === 1) this.travelled = 0;
    // Rebaseline: a second finger arriving must not read as a huge pinch.
    this.pinchGap = this.gap();
    this.target.camera.grab();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events and already-released pointers throw here. Capture
      // is an optimisation — losing it costs a dropped drag, not a crash.
    }
  };

  private readonly move = (e: PointerEvent): void => {
    if (!this.points.has(e.pointerId)) return;

    const before = this.centroid();
    const beforeGap = this.gap();
    this.push(e);
    const after = this.centroid();

    const dx = after.x - before.x;
    const dy = after.y - before.y;
    this.travelled += Math.abs(dx) + Math.abs(dy);

    const { camera } = this.target;

    // Two fingers: zoom about the centroid, so the water between them
    // stays between them. Done BEFORE the pan, because the anchor is
    // measured in the pre-pan frame.
    if (this.points.size >= 2 && beforeGap > 0 && this.pinchGap > 0) {
      const gap = this.gap();
      const ratio = gap / beforeGap;
      if (Number.isFinite(ratio) && ratio > 0) {
        // DEVICE pixels: `cell` is device pixels per sprite pixel, so an
        // anchor in CSS pixels under-corrects by exactly the dpr.
        const d = this.target.dpr();
        const rect = this.el.getBoundingClientRect();
        camera.zoomAbout(
          camera.cam.cell * ratio,
          (after.x - (rect.left + rect.width / 2)) * d,
          (after.y - (rect.top + rect.height / 2)) * d,
        );
      }
    }

    // The centroid's movement pans, at one finger or two.
    const k = 1 / this.target.scale();
    camera.pan(dx * k, dy * k);
  };

  private readonly up = (e: PointerEvent): void => {
    const trail = this.points.get(e.pointerId);
    this.points.delete(e.pointerId);

    // Still fingers down: rebaseline so lifting one of two does not jump.
    if (this.points.size > 0) {
      this.pinchGap = this.gap();
      return;
    }

    this.target.camera.release();

    if (this.travelled <= TAP_SLOP_PX) {
      // A finger never holds perfectly still, and a tap that demands
      // stillness reads as an unresponsive button.
      this.target.onTap(e.clientX, e.clientY);
      return;
    }

    // Inertia is flourish, not information — UI.md § 5 says reduced motion
    // must never remove information, and this removes none.
    if (prefersReducedMotion() || !trail || trail.length < 2) return;

    const first = trail[0]!;
    const last = trail[trail.length - 1]!;
    const dt = last.t - first.t;
    if (dt <= 0) return;

    // Across the buffer, not the last delta: a finger that paused before
    // lifting has moved almost nowhere over the window, so it does not
    // fling — which is exactly what a deliberate stop should do.
    const k = 1 / this.target.scale();
    this.target.camera.fling(((last.x - first.x) / dt) * k, ((last.y - first.y) / dt) * k);
  };

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const { camera } = this.target;
    // A notch of wheel is a zoom step, anchored under the cursor. ctrl+wheel
    // is what a trackpad pinch reports as, and means the same thing here.
    const factor = Math.exp(-e.deltaY / 400);
    const d = this.target.dpr();
    camera.zoomAbout(
      camera.cam.cell * factor,
      (e.clientX - (rect.left + rect.width / 2)) * d,
      (e.clientY - (rect.top + rect.height / 2)) * d,
    );
  };
}
