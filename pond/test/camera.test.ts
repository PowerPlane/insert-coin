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

import { describe, expect, it } from "vitest";
import {
  CAM_MOMENT,
  CAM_UI,
  CELLS,
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
