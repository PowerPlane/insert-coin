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

import { beforeEach, describe, expect, it } from "vitest";
import {
  claimIsFresh, claimIsSpent, isClaimUrl, rememberClaimAttempt,
} from "../src/client/keeper.js";

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

/**
 * An armed tag stays armed.
 *
 * Blowing four times writes `&g=` into the tag and it STAYS there. The
 * claim is spent the first time it is used; the card goes on serving the
 * same URL for every tap afterwards. So every ordinary tap of a card that
 * was ever armed looked like a claim, the server correctly refused it as
 * already used, and the person got "This card could not be set up" while
 * trying to make a duck.
 *
 * The server cannot help: it returns the same refusal for a spent counter
 * as for a forged token, on purpose. The client can, because it knows
 * whether it has spent this counter before.
 */
describe("a claim is only fresh once", () => {
  const armed = (counter: number) =>
    new URL(`https://ducky.davidyang.work/?d=1&c=5BKZH69H`
      + `&g=${counter.toString(16).padStart(4, "0")}&t=5d29221795`);

  /*
   * These tests run in the node environment, which has no localStorage —
   * and the thing under test is precisely what the client remembers
   * between taps. A three-line map is a truer stand-in than a mock of the
   * function itself, which would only assert that the mock was called.
   */
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  });

  it("is fresh the first time and stale after", () => {
    const url = armed(3);
    expect(claimIsFresh(url), "never seen").toBe(true);
    rememberClaimAttempt(url);
    expect(claimIsFresh(url), "the tag will keep offering it").toBe(false);
  });

  it("is fresh again once the card is blown on anew", () => {
    rememberClaimAttempt(armed(3));
    expect(claimIsFresh(armed(4)), "a higher counter is a new gesture").toBe(true);
  });

  it("treats a counter below the last one as stale", () => {
    // Out-of-order taps, or a tag read before it finished being written.
    rememberClaimAttempt(armed(9));
    expect(claimIsFresh(armed(5))).toBe(false);
  });

  it("remembers per card, so one card does not silence another", () => {
    rememberClaimAttempt(armed(3));
    const other = new URL(
      "https://ducky.davidyang.work/?d=1&c=SECNDCRD&g=0003&t=5d29221795");
    expect(claimIsFresh(other)).toBe(true);
  });

  it("is never fresh for something that is not a claim", () => {
    expect(claimIsFresh(new URL("https://x.test/?d=1&c=5BKZH69H&g=0000&t=abc"))).toBe(false);
  });

  /*
   * ══ ASKING IS NOT SPENDING ══
   * `claimCard` does not advance the counter to raise the takeover
   * question — the card stays armed on purpose, so declining costs
   * nothing. The client recorded the question as though it were an
   * answer, and the two halves of one belief disagreed: the server held
   * the gesture open while this browser wrote it off. The card then went
   * silent on the only phone that mattered.
   */
  it("does not spend the counter merely for asking", () => {
    expect(claimIsSpent("takeover"), "the server charged nothing").toBe(false);
    expect(claimIsSpent("none"), "never reached the server").toBe(false);
    expect(claimIsSpent("claimed")).toBe(true);
    expect(claimIsSpent("refused")).toBe(true);
  });

  it("keeps the gesture live when a takeover goes unanswered", () => {
    const url = armed(3);
    // The tab is closed, or the phone locks, while the question is up.
    if (claimIsSpent("takeover")) rememberClaimAttempt(url);
    expect(claimIsFresh(url), "nothing was decided, so nothing is spent").toBe(true);
  });

  it("stops asking once the same counter has been declined", () => {
    const url = armed(3);
    // Declining IS an answer, recorded at the button rather than at the
    // moment the question went up. Same counter, asked once.
    rememberClaimAttempt(url);
    expect(claimIsFresh(url), "they already said no").toBe(false);
    // And four fresh blows bump the counter, so the card is not lost.
    expect(claimIsFresh(armed(4)), "a new gesture asks again").toBe(true);
  });
});
