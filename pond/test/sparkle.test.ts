/**
 * The sparkle engine's timing and shapes.
 *
 * FLOW.md is unusually specific about this, and says why: the 170 ms hold
 * is what makes a shape read as something deliberate appearing rather than
 * as twinkle, and "it is the thing a rewrite would have quietly lost".
 *
 * So the hold is tested directly, by the property it exists for: there is a
 * moment when every pixel of a shape is on at once.
 *
 * The shapes themselves are asserted as ART, not as data — a bloom has to
 * be symmetric and have a core, or it is not the shape that was drawn. A
 * test that only counted pixels would pass on a typo that moved one.
 */

import { describe, expect, it } from "vitest";
import {
  BAD_LUCK_BURN_MS, BAD_LUCK_MIST_AT_MS, PETAL_LIFE_MS, SHAPES, SHOP_PAIR,
  arrival, duration, petals, spawnShape, visibleAt, type SparklePixel,
} from "../src/client/sparkle.js";

/** No jitter, so a schedule can be asserted to the millisecond. */
const still = () => 0;

const one = (shape: readonly string[], cell = 2): SparklePixel[] => {
  const out: SparklePixel[] = [];
  spawnShape(out, 0, 0, shape, "#p", "#c", cell, 0, still);
  return out;
};

describe("the shapes are the shapes", () => {
  it("is a rectangular grid — a ragged row would shear the shape", () => {
    for (const [name, rows] of Object.entries(SHAPES)) {
      const widths = new Set(rows.map((r) => r.length));
      expect(widths.size, `${name} has rows of differing width`).toBe(1);
    }
  });

  it("uses only the three characters the renderer understands", () => {
    for (const [name, rows] of Object.entries(SHAPES)) {
      const chars = new Set(rows.join("").split(""));
      for (const c of chars) {
        expect(["." , "p", "c", "r"], `${name} contains ${c}`).toContain(c);
      }
    }
  });

  it("is symmetric left-to-right — except the cloud, which must not be", () => {
    /*
     * A bloom, a ring, a sun and a sparkle are geometry: any lean in them
     * is a typo. A CLOUD is not — a symmetric cloud reads as a logo, and
     * the prototype's is deliberately lopsided. So the rule is asserted
     * where it means something and inverted where it does not, rather than
     * softened to nothing.
     */
    for (const [name, rows] of Object.entries(SHAPES)) {
      if (name === "cloud") continue;
      for (const row of rows) {
        expect([...row].reverse().join(""), `${name}: "${row}"`).toBe(row);
      }
    }
    expect(SHAPES.cloud.some((r) => [...r].reverse().join("") !== r)).toBe(true);
  });

  it("gives the bloom and the flower a core to build out from", () => {
    expect(SHAPES.bloom.join("")).toContain("c");
    expect(SHAPES.flower.join("")).toContain("c");
  });
});

describe("a shape builds outward, holds, and unbuilds outward", () => {
  it("has a moment where every pixel is on at once", () => {
    // The hold. Without it the first pixels are leaving before the last
    // have arrived and the shape never exists as a shape.
    const px = one(SHAPES.bloom);
    const lastOn = Math.max(...px.map((p) => p.on));
    const firstOff = Math.min(...px.map((p) => p.off));
    expect(firstOff).toBeGreaterThan(lastOn);
    // And the gap is the documented hold, not an accident of the numbers.
    expect(firstOff - lastOn).toBeGreaterThanOrEqual(170);
  });

  it("turns the centre on first and off first", () => {
    const px = one(SHAPES.bloom);
    const centre = px.reduce((a, b) => (a.on <= b.on ? a : b));
    const rim = px.reduce((a, b) => (a.on >= b.on ? a : b));
    expect(centre.on).toBeLessThan(rim.on);
    expect(centre.off).toBeLessThan(rim.off);
  });

  it("measures distance the Manhattan way — a diamond, not a disc", () => {
    /*
     * On a 9×9 grid the corner-most lit pixel of a bloom is 4 steps out
     * either way. Euclidean would put the diagonal at √(2²+2²) ≈ 2.83
     * where Manhattan puts it at 4, and the shape would open as a circle.
     */
    const px = one(SHAPES.bloom);
    const spread = Math.max(...px.map((p) => p.on)) - Math.min(...px.map((p) => p.on));
    expect(spread).toBe(4 * 36); // 4 Manhattan steps at ON_PER_PX
  });

  it("never schedules a pixel before the shape starts", () => {
    expect(Math.min(...one(SHAPES.ring).map((p) => p.on))).toBeGreaterThanOrEqual(0);
  });

  it("scales the drawn pixel with cell, keeping the shop's odd units", () => {
    // cell 2 → 1 sprite pixel, cell 3 → 1.5. Getting this backwards makes
    // every 大吉 shape half size, which reads as "the sparkles are broken".
    expect(one(SHAPES.ring, 2)[0]!.size).toBe(1);
    expect(one(SHAPES.ring, 3)[0]!.size).toBe(1.5);
  });

  it("centres the shape on the point it was given", () => {
    const px = one(SHAPES.flower);
    const xs = px.map((p) => p.x);
    const ys = px.map((p) => p.y);
    // Mean of a left-right symmetric shape sits on its own centre.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(-0.5, 5);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-0.5, 5);
  });
});

