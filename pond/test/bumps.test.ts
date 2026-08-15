/**
 * The card must not contradict itself.
 *
 * It states a duck's bumps as a sentence and then draws the people who
 * sent them. Those two numbers come from different requests, so they can
 * disagree — and when they did, the card read "nobody has bumped it yet"
 * directly above a row of four people who had.
 */

import { describe, expect, it } from "vitest";
import { bumpsToShow } from "../src/client/bumps.js";

describe("what the card claims", () => {
  it("never says nobody while showing somebody", () => {
    // The exact contradiction, as seen on the bench.
    expect(bumpsToShow(0, [{ count: 3 }, { count: 2 }, { count: 2 }, { count: 1 }])).toBe(8);
  });

  it("keeps the polled figure when it is the bigger one", () => {
    /*
     * The list is capped at the top few senders, so its total is a FLOOR
     * on the real count. A duck with fifty bumps from thirty people
     * returns five rows summing to nowhere near fifty, and believing the
     * list there would revise the count DOWN on opening the card.
     */
    expect(bumpsToShow(50, [{ count: 5 }, { count: 4 }, { count: 3 }])).toBe(50);
  });

  it("agrees with itself when the two agree", () => {
    expect(bumpsToShow(6, [{ count: 4 }, { count: 2 }])).toBe(6);
  });

  it("says nobody only when nobody has", () => {
    expect(bumpsToShow(0, [])).toBe(0);
  });

  it("is not dragged below what is on screen by a bad poll", () => {
    // A missing or nonsense poll figure must not beat the named list.
    expect(bumpsToShow(-1, [{ count: 2 }])).toBe(2);
    expect(bumpsToShow(Number.NaN, [{ count: 2 }])).toBe(2);
  });

  it("ignores a row with no usable count rather than printing NaN", () => {
    expect(bumpsToShow(0, [{ count: Number.NaN }, { count: 3 }])).toBe(3);
  });
});
