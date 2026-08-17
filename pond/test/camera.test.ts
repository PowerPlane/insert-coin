/**
 * The camera rules, each of which was bought with a bug.
 *
 * UI.md's changelog records what these cost — "deleting clamping deleted
 * most of the camera bugs in this project", "the camera teleported at the
 * end of every move", "stop the ducks jumping during a zoom". This file
 * exists so the fixes cannot quietly come back out.
 *
 * These are not tests of an implementation detail. Each one corresponds to
 * something a person could see happening on a phone.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CAM_MOMENT,
  CAM_UI,
  CELLS,
  FLING_MAX_SCREEN_PX_PER_MS,
  FLING_REST,
  FLING_TAU,
  OVERSCAN,
  HOME_CELL,
  PondCamera,
  easeInOutCubic,
  nearestCell,
  project,
  worldSide,
  wrap,
  wrapDelta,
} from "../src/client/camera.js";

describe("zoom is an integer, always", () => {
  it("only ever renders at a legal cell size", () => {
    // At 4.7 pixels per sprite pixel some pixels land on 4 and their
    // neighbours on 5, so outlines crawl. Every level is an exact multiple.
    for (let c = 1.5; c <= 9; c += 0.13) {
      expect(CELLS).toContain(nearestCell(c));
    }
  });

  it("carries the leftover as a scale, not as a fractional render", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4.7 }, 100);
    const { renderCell, scale } = cam.frame();
    expect(renderCell).toBe(4); // nearest legal integer
    expect(scale).toBeCloseTo(4.7 / 4);
    // The remainder never exceeds what the 150% overscan can cover.
    expect(Math.abs(1 - scale)).toBeLessThan(0.5);
  });

  it("steps through the legal ladder and stops at the ends", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: HOME_CELL }, 100);
    expect(cam.step(1)).toBe(6);
    expect(cam.step(-1)).toBe(3);

    cam.snap({ cell: 8 });
    expect(cam.step(1)).toBeNull();
    cam.snap({ cell: 2 });
    expect(cam.step(-1)).toBeNull();
  });

  it("refuses to zoom outside the ladder even when asked", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 100);
    cam.snap({ cell: 99 });
    expect(cam.cam.cell).toBe(8);
    cam.snap({ cell: 0.1 });
    expect(cam.cam.cell).toBe(2);
  });
});

describe("the world wraps, and nothing clamps", () => {
  const side = 360;

  it("measures every distance the short way round", () => {
    // A duck one pixel off the left edge is one pixel away, not a world away.
    expect(wrapDelta(5, 355, side)).toBe(-10);
    expect(wrapDelta(355, 5, side)).toBe(10);
    expect(wrapDelta(0, 180, side)).toBe(180);
  });

  it("panning past an edge comes back round to the same water", () => {
    const cam = new PondCamera({ x: 10, y: 10, cell: 4 }, side);
    cam.pan(30, 0); // drag right past the seam
    expect(cam.cam.x).toBe(wrap(-20, side));
    expect(cam.cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.cam.x).toBeLessThan(side);
  });

  it("never leaves a coordinate outside the world", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, side);
    for (let i = 0; i < 50; i++) {
      cam.pan(137, -211);
      expect(cam.cam.x).toBeGreaterThanOrEqual(0);
      expect(cam.cam.x).toBeLessThan(side);
      expect(cam.cam.y).toBeGreaterThanOrEqual(0);
      expect(cam.cam.y).toBeLessThan(side);
    }
  });

  it("glides to a duck near the seam the short way, not across the world", () => {
    // "the camera teleported at the end of every move — and the pond wraps"
    const cam = new PondCamera({ x: 5, y: 0, cell: 4 }, side);
    cam.glide({ x: 355 }, CAM_UI, 0);

    // Halfway through it should be heading OFF the left edge, not right.
    cam.tick(CAM_UI / 2);
    const halfway = cam.cam.x;
    expect(halfway > 300 || halfway < 5).toBe(true);

    cam.tick(CAM_UI);
    expect(cam.cam.x).toBeCloseTo(355, 0);
  });
});

describe("position and zoom move together", () => {
  it("finishes both at the same moment, on one easing", () => {
    // Splitting them into "travel, then zoom" was tried to work around a
    // bug. It felt worse, and the bug was the real problem.
    const cam = new PondCamera({ x: 0, y: 0, cell: 2 }, 400);
    cam.glide({ x: 100, cell: 8 }, CAM_UI, 0);

    for (const at of [0.25, 0.5, 0.75]) {
      cam.tick(CAM_UI * at);
      const e = easeInOutCubic(at);
      expect(cam.cam.x).toBeCloseTo(100 * e, 1);
      expect(cam.cam.cell).toBeCloseTo(2 + 6 * e, 2);
    }

    expect(cam.tick(CAM_UI)).toBe(false);
    expect(cam.cam.x).toBeCloseTo(100, 1);
    expect(cam.cam.cell).toBeCloseTo(8, 2);
  });

  it("reports moving only while it is actually moving", () => {
    // The world holds still for exactly this long — otherwise ducks lurch
    // underneath a gliding view and it reads as the zoom stuttering.
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 400);
    expect(cam.moving).toBe(false);

    cam.glide({ x: 50 }, CAM_UI, 0);
    expect(cam.moving).toBe(true);
    cam.tick(CAM_UI / 2);
    expect(cam.moving).toBe(true);
    cam.tick(CAM_UI);
    expect(cam.moving).toBe(false);
  });

  it("a drag interrupts a glide rather than fighting it", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 400);
    cam.glide({ x: 200 }, CAM_MOMENT, 0);
    cam.pan(10, 0);
    expect(cam.moving).toBe(false);
  });
});

describe("sprites quantise to canvas pixels, never the world grid", () => {
  it("projects to whole canvas pixels", () => {
    // Snapping to round(x) * CELL locks a duck to multiples of CELL, so it
    // jumps in CELL-sized steps whenever the view moves.
    const cam = { x: 50.5, y: 50.5, cell: 4 };
    const p = project(51.3, 52.7, cam, 4, 600, 800, 400);
    expect(Number.isInteger(p.x)).toBe(true);
    expect(Number.isInteger(p.y)).toBe(true);
  });

  it("moves a duck by sub-cell amounts as the camera moves", () => {
    // The observable difference: with world-grid snapping these two would
    // be identical, and the duck would sit still then jump a whole cell.
    const a = project(51.3, 0, { x: 50.0, y: 0, cell: 4 }, 4, 600, 800, 400);
    const b = project(51.3, 0, { x: 50.2, y: 0, cell: 4 }, 4, 600, 800, 400);
    expect(a.x).not.toBe(b.x);
  });

  it("puts a duck at the camera centre in the middle of the canvas", () => {
    const p = project(120, 240, { x: 120, y: 240, cell: 4 }, 4, 600, 800, 400);
    expect(p).toEqual({ x: 300, y: 400 });
  });

  it("projects across the seam without flinging a duck off-screen", () => {
    // A duck just past the wrap point must draw just off the edge, not a
    // world away — this is what made ducks vanish near the seam.
    const near = project(2, 0, { x: 398, y: 0, cell: 4 }, 4, 600, 800, 400);
    expect(Math.abs(near.x - 300)).toBeLessThan(40);
  });
});

describe("the world grows with the population", () => {
  it("never gets more crowded, only bigger", () => {
    const frame = 100;
    const small = worldSide(frame, 13);
    const large = worldSide(frame, 113);
    expect(large).toBeGreaterThan(small);
  });

  it("keeps somewhere to drag to even when nearly empty", () => {
    // Without the 2.4x floor the world equalled the frame at default zoom
    // and panning did nothing, which reads as broken rather than as "you
    // have seen it all".
    const frame = 100;
    expect(worldSide(frame, 1)).toBeGreaterThanOrEqual(frame * 2.4);
    expect(worldSide(frame, 0)).toBeGreaterThanOrEqual(frame * 2.4);
  });

  it("matches the sizes recorded in the UI changelog", () => {
    // "Verified: 13 ducks = world 172x370 (the screen), 113 = 362x779."
    // The population term overtakes the floor somewhere between the two.
    expect(Math.ceil(Math.sqrt(13) * 34)).toBe(123);
    expect(Math.ceil(Math.sqrt(113) * 34)).toBe(362);
  });
});

describe("inertia — a flick keeps travelling and slows down", () => {
  /**
   * The model every platform settled on: exponential decay. UIScrollView
   * expresses it as a per-millisecond decelerationRate; 0.998 is a time
   * constant of ~325 ms, which reads as normal rather than icy or sticky.
   *
   * There is no rubber-banding and there never will be — the world wraps,
   * so there are no edges to bounce off.
   */
  it("keeps moving after the finger lifts, then stops", () => {
    const cam = new PondCamera({ x: 500, y: 500, cell: 4 }, 1000);
    cam.fling(0.5, 0, 0);
    expect(cam.moving).toBe(true);

    const early = (() => {
      cam.tick(50);
      return cam.cam.x;
    })();
    expect(early).not.toBe(500);

    // Runs down to rest on its own rather than drifting forever.
    for (let t = 100; t < 4000; t += 16) cam.tick(t);
    expect(cam.moving).toBe(false);
  });

  it("decays exponentially with the documented time constant", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 100000);
    cam.fling(1, 0, 0);
    cam.tick(FLING_TAU); // one time constant

    // Closed-form travel over one tau is tau * (1 - 1/e).
    const expected = FLING_TAU * (1 - Math.exp(-1));
    expect(wrap(-cam.cam.x, 100000)).toBeCloseTo(expected, 0);
  });

  it("travels the same distance regardless of frame rate", () => {
    // The closed form matters: a phone dropping frames must not also lose
    // distance, or a flick feels different when the device is busy.
    const smooth = new PondCamera({ x: 0, y: 0, cell: 4 }, 100000);
    smooth.fling(1, 0, 0);
    for (let t = 8; t <= 2000; t += 8) smooth.tick(t);

    const choppy = new PondCamera({ x: 0, y: 0, cell: 4 }, 100000);
    choppy.fling(1, 0, 0);
    for (let t = 50; t <= 2000; t += 50) choppy.tick(t);

    expect(wrap(-smooth.cam.x, 100000)).toBeCloseTo(wrap(-choppy.cam.x, 100000), 0);
  });

  it("ignores a flick too slow to be one", () => {
    // A finger that paused before lifting must not fling. The velocity
    // buffer produces ~zero for that, and this is the floor under it.
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 1000);
    cam.fling(FLING_REST / 2, 0, 0);
    expect(cam.moving).toBe(false);
  });

  it("caps a wild flick so it cannot teleport", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 100000);
    cam.fling(9999, 0, 0);
    for (let t = 16; t < 4000; t += 16) cam.tick(t);
    const travelled = wrap(-cam.cam.x, 100000);
    // The cap is in screen pixels per ms; at cell 4 that is a bounded
    // world distance however hard the flick was.
    const ceiling = (FLING_MAX_SCREEN_PX_PER_MS / 4) * FLING_TAU * 1.05;
    expect(travelled).toBeLessThanOrEqual(ceiling);
  });

  it("a new finger kills the fling instantly", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 1000);
    cam.fling(1, 0, 0);
    cam.grab();
    const at = cam.cam.x;
    cam.tick(500);
    // Held, so the camera is under the finger's control and does not drift.
    expect(cam.cam.x).toBe(at);
    expect(cam.moving).toBe(true); // still frozen-world, still display rate
  });

  it("counts a held finger as moving, so a drag redraws at display rate", () => {
    // Before this, `moving` was only true during a glide — so dragging fell
    // through to the 83 ms stop-motion path and tracked a thumb at 12 fps.
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 1000);
    expect(cam.moving).toBe(false);
    cam.grab();
    expect(cam.moving).toBe(true);
    cam.release();
    expect(cam.moving).toBe(false);
  });
});

