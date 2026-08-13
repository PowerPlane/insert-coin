/**
 * The sparkle engine's timing.
 *
 * FLOW.md is unusually specific about this, and says why: the 170 ms hold
 * is what makes a shape read as something deliberate appearing rather than
 * as twinkle, and "it is the thing a rewrite would have quietly lost".
 *
 * So the hold is tested directly, by the property it exists for: there is a
 * moment when every pixel of a shape is on at once.
 */

import { describe, expect, it } from "vitest";
import { arrival, duration, petals, schedule, PETAL_LIFE_MS } from "../src/client/sparkle.js";

const shape = (n: number) => ({
  wx: 0,
  wy: 0,
  at: 0,
  cells: Array.from({ length: n }, (_, i) => ({
    x: Math.cos((i / n) * Math.PI * 2) * 5,
    y: Math.sin((i / n) * Math.PI * 2) * 5,
    colour: "#fff",
  })),
});

describe("a shape builds outward, holds, and unbuilds outward", () => {
  it("has a moment where every pixel is on at once", () => {
    // The hold. Without it the first pixels are leaving before the last
    // have arrived and the shape never exists as a shape.
    const px = schedule(shape(12));
    const lastOn = Math.max(...px.map((p) => p.on));
    const firstOff = Math.min(...px.map((p) => p.off));
    expect(firstOff).toBeGreaterThan(lastOn);
    // And the gap is the documented hold, not an accident of the numbers.
    expect(firstOff - lastOn).toBeGreaterThanOrEqual(170);
  });

  it("turns the centre on first and off first", () => {
    const px = schedule({
      wx: 0, wy: 0, at: 0,
      cells: [
        { x: 0, y: 0, colour: "#fff" },   // the centre
        { x: 8, y: 0, colour: "#fff" },   // the rim
      ],
    });
    const [centre, rim] = px;
    expect(centre!.on).toBeLessThan(rim!.on);
    expect(centre!.off).toBeLessThan(rim!.off);
  });

  it("is deterministic, so a shape does not shimmer between frames", () => {
    // Jitter derived from the pixel, not from Math.random: re-scheduling
    // every draw would make the whole thing sparkle in the wrong way.
    const a = schedule(shape(9));
    const b = schedule(shape(9));
    expect(a).toEqual(b);
  });

  it("never schedules a pixel before the shape starts", () => {
    const px = schedule({ ...shape(10), at: 0 });
    expect(Math.min(...px.map((p) => p.on))).toBeGreaterThanOrEqual(0);
  });
});

describe("the four arrivals", () => {
  it("gives every fortune something to show", () => {
    for (const fortune of [0, 1, 2, 3]) {
      const px = arrival(fortune, 100, 100);
      expect(px.length, `fortune ${fortune}`).toBeGreaterThan(10);
      expect(duration(px)).toBeGreaterThan(0);
    }
  });

  it("makes 大吉 the loudest, by a distance", () => {
    // FLOW.md: seven shapes over 700 ms, two waves. It should out-pixel
    // every other arrival, because it is the one nobody else got today.
    const great = arrival(0, 0, 0).length;
    for (const other of [1, 2, 3]) {
      expect(great).toBeGreaterThan(arrival(other, 0, 0).length);
    }
  });

  it("staggers 大吉 across roughly the documented 700 ms", () => {
    const px = arrival(0, 0, 0);
    const starts = px.map((p) => p.on);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(600);
  });

  it("brings 末吉's cloud in after its sun", () => {
    // Non-committal, which is the point of 末吉 — the cloud has to arrive
    // second or it is just a cloud.
    const px = arrival(2, 0, 0);
    const early = px.filter((p) => p.on < 300);
    const late = px.filter((p) => p.on > 500);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
  });

  it("puts 凶's fire out — mist follows flame", () => {
    const px = arrival(3, 0, 0);
    const flame = px.filter((p) => p.colour === "#FF4B4B" || p.colour === "#FF8953");
    const mist = px.filter((p) => p.colour === "#FFFFFF" || p.colour === "#EDFAFE");
    expect(flame.length).toBeGreaterThan(0);
    expect(mist.length).toBeGreaterThan(0);
    expect(Math.min(...mist.map((p) => p.on))).toBeGreaterThan(
      Math.min(...flame.map((p) => p.on)),
    );
  });
});

describe("petals, which only 小吉 leaves", () => {
  it("last about three minutes", () => {
    expect(PETAL_LIFE_MS).toBe(180_000);
  });

  it("drift at different rates, so they do not move as one sheet", () => {
    const p = petals(0, 0, 0);
    expect(new Set(p.map((x) => x.drift)).size).toBeGreaterThan(1);
  });

  it("are scattered around the duck rather than stacked on it", () => {
    const p = petals(100, 100, 0);
    expect(new Set(p.map((x) => `${Math.round(x.wx)},${Math.round(x.wy)}`)).size).toBe(p.length);
  });
});
