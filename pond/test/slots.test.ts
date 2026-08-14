/**
 * A hat has to land on the head. On all four ducks.
 *
 * `SLOT_ORIGIN` is one table of coordinates, measured on 小吉, and the four
 * fortunes are not the same duck — 末吉 is a smaller one, inset at both
 * ends. A hat pinned at row 2 sat on 小吉's head and floated three rows
 * above 末吉's, and "surprise me" placed into those same slots, so it
 * produced a wrong duck rather than a random one.
 *
 * These assert the thing a person would notice, not the arithmetic: the
 * slot is inside that duck's own drawing, and the head slots are at its
 * head rather than at some absolute row.
 */

import { describe, expect, it } from "vitest";
import {
  DUCKS, FORTUNES, STICKER_GRAB_SLACK, slotOnDuck, stickerAt,
} from "../src/client/sprites.js";
import { SLOT_ORIGIN, STICKERS, type SlotName } from "../src/client/stickers.js";
import { surpriseStickers } from "../src/client/studio.js";

const SLOTS = Object.keys(SLOT_ORIGIN) as SlotName[];

/** The rows/columns this duck actually draws into. */
function inked(key: string): { x0: number; y0: number; x1: number; y1: number } {
  const rows = DUCKS[key]!;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }),
  );
  return { x0, y0, x1, y1 };
}

describe("sticker slots", () => {
  it.each(FORTUNES.map((f) => [f.key, f.jp]))(
    "keeps every slot inside %s (%s)",
    (key) => {
      const box = inked(key);
      for (const slot of SLOTS) {
        const [x, y] = slotOnDuck(SLOT_ORIGIN[slot], key);
        expect(y, `${slot} above ${key}`).toBeGreaterThanOrEqual(box.y0);
        expect(y, `${slot} below ${key}`).toBeLessThanOrEqual(box.y1);
        expect(x, `${slot} left of ${key}`).toBeGreaterThanOrEqual(box.x0);
        expect(x, `${slot} right of ${key}`).toBeLessThanOrEqual(box.x1);
      }
    },
  );

  it("puts the hat on each duck's own head, not on a fixed row", () => {
    // The bug in one assertion: 末吉's head starts three rows lower, so a
    // hat that ignores the sprite is three rows into open water.
    for (const f of FORTUNES) {
      const { y0 } = inked(f.key);
      const [, hatY] = slotOnDuck(SLOT_ORIGIN.hat, f.key);
      expect(hatY, `hat on ${f.key}`).toBe(y0);
    }
    // And the four are genuinely different, so this is not passing by
    // accident on four identical sprites.
    const heads = new Set(FORTUNES.map((f) => inked(f.key).y0));
    expect(heads.size).toBeGreaterThan(1);
  });

  it("orders the slots down the duck on every fortune", () => {
    // Whatever the sprite, a hat is above a face is above a bag.
    for (const f of FORTUNES) {
      const at = (s: SlotName) => slotOnDuck(SLOT_ORIGIN[s], f.key)[1];
      expect(at("hat"), f.key).toBeLessThan(at("face"));
      expect(at("face"), f.key).toBeLessThan(at("neck"));
      expect(at("neck"), f.key).toBeLessThan(at("body"));
    }
  });

  it("falls back to a real duck for a fortune that does not exist", () => {
    // The fortune is a number off a card anyone can retype.
    expect(() => slotOnDuck(SLOT_ORIGIN.hat, "no-such-duck")).not.toThrow();
    expect(slotOnDuck(SLOT_ORIGIN.hat, "no-such-duck")).toEqual(
      slotOnDuck(SLOT_ORIGIN.hat, "little"),
    );
  });
});

describe("surprise me", () => {
  it("never exceeds what the schema stores, on any fortune", () => {
    for (let fortune = 0; fortune < FORTUNES.length; fortune++) {
      for (let run = 0; run < 40; run++) {
        expect(surpriseStickers(fortune).length).toBeLessThanOrEqual(6);
      }
    }
  });

  it("places on the duck it was asked for, never one slot twice", () => {
    for (let fortune = 0; fortune < FORTUNES.length; fortune++) {
      const box = inked(FORTUNES[fortune]!.key);
      for (let run = 0; run < 40; run++) {
        const picked = surpriseStickers(fortune);
        expect(new Set(picked.map((s) => s.id)).size).toBe(picked.length);
        for (const s of picked) {
          expect(s.y).toBeGreaterThanOrEqual(box.y0);
          expect(s.y).toBeLessThanOrEqual(box.y1);
        }
      }
    }
  });

  it("is actually a surprise", () => {
    // A "random" decoration that returns the same duck every time is a
    // preset with a misleading label.
    const seen = new Set(
      Array.from({ length: 60 }, () =>
        surpriseStickers(1).map((s) => s.id).sort().join("+"),
      ),
    );
    expect(seen.size).toBeGreaterThan(3);
  });
});