describe("pinch — the water under the fingers stays put", () => {
  it("keeps the anchored world point under the anchor", () => {
    const side = 4000;
    const cam = new PondCamera({ x: 1000, y: 1000, cell: 4 }, side);

    // A point 120 screen px right and 80 down from the view centre.
    const ax = 120;
    const ay = 80;
    const before = {
      x: cam.cam.x + ax / cam.cam.cell,
      y: cam.cam.y + ay / cam.cam.cell,
    };

    cam.zoomAbout(6, ax, ay);

    const after = {
      x: cam.cam.x + ax / cam.cam.cell,
      y: cam.cam.y + ay / cam.cam.cell,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("zooming about the centre only changes the zoom", () => {
    const cam = new PondCamera({ x: 500, y: 500, cell: 4 }, 2000);
    cam.zoomAbout(8, 0, 0);
    expect(cam.cam.x).toBeCloseTo(500, 6);
    expect(cam.cam.y).toBeCloseTo(500, 6);
    expect(cam.cam.cell).toBe(8);
  });

  it("settles onto the nearest rung once the fingers lift", () => {
    const cam = new PondCamera({ x: 0, y: 0, cell: 4 }, 1000);
    cam.grab();
    cam.zoomAbout(5.4, 0, 0);
    expect(cam.cam.cell).toBeCloseTo(5.4);
    cam.release();

    for (let t = 16; t < 1200; t += 16) cam.tick(t);
    expect(cam.cam.cell).toBe(6); // nearest rung to 5.4
    expect(cam.moving).toBe(false);
  });

  it("never asks the overscan for more than it has", () => {
    // Mid-pinch the render is at the nearest rung and the remainder is a
    // CSS scale. The worst remainder on the {2,3,4,6,8} ladder decides how
    // much overscan is needed; 150% has to cover it.
    let worst = 1;
    for (let cell = CELLS[0]; cell <= CELLS[CELLS.length - 1]!; cell += 0.01) {
      const scale = cell / nearestCell(cell);
      worst = Math.max(worst, 1 / scale, scale);
    }
    expect(worst).toBeLessThan(OVERSCAN);
  });
});

describe("the anchor is in device pixels, and the units are the bug", () => {
  it("drifts by exactly the dpr factor when given CSS pixels instead", () => {
    // Measured on a real 2x screen: 24.75 world pixels of drift at a
    // 200-pixel anchor zooming 4 -> 8. That is `200 * (2 - 1) * (1/8)`,
    // which is what passing CSS pixels to a device-pixel API costs.
    //
    // Pinned as a test because "it drifts a bit" is exactly the kind of
    // thing that gets shrugged off as feel rather than recognised as a
    // missing factor.
    const cssAnchor = 200;
    const dpr = 2;
    const from = 4;
    const to = 8;

    const correct = new PondCamera({ x: 1000, y: 1000, cell: from }, 8000);
    correct.zoomAbout(to, cssAnchor * dpr, 0);

    const wrong = new PondCamera({ x: 1000, y: 1000, cell: from }, 8000);
    wrong.zoomAbout(to, cssAnchor, 0);

    const drift = Math.abs(correct.cam.x - wrong.cam.x);
    expect(drift).toBeCloseTo(cssAnchor * (dpr - 1) * (1 / to), 4);
    expect(drift).toBeCloseTo(25, 1);
  });
});

/**
 * Reduced motion, at the camera.
 *
 * The camera is the largest movement in the pond — the whole world slides
 * while the viewer sits still, which is precisely the vestibular trigger the
 * preference exists for. Shortening the glide would not answer it; only
 * already being there does.
 *
 * The module reads the preference through viewport.ts, which caches, so each
 * case imports a fresh copy of the camera.
 *
 * @see viewport.test.ts for the switch itself.
 */
describe("a camera that has been asked not to move", () => {
  /** A camera built against a pinned Reduce Motion setting. */
  async function cameraWith(reduce: boolean) {
    vi.resetModules();
    vi.stubGlobal("matchMedia", () => ({
      matches: reduce, addEventListener: () => {}, removeEventListener: () => {},
    }));
    const { PondCamera: Fresh } = await import("../src/client/camera.js");
    return new Fresh({ x: 1000, y: 1000, cell: 4 }, 8000);
  }

  it("arrives immediately instead of gliding", async () => {
    const cam = await cameraWith(true);
    cam.glide({ x: 1400, y: 1200, cell: 8 }, 600, 0);
    // Nothing left to ease: it is at the destination on the same tick.
    expect(cam.cam).toEqual({ x: 1400, y: 1200, cell: 8 });
  });

  it("loses no information by arriving — the destination is the point", async () => {
    const glided = await cameraWith(false);
    const snapped = await cameraWith(true);
    glided.glide({ x: 1400, y: 1200, cell: 8 }, 600, 0);
    glided.tick(600);
    snapped.glide({ x: 1400, y: 1200, cell: 8 }, 600, 0);
    expect(snapped.cam).toEqual(glided.cam);
  });

  it("still glides when motion is welcome, or the moment is lost", async () => {
    const cam = await cameraWith(false);
    cam.glide({ x: 1400, y: 1200, cell: 8 }, 600, 0);
    expect(cam.cam.x).toBe(1000); // has not left yet
    cam.tick(300);
    expect(cam.cam.x).toBeGreaterThan(1000);
    expect(cam.cam.x).toBeLessThan(1400);
  });
});

/**
 * What the world holds still for.
 *
 * A dolly freezes the world: it lasts a few hundred milliseconds, and ducks
 * lurching two or three times underneath a smooth camera move reads as the
 * CAMERA stuttering. A drag must not freeze anything — the finger sets the
 * pace, it can be down for as long as the person likes, and a pond that
 * stops living while you look around it reads as the page having hung.
 *
 * That is not a hypothetical: it shipped that way and was reported as
 * "the animation on the duck and the pond background stopped".
 */
describe("a drag is not a dolly", () => {
  const cam = () => new PondCamera({ x: 1000, y: 1000, cell: 4 }, 8000);

  it("keeps redrawing at display rate while a finger is down", () => {
    // Both predicates matter, and they are not the same one.
    const c = cam();
    c.grab();
    expect(c.moving, "a drag needs display-rate redraw").toBe(true);
    expect(c.gliding, "a drag must not freeze the world").toBe(false);
  });

  it("freezes the world for a glide, which is what the freeze is for", () => {
    const c = cam();
    c.glide({ x: 1400, cell: 8 }, 600, 0);
    expect(c.gliding).toBe(true);
  });

  it("freezes it for a fling too — the camera is still carrying itself", () => {
    const c = cam();
    c.fling(2, 0, 0);
    expect(c.gliding).toBe(true);
  });

  it("stops freezing the moment the camera arrives", () => {
    const c = cam();
    c.glide({ x: 1400, y: 1000, cell: 4 }, 600, 0);
    c.tick(600);
    expect(c.gliding).toBe(false);
  });

  it("does not freeze an idle pond", () => {
    const c = cam();
    expect(c.gliding).toBe(false);
    expect(c.moving).toBe(false);
  });
});
