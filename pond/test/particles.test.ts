/**
 * Thrown pixels.
 *
 * These are simulated rather than scheduled, which is the whole reason
 * they are a separate module from the sparkle engine — so the tests are
 * about physics rather than about timing: does a thrown thing slow down,
 * does steam climb, does water not, and does everything eventually stop.
 *
 * `random` is injectable so a "random" spray can be asserted exactly. A
 * test that seeds nothing can only check that particles exist, which is
 * the assertion that survives almost any bug.
 */

import { describe, expect, it } from "vitest";
import {
  advanceParticles, douseMist, emit, fireworkStreamers, splashDroplets,
  type Particle,
} from "../src/client/particles.js";

/** Deterministic stand-in for Math.random: walks 0, 0.25, 0.5, 0.75, … */
function cycle(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const TICK = 1 / 12; // one stop-motion tick

describe("a thrown pixel", () => {
  it("slows down and stops", () => {
    const list: Particle[] = [];
    emit(list, 0, 0, 10, 0, "#fff", 1);
    const speeds: number[] = [];
    for (let i = 0; i < 5; i++) {
      advanceParticles(list, TICK);
      speeds.push(Math.abs(list[0]!.vx));
    }
    // Strictly decreasing — drag, not a constant velocity.
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    }
    expect(speeds[speeds.length - 1]!).toBeLessThan(4);
  });

  it("is removed when its life runs out, and not before", () => {
    const list: Particle[] = [];
    emit(list, 0, 0, 0, 0, "#fff", TICK * 2.5);
    expect(advanceParticles(list, TICK)).toHaveLength(1);
    expect(advanceParticles(list, TICK)).toHaveLength(1);
    expect(advanceParticles(list, TICK)).toHaveLength(0);
  });

  it("keeps the survivors when one in the middle dies", () => {
    // The compaction loop rewrites the array in place; an off-by-one here
    // would drop a live particle or resurrect a dead one.
    const list: Particle[] = [];
    emit(list, 1, 0, 0, 0, "#a", 10);
    emit(list, 2, 0, 0, 0, "#b", TICK / 2);
    emit(list, 3, 0, 0, 0, "#c", 10);
    advanceParticles(list, TICK);
    expect(list.map((p) => p.colour)).toEqual(["#a", "#c"]);
  });
});

describe("steam and water part company", () => {
  it("steam climbs and water does not", () => {
    const water: Particle[] = [];
    const steam: Particle[] = [];
    emit(water, 0, 0, 0, 0, "#fff", 1, false);
    emit(steam, 0, 0, 0, 0, "#fff", 1, true);

    advanceParticles(water, TICK);
    advanceParticles(steam, TICK);

    // Up is negative y.
    expect(steam[0]!.y).toBeLessThan(0);
    expect(water[0]!.y).toBe(0);
  });
});

describe("a splash", () => {
  it("throws more water the harder the hit", () => {
    const soft: Particle[] = [];
    const hard: Particle[] = [];
    splashDroplets(soft, 0, 0, 1.1, cycle([0.5]));
    splashDroplets(hard, 0, 0, 2.6, cycle([0.5]));
    expect(hard.length).toBeGreaterThan(soft.length);

    const fastest = (l: Particle[]) => Math.max(...l.map((p) => Math.hypot(p.vx, p.vy)));
    expect(fastest(hard)).toBeGreaterThan(fastest(soft));
  });

  it("throws in every direction, not in a line", () => {
    const list: Particle[] = [];
    splashDroplets(list, 0, 0, 2.4);
    const up = list.some((p) => p.vy < 0);
    const down = list.some((p) => p.vy > 0);
    const left = list.some((p) => p.vx < 0);
    const right = list.some((p) => p.vx > 0);
    expect([up, down, left, right]).toEqual([true, true, true, true]);
  });

  it("does not rise — water thrown up comes back", () => {
    const list: Particle[] = [];
    splashDroplets(list, 0, 0, 2.4);
    expect(list.every((p) => !p.rise)).toBe(true);
  });
});

describe("douse mist", () => {
  it("rises, and leaves the duck rather than sitting on it", () => {
    const list: Particle[] = [];
    douseMist(list, 0, 0, 20, cycle([0.5]));
    expect(list).toHaveLength(20);
    expect(list.every((p) => p.rise)).toBe(true);
    // Born with an upward push, before the rise term even applies.
    expect(list.every((p) => p.vy < 0)).toBe(true);
  });

  it("lingers longer than a splash — steam hangs, water falls", () => {
    const mist: Particle[] = [];
    const drops: Particle[] = [];
    douseMist(mist, 0, 0, 20, cycle([0.5]));
    splashDroplets(drops, 0, 0, 2.4, cycle([0.5]));
    const shortest = (l: Particle[]) => Math.min(...l.map((p) => p.life));
    expect(shortest(mist)).toBeGreaterThan(shortest(drops));
  });
});

describe("大吉 streamers", () => {
  it("goes up in two waves, so it reads as a firework not a bang", () => {
    const list: Particle[] = [];
    fireworkStreamers(list, 0, 0, ["#FFCA00", "#FFE9A8"], cycle([0.5]));
    expect(list).toHaveLength(40);
    expect(list.every((p) => p.rise)).toBe(true);

    // The second wave is slower and lives longer, so both are in the air
    // at once rather than one following the other.
    const first = list.slice(0, 20);
    const second = list.slice(20);
    const speed = (l: Particle[]) => Math.hypot(l[0]!.vx, l[0]!.vy);
    expect(speed(second)).toBeLessThan(speed(first));
    expect(second[0]!.life).toBeGreaterThan(first[0]!.life);
  });
});