/**
 * Picking a sticker back up.
 *
 * The studio's copy has always said "Drag stickers to move them", and the
 * canvas has always announced itself as "Tap to place or drag a sticker".
 * Neither was true: a sticker landed on its slot and stayed there forever.
 * These cover the hit test that makes the promise good.
 */
describe("what is under a finger", () => {
  const hat = { id: "tophat", x: 12, y: 4 };
  const def = STICKERS.tophat!;

  it("finds a sticker under its own art", () => {
    expect(stickerAt([hat], hat.x, hat.y)).toBe(0);
  });

  it("finds nothing on bare duck", () => {
    expect(stickerAt([hat], 2, 20)).toBe(-1);
  });

  it("measures from the sticker's anchor, not its top-left", () => {
    /*
     * Every sticker carries an anchor (ax, ay) — the point that lands where
     * you put it. A hat's anchor is near its brim, so its art extends UP
     * and LEFT of the coordinate stored. Testing the stored point as if it
     * were a corner would pass while the grabbable area sat below the hat.
     */
    const top = hat.y - def.ay;
    const left = hat.x - def.ax;
    expect(stickerAt([hat], left, top), "its own top-left corner").toBe(0);
    expect(stickerAt([hat], left - 1, top)).toBe(-1);
    expect(stickerAt([hat], left, top - 1)).toBe(-1);
  });

  it("gives the topmost one when they overlap", () => {
    // They are drawn in order, so the one you can SEE is the last. Handing
    // a tap to the buried one is the kind of thing that feels haunted.
    const under = { id: "tophat", x: 12, y: 4 };
    const over = { id: "crown", x: 12, y: 4 };
    expect(stickerAt([under, over], 12, 4)).toBe(1);
  });

  it("lets a fingertip miss, by the slack and no more", () => {
    /*
     * A sticker can be 2×2 sprite pixels — around 24 screen pixels on a
     * phone, well under the 44 a fingertip covers. Without slack there are
     * stickers you can see and cannot pick up.
     */
    const spark = { id: "spark", x: 6, y: 6 };
    const s = STICKERS.spark!;
    const justOutside = spark.x - s.ax - 1;
    expect(stickerAt([spark], justOutside, spark.y)).toBe(-1);
    expect(stickerAt([spark], justOutside, spark.y, STICKER_GRAB_SLACK)).toBe(0);
    // But not so generous that it swallows the whole duck.
    expect(stickerAt([spark], justOutside - STICKER_GRAB_SLACK - 1, spark.y, STICKER_GRAB_SLACK))
      .toBe(-1);
  });

  it("prefers what was actually hit over what was nearly hit", () => {
    /*
     * The slack is invisible, so it must never outrank visible art. With a
     * single pass, a LATER sticker's halo beat an EARLIER sticker's own
     * pixels: a tap landing squarely on the scarf picked up a sparkle
     * sitting beside it, because the sparkle happened to be added second.
     * Nothing on screen explains that.
     *
     * The point below is chosen to make the conflict real — inside the
     * scarf's box, outside the sparkle's box, inside the sparkle's slack.
     * An earlier version of this test used a point outside the slack too,
     * and passed whichever way the function was written.
     */
    const scarf = { id: "scarf", x: 12, y: 10 };
    const spark = { id: "spark", x: 13, y: 10 };
    const sd = STICKERS.scarf!;
    const sp = STICKERS.spark!;
    const x = scarf.x - sd.ax + 1;
    const y = scarf.y - sd.ay + 1;

    // The conflict, stated rather than assumed.
    expect(x, "inside the scarf").toBeGreaterThanOrEqual(scarf.x - sd.ax);
    expect(x, "outside the sparkle").toBeLessThan(spark.x - sp.ax);
    expect(x, "but inside its slack").toBeGreaterThanOrEqual(spark.x - sp.ax - STICKER_GRAB_SLACK);

    expect(stickerAt([scarf, spark], x, y, STICKER_GRAB_SLACK), "the scarf was hit").toBe(0);
  });

  it("still lets slack decide when nothing was hit at all", () => {
    const spark = { id: "spark", x: 6, y: 6 };
    const s = STICKERS.spark!;
    const near = spark.x - s.ax - 1;
    expect(stickerAt([spark], near, spark.y, 0)).toBe(-1);
    expect(stickerAt([spark], near, spark.y, STICKER_GRAB_SLACK)).toBe(0);
  });

  it("ignores a sticker id it does not know", () => {
    // A duck saved before a sticker was renamed must not crash the studio.
    expect(stickerAt([{ id: "not-a-sticker", x: 5, y: 5 }], 5, 5)).toBe(-1);
  });

  it("finds nothing at all in an empty list", () => {
    expect(stickerAt([], 5, 5)).toBe(-1);
  });
});
