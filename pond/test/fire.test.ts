/**
 * Who gets to say whether a duck is on fire.
 *
 * The pond polls every twenty seconds, so the server's answer is a snapshot
 * that can be twenty seconds old. The client's answer is what the person is
 * looking at. When they disagree, the rule is:
 *
 *   the SERVER lights fires, the CLIENT puts them out.
 *
 * Every case below is something a person could watch happen on a phone, and
 * the first one is the bug this file exists for: tapping a burning duck, and
 * seeing it light again a moment later because a stale poll said so.
 */

import { describe, expect, it } from "vitest";
import { ignite, mergeFire, placeDucks, type Placed } from "../src/client/pond-view.js";
import { BAD_LUCK_BURN_MS } from "../src/client/sparkle.js";

/** A 凶 in the water. Only the fields the fire rules touch. */
function duck(over: Partial<Placed> = {}): Placed {
  return {
    id: "d1", slug: "d1", fortune: 3, tint: 0, stickers: [], paint: "",
    name: "", message: "", created: 0, bumps: 0, rescues: 0,
    fire: null, say: null, keeper: null,
    wx: 0, wy: 0, flip: false, burning: false,
    ...over,
  };
}

/** As the server sends it: which fire, and how many seconds it has left. */
const serverFire = (litAt: number, burnsFor = 90) => ({ litAt, burnsFor });

describe("the server lights fires", () => {
  it("lights a duck the client did not know was burning", () => {
    const d = duck();
    mergeFire(d, serverFire(1000), 0);
    expect(d.burning).toBe(true);
    expect(d.fireLitAt).toBe(1000);
  });

  it("lights it with the time REMAINING, not a fresh full burn", () => {
    /*
     * Somebody opening the pond 70 seconds into a 90-second fire should see
     * it go out in 20, not in 90. Sending an end TIMESTAMP instead would
     * mean trusting the phone's clock, and phone clocks are often minutes
     * out — the fire would then be either already over or never-ending.
     */
    const d = duck();
    mergeFire(d, serverFire(1000, 20), 5_000);
    expect(d.burnUntil).toBe(5_000 + 20_000);
  });

  it("does not restart a fire it has already reported", () => {
    // Otherwise every poll resets the countdown and the fire is eternal.
    const d = duck();
    mergeFire(d, serverFire(1000, 90), 0);
    const first = d.burnUntil;
    mergeFire(d, serverFire(1000, 70), 20_000);
    expect(d.burnUntil).toBe(first);
  });

  it("lights a genuinely new fire on the same duck", () => {
    // A duck can catch light again after FIRE_REIGNITE_SEC. A different
    // `litAt` is a different fire and must be treated as one.
    const d = duck();
    mergeFire(d, serverFire(1000), 0);
    d.burning = false; // it went out
    mergeFire(d, serverFire(9000), 600_000);
    expect(d.burning).toBe(true);
    expect(d.fireLitAt).toBe(9000);
  });
});

describe("the client puts them out", () => {
  it("does not re-light a fire the user just doused", () => {
    /*
     * ══ THE BUG THIS FILE EXISTS FOR ══
     * Tap a burning duck: the flame stops immediately, because the water is
     * the ANSWER to the gesture. The POST is still in flight, so the next
     * poll's snapshot still says burning — and the duck lit up again for a
     * whole cycle, which reads as the tap not having worked.
     */
    const d = duck();
    mergeFire(d, serverFire(1000), 0);
    expect(d.burning).toBe(true);

    // The user taps. douse() sets this; the server has not caught up.
    d.burning = false;
    d.burnUntil = undefined;

    mergeFire(d, serverFire(1000, 80), 10_000);
    expect(d.burning, "a doused fire must stay out").toBe(false);
  });

  it("does not re-light one that simply burned down", () => {
    const d = duck();
    mergeFire(d, serverFire(1000, 90), 0);
    d.burning = false; // advanceFires reached its deadline
    d.burnUntil = undefined;
    mergeFire(d, serverFire(1000, 2), 88_000);
    expect(d.burning).toBe(false);
  });

  it("agrees the moment the server catches up", () => {
    const d = duck({ burning: false });
    mergeFire(d, null, 20_000);
    expect(d.burning).toBe(false);
    expect(d.fireLitAt).toBeUndefined();
  });
});

describe("the arrival burn, which the server never hears about", () => {
  it("survives a poll that says nothing is alight", () => {
    /*
     * 凶 lands ALIGHT — 620ms, client-side, part of the animation rather
     * than a row in the fires table. A poll landing inside that window sends
     * `fire: null`, and taking it literally would snuff the arrival halfway
     * through the one beat that closes the loop with the card.
     */
    const d = duck();
    ignite(d, BAD_LUCK_BURN_MS, undefined, 0);
    mergeFire(d, null, 300);
    expect(d.burning).toBe(true);
  });

  it("is not immortal — the same poll ends it once its time is up", () => {
    const d = duck();
    ignite(d, BAD_LUCK_BURN_MS, undefined, 0);
    mergeFire(d, null, BAD_LUCK_BURN_MS + 1);
    expect(d.burning).toBe(false);
  });

  it("gives way to a real fire the server starts", () => {
    const d = duck();
    ignite(d, BAD_LUCK_BURN_MS, undefined, 0);
    mergeFire(d, serverFire(1000), 300);
    expect(d.fireLitAt).toBe(1000);
    expect(d.burnUntil).toBe(300 + 90_000);
  });
});

describe("a duck whose fire the response never mentioned", () => {
  /*
   * ══ A MISSING FIELD IS NOT A FIRE ══
   * The first version read `d.fire !== null`, which is true for `undefined`
   * — so one stale cached /api/pond, served without the field, set THE
   * WHOLE POND alight at once. Thirteen ducks, all burning, on a reload.
   *
   * Version skew is not exotic here: the bundle is committed and a browser
   * can hold an old copy of it, or an old response, for a long time. The
   * default for "I do not know" has to be the calm one.
   */
  const withoutFire = () => {
    const d = duck() as unknown as Record<string, unknown>;
    delete d.fire;
    return d as unknown as Placed;
  };

  it("is not on fire", () => {
    expect(placeDucks([withoutFire()], 1000)[0]!.burning).toBe(false);
  });

  it("is not set alight by a poll either", () => {
    const d = duck();
    mergeFire(d, undefined as unknown as Placed["fire"], 0);
    expect(d.burning).toBe(false);
  });

  it("still lights the ducks the response DOES name", () => {
    // The guard must not be so cautious that it puts real fires out.
    const lit = duck({ fire: serverFire(1000) });
    expect(placeDucks([withoutFire(), lit], 1000).map((x) => x.burning)).toEqual([false, true]);
  });
});

describe("igniting", () => {
  it("clears the steam flag, so a second fire steams again", () => {
    // Otherwise a duck that burned once would go out silently ever after.
    const d = duck({ misted: true });
    ignite(d, 5000, 1, 0);
    expect(d.misted).toBe(false);
  });
});
