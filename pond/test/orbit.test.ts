/**
 * The people who bumped you, circling.
 *
 * The layout is pure, so it is checked here rather than by looking: the
 * questions are all geometric — do they spread out, do they face the way
 * they travel, does a name ever land on the duck in the middle.
 *
 * The last one is not hypothetical. Labels sat below their duck always,
 * which puts the TOP duck's name inside the circle and straight across the
 * one duck the screen is about.
 */

import { describe, expect, it } from "vitest";
import { ORBIT_SIZE, STOPS, orbitAt } from "../src/client/orbit.js";
import { GRID } from "../src/client/codec.js";

/** The ring is drawn at 6 sprite pixels per side. */
const CELL = 6;
const DUCK = GRID * CELL;
const centre = ORBIT_SIZE / 2;

/** Where a duck's middle is, from its top-left. */
const middleOf = (s: { x: number; y: number }) => ({
  x: s.x + DUCK / 2,
  y: s.y + DUCK / 2,
});

describe("the ring", () => {
  it("spreads however many turned up, without ever stacking two", () => {
    /*
     * The gap used to be a fixed six stops — a quarter of the circle — and
     * the server returns up to FIVE bumpers. The fifth landed on stop 30,
     * which is stop 6 again: one duck drawn exactly on another, both names
     * in the same place.
     */
    for (let count = 1; count <= 6; count++) {
      const spots = [...Array(count)].map((_, i) =>
        middleOf(orbitAt(i, 0, ORBIT_SIZE, count)));
      const seen = new Set(spots.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
      expect(seen.size, `${count} bumpers`).toBe(count);
    }
  });

  it("spreads them EVENLY, whatever the count", () => {
    /*
     * Not merely distinct: five bunched into a third of the ring would pass
     * the test above and look nothing like an orbit.
     *
     * Measured in the ellipse's own parameter, not in the angle you would
     * read off the screen. Equal steps around a SQUASHED ring do not
     * subtend equal angles from the middle — that is what squashing means —
     * so the vertical is un-squashed first. An earlier version of this test
     * did not, and reported the code as wrong for being an ellipse.
     */
    const SQUASH = 0.74;
    for (const count of [3, 5]) {
      const angles = [...Array(count)].map((_, i) => {
        const p = middleOf(orbitAt(i, 0, ORBIT_SIZE, count));
        return Math.atan2((p.y - centre) / SQUASH, p.x - centre);
      }).sort((a, b) => a - b);
      const gaps = angles.map((a, i) =>
        i ? a - angles[i - 1]! : a + Math.PI * 2 - angles[angles.length - 1]!);
      const want = (Math.PI * 2) / count;
      for (const g of gaps) expect(g, `${count} bumpers`).toBeCloseTo(want, 1);
    }
  });

  it("is an ellipse, not a circle — a ring lying ON the water", () => {
    // A hoop standing up in the air is the wrong read for a pond.
    const right = middleOf(orbitAt(0, 0, ORBIT_SIZE));
    const bottom = middleOf(orbitAt(1, 0, ORBIT_SIZE));
    const across = Math.abs(right.x - centre);
    const down = Math.abs(bottom.y - centre);
    expect(down).toBeLessThan(across);
    expect(down / across).toBeCloseTo(0.74, 1);
  });

  it("turns, and comes back round", () => {
    const start = orbitAt(0, 0, ORBIT_SIZE);
    // Three ticks to a stop, so this is one stop on.
    expect(orbitAt(0, 3, ORBIT_SIZE)).not.toEqual(start);
    // And a full lap returns to exactly where it began.
    expect(orbitAt(0, STOPS * 3, ORBIT_SIZE)).toEqual(start);
  });

  it("holds still between stops — it is stop-motion, not a spinner", () => {
    // Ticks within one stop must not move anything. A smooth orbit would be
    // the one thing on this screen that is not hard-switched.
    expect(orbitAt(0, 1, ORBIT_SIZE)).toEqual(orbitAt(0, 0, ORBIT_SIZE));
    expect(orbitAt(0, 2, ORBIT_SIZE)).toEqual(orbitAt(0, 0, ORBIT_SIZE));
  });

  it("faces the way it is going", () => {
    // Travelling left means flipped; travelling right means not.
    const anyLeft = [...Array(STOPS)].some((_, k) => orbitAt(0, k * 3, ORBIT_SIZE).flip);
    const anyRight = [...Array(STOPS)].some((_, k) => !orbitAt(0, k * 3, ORBIT_SIZE).flip);
    expect(anyLeft && anyRight, "it should face both ways over a lap").toBe(true);
  });

  it("lands on the pixel grid, always", () => {
    // A sprite at a fractional offset is resampled, and this pond never
    // resamples anything.
    for (let k = 0; k < STOPS; k++) {
      const at = orbitAt(k % 4, k * 3, ORBIT_SIZE);
      expect(at.x % CELL, `x at stop ${k}`).toBe(0);
      expect(at.y % CELL, `y at stop ${k}`).toBe(0);
    }
  });

  it("stays inside the canvas it is drawn on", () => {
    for (let k = 0; k < STOPS * 3; k++) {
      const at = orbitAt(k % 4, k, ORBIT_SIZE);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + DUCK).toBeLessThanOrEqual(ORBIT_SIZE);
      expect(at.y + DUCK).toBeLessThanOrEqual(ORBIT_SIZE);
    }
  });
});

describe("the names", () => {
  it("go on the outside of the ring, never across the middle", () => {
    /*
     * The bug this replaced: every label below its duck, so the top duck's
     * name landed inside the circle and over the duck the screen is about.
     * The rule is one line — above the centre line, label above.
     */
    for (let k = 0; k < STOPS * 3; k++) {
      const at = orbitAt(k % 4, k, ORBIT_SIZE);
      const above = middleOf(at).y < centre;
      expect(at.labelAbove, `at tick ${k}`).toBe(above);
    }
  });

  it("puts every label further from the centre than its own duck", () => {
    // The property the rule exists for, stated directly.
    for (let k = 0; k < STOPS * 3; k += 3) {
      const at = orbitAt(k % 4, k, ORBIT_SIZE);
      const duckMiddle = middleOf(at).y;
      const labelY = at.labelAbove ? at.y - 1 : at.y + DUCK + 1;
      expect(Math.abs(labelY - centre)).toBeGreaterThan(Math.abs(duckMiddle - centre));
    }
  });
});
