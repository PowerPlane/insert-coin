/**
 * What a real tag's URL actually looks like.
 *
 * ══ EVERY BENCH RUN USED THE WRONG URL ══
 * The harness, the screenshots and every route test reached the pond with
 * `?d=1` or `?debug=1` — a typed URL, with no `&c=`, `&g=` or `&t=` on it.
 * A real tag has all three, always: `config.h` writes them once at
 * provisioning and only the fortune digit is ever patched.
 *
 * So the one shape the product exists to handle was the one shape nothing
 * ever exercised, and two bugs lived there undisturbed until David tapped
 * a card:
 *
 *   every ordinary tap reported "This card could not be set up", because
 *   the client read "carries a signature" as "is claiming",
 *
 *   and the arrival never played, because `beginRelease` was gated behind
 *   "no `?t=`" — always false on a real card.
 *
 * These tests are about the URL grammar rather than about the DOM, so
 * they can state the rule that both bugs broke without a browser.
 */

import { describe, expect, it } from "vitest";
import { isClaimUrl } from "../src/client/keeper.js";

/** A tag, as provisioned. Only the digit changes between taps. */
const tag = (digit: number, counter = 0) =>
  new URL(`https://ducky.davidyang.work/?d=${digit}&c=5BKZH69H`
    + `&g=${counter.toString(16).padStart(4, "0")}&t=5d29221795`);

describe("a tap is not a claim", () => {
  it("does not read an ordinary tap as a claim", () => {
    // The exact case David saw: a card at rest, tapped for a fortune.
    expect(isClaimUrl(tag(1)), "d=1, g=0000").toBe(false);
    expect(isClaimUrl(tag(4)), "any fortune").toBe(false);
    expect(isClaimUrl(tag(0)), "and a card whose window has closed").toBe(false);
  });

  it("reads a card armed by four blows as a claim", () => {
    expect(isClaimUrl(tag(0, 1)), "the first claim a card ever makes").toBe(true);
    expect(isClaimUrl(tag(1, 7))).toBe(true);
    expect(isClaimUrl(tag(0, 0xffff)), "the last counter the firmware can write").toBe(true);
  });

  it("is not fooled by a signature alone, which every tag carries", () => {
    /*
     * The belief this replaces, stated so it cannot come back: the code
     * said "no `?t=`" and commented that an armed card and a fortune
     * "cannot both be true". They are both true on every real tap.
     */
    const ordinary = tag(2);
    expect(ordinary.searchParams.has("t"), "a signature is always there").toBe(true);
    expect(ordinary.searchParams.has("d"), "and so is a fortune").toBe(true);
    expect(isClaimUrl(ordinary), "and it is still not a claim").toBe(false);
  });

  it("wants all three parameters, not just a counter", () => {
    expect(isClaimUrl(new URL("https://x.test/?g=0001&t=abc")), "no card").toBe(false);
    expect(isClaimUrl(new URL("https://x.test/?c=5BKZH69H&g=0001")), "no token").toBe(false);
    expect(isClaimUrl(new URL("https://x.test/?c=5BKZH69H&t=abc")), "no counter").toBe(false);
  });

  it("refuses a counter that is not a number", () => {
    expect(isClaimUrl(new URL("https://x.test/?c=5BKZH69H&g=zzzz&t=abc"))).toBe(false);
    expect(isClaimUrl(new URL("https://x.test/?c=5BKZH69H&g=&t=abc"))).toBe(false);
    expect(isClaimUrl(new URL("https://x.test/?c=5BKZH69H&g=-1&t=abc"))).toBe(false);
  });
});
