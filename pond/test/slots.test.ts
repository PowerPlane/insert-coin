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
import { DUCKS, FORTUNES, slotOnDuck } from "../src/client/sprites.js";
import { SLOT_ORIGIN, type SlotName } from "../src/client/stickers.js";
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
