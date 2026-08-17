/**
 * How hard the water was hit.
 *
 * `splash` used to take a RADIUS IN CELLS, so every caller had to know how
 * big a ripple ought to be, and they disagreed. The prototype's equivalent
 * takes an AMPLITUDE — and copying one of its numbers across without its
 * units gave the bump a ripple a sixth of the intended size, which read on
 * screen as no ripple at all.
 *
 * These lock the scale and the ORDER, which is the part a person actually
 * perceives: a duck landing must move more water than a finger, and a
 * finger more than two ducks brushing past each other.
 */

import { describe, expect, it } from "vitest";
import { SPLASH_DOUSE, SPLASH_LAND, SPLASH_TAP } from "../src/client/pond-view.js";

/** The one place the radius is derived — kept in step with pond-view.ts. */
const radius = (amplitude: number): number => 14 + amplitude * 7;

describe("splash amplitude", () => {
  it("is ordered by how much water each thing actually moves", () => {
    // A landing is the heaviest thing that happens to this pond; a fire
    // going out is mostly steam.
    expect(SPLASH_LAND).toBeGreaterThan(SPLASH_TAP);
    expect(SPLASH_TAP).toBeGreaterThan(SPLASH_DOUSE);
  });

  it("keeps the prototype's radii", () => {
    // The numbers the prototype was tuned with, in cells.
    expect(radius(SPLASH_TAP)).toBeCloseTo(30.8, 5);
    expect(radius(SPLASH_LAND)).toBeCloseTo(32.2, 5);
    expect(radius(SPLASH_DOUSE)).toBeCloseTo(21.7, 5);
  });

  it("never lets an ordinary hit vanish", () => {
    /*
     * The failure this file exists for: an amplitude mistaken for a radius
     * produced 1.5 cells, which is smaller than the duck that made it.
     * Anything a person is meant to notice clears a duck's own width.
     */
    const DUCK_CELLS = 24;
    for (const a of [SPLASH_DOUSE, SPLASH_TAP, SPLASH_LAND]) {
      expect(radius(a)).toBeGreaterThan(DUCK_CELLS * 0.75);
    }
  });

  it("stays on a scale where 1 is an ordinary touch", () => {
    // If someone later passes a raw radius by mistake, the result is
    // absurd rather than subtly wrong — 14 + 9*7 = 77 cells, three ducks
    // wide, which is visible in one glance rather than in a diff.
    expect(radius(1)).toBe(21);
    expect(radius(9)).toBe(77);
  });
});