describe("the four arrivals", () => {
  it("stages 大吉, 小吉 and 末吉, and stages nothing for 凶", () => {
    for (const fortune of [0, 1, 2]) {
      const px = arrival(fortune, 100, 100);
      expect(px.length, `fortune ${fortune}`).toBeGreaterThan(10);
      expect(duration(px)).toBeGreaterThan(0);
    }
    /*
     * 凶 is deliberately empty. Its arrival is the FIRE, which is physics
     * and lives with the ducks — if a future change gives it shapes too,
     * the moment stops being "the water put it out" and becomes a
     * celebration of bad luck.
     */
    expect(arrival(3, 100, 100)).toHaveLength(0);
  });

  it("makes 大吉 the loudest, by a distance", () => {
    const great = arrival(0, 0, 0).length;
    for (const other of [1, 2, 3]) {
      expect(great).toBeGreaterThan(arrival(other, 0, 0).length);
    }
  });

  it("staggers 大吉 across roughly the documented 700 ms", () => {
    const starts = arrival(0, 0, 0).map((p) => p.on);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(600);
  });

  it("dresses 大吉 in the shop's own pair", () => {
    // The whole point of porting rather than rewriting: an arrival in the
    // pond and a sparkle on byproductlab.com are the same hand.
    const colours = new Set(arrival(0, 0, 0).map((p) => p.colour));
    for (const c of SHOP_PAIR) expect(colours).toContain(c);
  });

  it("brings 末吉's cloud in after its sun", () => {
    // Non-committal, which is the point of 末吉 — the cloud has to arrive
    // second or it is just a cloud.
    const px = arrival(2, 0, 0);
    expect(px.filter((p) => p.on < 300).length).toBeGreaterThan(0);
    expect(px.filter((p) => p.on > 500).length).toBeGreaterThan(0);
  });

  it("puts 凶's steam up before its flame goes out", () => {
    // Water hitting something hot hisses first and goes out second. The
    // other order reads as the duck exhaling.
    expect(BAD_LUCK_MIST_AT_MS).toBeLessThan(BAD_LUCK_BURN_MS);
  });

  it("places its shapes off-centre, not on a ring", () => {
    // Six shapes evenly spaced on a circle read as a loading spinner. The
    // prototype's offsets are hand-picked and lopsided on purpose.
    const px = arrival(0, 500, 500);
    const dists = px.map((p) => Math.round(Math.hypot(p.x - 500, p.y - 500)));
    expect(new Set(dists).size).toBeGreaterThan(6);
  });
});

describe("reduced motion", () => {
  const px = one(SHAPES.bloom);

  it("shows the whole shape at once rather than building it", () => {
    const atStart = px.filter((p) => visibleAt(p, 10, true));
    expect(atStart).toHaveLength(px.length);
  });

  it("still takes it away — an arrival is a moment, not a decoration", () => {
    expect(px.some((p) => visibleAt(p, 500, true))).toBe(false);
  });

  it("builds outward when motion is welcome", () => {
    const atStart = px.filter((p) => visibleAt(p, 10, false));
    expect(atStart.length).toBeGreaterThan(0);
    expect(atStart.length).toBeLessThan(px.length);
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
