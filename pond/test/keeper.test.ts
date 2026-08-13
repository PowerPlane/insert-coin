/**
 * Claiming a card.
 *
 * BUILD-PLAN replaced the original design — a counter accepted if unseen —
 * because it was not a credential: everything in the URL is typed text, so
 * an unseen number proves only that nobody used THAT number yet. Anyone who
 * learned a serial could walk the counter space by hand.
 *
 * A claim needs the signature AND a counter above the high-water mark.
 * Every test here is one half of that, or the thing the epochs exist for:
 * a new keeper must not inherit the last one's consent.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardToken } from "../src/card/identity.js";
import { claimCard, keeperState, saveKeeper } from "../src/worker/keeper.js";
import type { Db } from "../src/db/types.js";
import type { Env } from "../src/worker/types.js";
import { count, editKeyFor, fresh, makeDuck } from "./helpers.js";

const SECRET_HEX = "000102030405060708090a0b0c0d0e0f";
const SECRET = new Uint8Array((SECRET_HEX.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const CARD = "7F3A9KQZ";

let open: Db | null = null;
beforeEach(() => {
  process.env.CARD_SECRET = SECRET_HEX;
});
afterEach(() => {
  open?.close();
  open = null;
  delete process.env.CARD_SECRET;
});

async function env(): Promise<Env> {
  const db = (open = await fresh());
  await db.prepare(`INSERT INTO cards (id, label, created) VALUES (?1, '', 1)`).bind(CARD).run();
  return { DB: db, SESSION_SECRET: "t", ADMIN_PASSWORD: "t" };
}

const sign = (counter: number) => cardToken(SECRET, CARD, counter);

describe("a claim needs a signature", () => {
  it("accepts one the card actually signed", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    expect("error" in claim).toBe(false);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM card_epochs WHERE ended IS NULL`)).toBe(1);
  });

  it("refuses a forged one", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, "0000000000");
    expect(claim).toEqual({ error: "bad token" });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM card_epochs`)).toBe(0);
  });

  it("refuses a signature for a different counter", async () => {
    // The whole point: the token is over serial AND counter, so a claim
    // seen at counter 1 cannot be replayed at 2.
    const e = await env();
    expect(await claimCard(e, CARD, 2, sign(1))).toEqual({ error: "bad token" });
  });

  it("refuses a signature for a different card", async () => {
    const e = await env();
    await e.DB.prepare(`INSERT INTO cards (id, label, created) VALUES ('ZZZZZZZZ', '', 1)`).run();
    expect(await claimCard(e, "ZZZZZZZZ", 1, sign(1))).toEqual({ error: "bad token" });
  });

  it("refuses everything when the server has no secret", async () => {
    // A server that cannot verify must not fall back to trusting. This is
    // the failure mode where CARD_SECRET is simply never set in production.
    const e = await env();
    delete process.env.CARD_SECRET;
    expect(await claimCard(e, CARD, 1, sign(1))).toEqual({ error: "no secret" });
  });

  it("refuses a card that has been switched off", async () => {
    const e = await env();
    await e.DB.prepare(`UPDATE cards SET disabled = 1 WHERE id = ?1`).bind(CARD).run();
    expect(await claimCard(e, CARD, 1, sign(1))).toEqual({ error: "unknown card" });
  });
});

describe("a claim needs a counter above the high-water mark", () => {
  it("refuses a counter that has already been used", async () => {
    const e = await env();
    await claimCard(e, CARD, 5, sign(5));
    // Same URL, tapped again — the exact replay this is for.
    expect(await claimCard(e, CARD, 5, sign(5))).toEqual({ error: "already used" });
  });

  it("refuses a counter below the mark", async () => {
    const e = await env();
    await claimCard(e, CARD, 5, sign(5));
    expect(await claimCard(e, CARD, 4, sign(4))).toEqual({ error: "already used" });
  });

  it("accepts the next gesture", async () => {
    const e = await env();
    await claimCard(e, CARD, 5, sign(5));
    expect("error" in (await claimCard(e, CARD, 6, sign(6)))).toBe(false);
  });

  it("advances the mark in the same statement that checks it", async () => {
    // Two taps of one armed card race; exactly one may win. A read then a
    // write would let both through and open two epochs.
    const e = await env();
    const both = await Promise.all([
      claimCard(e, CARD, 9, sign(9)),
      claimCard(e, CARD, 9, sign(9)),
    ]);
    expect(both.filter((r) => !("error" in r))).toHaveLength(1);
  });
});

describe("a card has a succession of keepers, not an owner", () => {
  it("closes the previous tenure when a new one opens", async () => {
    const e = await env();
    await claimCard(e, CARD, 1, sign(1));
    await claimCard(e, CARD, 2, sign(2));

    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM card_epochs`)).toBe(2);
    // The partial unique index makes more than one current keeper
    // impossible; this proves the code agrees with it.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM card_epochs WHERE ended IS NULL`)).toBe(1);
  });

  it("does NOT hand the next keeper the last one's ducks", async () => {
    // The reason epochs exist. A contact shared with Sam was shared with
    // SAM; Mika picking up the same card later must see none of it.
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");

    await makeDuck(e.DB, "sams", { epoch: first.epochId, contact: "sam@example.com" });
    await e.DB.prepare(`UPDATE ducks SET card_id = ?1 WHERE id = 'sams'`).bind(CARD).run();

    const second = await claimCard(e, CARD, 2, sign(2));
    if ("error" in second) throw new Error("second claim failed");

    // Even adopting explicitly must not reach a previous tenure's ducks.
    await saveKeeper(e, second.epochId, { name: "Mika", adopt: true });

    const duck = await e.DB.prepare(`SELECT epoch_id FROM ducks WHERE id = 'sams'`)
      .first<{ epoch_id: string }>();
    expect(duck?.epoch_id).toBe(first.epochId);
  });

  it("offers only the ducks that predate every claim", async () => {
    const e = await env();
    await makeDuck(e.DB, "orphan");
    await e.DB.prepare(`UPDATE ducks SET card_id = ?1 WHERE id = 'orphan'`).bind(CARD).run();

    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    expect(claim.orphans).toBe(1);

    const saved = await saveKeeper(e, claim.epochId, { name: "Sam", adopt: true });
    expect(saved).toEqual({ ok: true, adopted: 1 });

    const state = await keeperState(e, claim.epochId);
    expect(state?.orphans).toBe(0);
    expect(state?.keeper).toBe("Sam");
  });
});

describe("card setup", () => {
  it("takes a name, a language and the keeper's own duck", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "mine");

    await saveKeeper(e, claim.epochId, {
      name: "Sam", lang: "zh-Hant", editKey: editKeyFor("mine"),
    });

    const state = await keeperState(e, claim.epochId);
    expect(state).toMatchObject({ keeper: "Sam", lang: "zh-Hant", duckSlug: "slug-mine" });
  });

  it("never returns the card serial", async () => {
    // It is half of what a claim is keyed on, and a keeper does not need it.
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    const state = await keeperState(e, claim.epochId);
    expect(JSON.stringify(state)).not.toContain(CARD);
  });

  it("refuses a keeper whose tenure has ended", async () => {
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await claimCard(e, CARD, 2, sign(2));

    // Sam's cookie still exists; Sam is no longer the keeper.
    expect(await saveKeeper(e, first.epochId, { name: "Sam" })).toEqual({
      error: "not the current keeper",
    });
    expect(await keeperState(e, first.epochId)).toBeNull();
  });

  it("accepts a keeper who fills in nothing", async () => {
    // Claiming and configuring are different acts. The epoch exists either
    // way; `via` is simply not shown.
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    expect(await saveKeeper(e, claim.epochId, {})).toEqual({ ok: true, adopted: 0 });
  });
});
