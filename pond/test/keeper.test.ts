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
import {
  claimCard, epochForEditKey, isReservedKeeperName, keeperNameOfCard, keeperState,
  saveKeeper,
} from "../src/worker/keeper.js";
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
    // From THIS card: `keeper_duck` may only name a duck the card made.
    await makeDuck(e.DB, "mine", { card: CARD });

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

  /*
   * ══ THE NAME THE CONTACT SCREEN IS ALLOWED TO SAY ══
   * The scope picker offers "share with Sam" only when there is a Sam to
   * name. That name used to be INFERRED on the client, from the keepers of
   * whichever ducks happened to be on screen — which silently returned null
   * as soon as two keepers had ducks in the pond, so the option vanished in
   * exactly the situation the pond is built for. It now comes from the card
   * the session was minted for.
   */
  describe("the name offered to a visitor", () => {
    it("is the current keeper's", async () => {
      const e = await env();
      const claim = await claimCard(e, CARD, 1, sign(1));
      if ("error" in claim) throw new Error("claim failed");
      await saveKeeper(e, claim.epochId, { name: "Sam" });
      expect(await keeperNameOfCard(e, CARD)).toBe("Sam");
    });

    it("is nobody for an unclaimed card, and for a card that is not real", async () => {
      const e = await env();
      expect(await keeperNameOfCard(e, CARD)).toBeNull();
      expect(await keeperNameOfCard(e, "NOSUCHID")).toBeNull();
      expect(await keeperNameOfCard(e, null)).toBeNull();
    });

    it("is nobody when the keeper left the name blank", async () => {
      // There is no one to name, so the picker must not offer to share
      // with them — "shared with " is not a sentence anyone can consent to.
      const e = await env();
      const claim = await claimCard(e, CARD, 1, sign(1));
      if ("error" in claim) throw new Error("claim failed");
      await saveKeeper(e, claim.epochId, { name: "   " });
      expect(await keeperNameOfCard(e, CARD)).toBeNull();
    });

    it("changes hands with the card, and never lags behind", async () => {
      const e = await env();
      const sam = await claimCard(e, CARD, 1, sign(1));
      if ("error" in sam) throw new Error("claim failed");
      await saveKeeper(e, sam.epochId, { name: "Sam" });
      expect(await keeperNameOfCard(e, CARD)).toBe("Sam");

      // Mika picks the card up. Sam must stop being offered immediately,
      // before Mika has chosen a name — a visitor consenting to "share
      // with Sam" when Sam no longer holds the card is the exact harm the
      // epochs exist to prevent.
      const mika = await claimCard(e, CARD, 2, sign(2));
      if ("error" in mika) throw new Error("claim failed");
      expect(await keeperNameOfCard(e, CARD)).toBeNull();

      await saveKeeper(e, mika.epochId, { name: "Mika" });
      expect(await keeperNameOfCard(e, CARD)).toBe("Mika");
    });
  });

  /*
   * ══ A NAME A VISITOR IS ASKED TO TRUST ══
   * The contact screen offers "Only David" and "{keeper} and David". A
   * keeper called David makes those two options indistinguishable, and the
   * one a stranger picks decides where their address goes. That is a
   * phishing page built out of the product's own copy.
   */
  describe("reserved keeper names", () => {
    it("refuses the pond's own names, however they are typed", () => {
      for (const taken of ["David", "david", "  DAVID  ", "D-a-v-i-d", "david.yang",
                           "By Product Lab", "pondkeeper", "Admin", "official",
                           // Fullwidth. Renders as David; folded to nothing
                           // before NFKC was added, so it walked straight past.
                           "Ｄａｖｉｄ", "ＰＯＮＤＫＥＥＰＥＲ"]) {
        expect(isReservedKeeperName(taken)).toBe(true);
      }
    });

    it("leaves ordinary names alone, including ones that merely contain them", () => {
      // "Davidson" is a person. Substring matching would refuse them, so
      // the comparison is whole-name and folded, never `includes`.
      for (const fine of ["Sam", "Mika", "Davidson", "Dave", "小鴨", "David's Friend"]) {
        expect(isReservedKeeperName(fine)).toBe(false);
      }
    });

    it("refuses the save rather than silently blanking the card", async () => {
      const e = await env();
      const claim = await claimCard(e, CARD, 1, sign(1));
      if ("error" in claim) throw new Error("claim failed");

      expect(await saveKeeper(e, claim.epochId, { name: "David" })).toEqual({
        error: "reserved name",
      });
      // And nothing was written — the epoch keeps the name it had.
      expect(await keeperState(e, claim.epochId)).toMatchObject({ keeper: "" });
    });

    it("does not lock an existing reserved name out of its other settings", async () => {
      /*
       * Card setup reposts every field at once. A keeper whose stored name
       * is already reserved — set before the list existed, or by admin —
       * must still be able to save a language or link a duck, or the
       * refusal quietly bricks their card.
       */
      const e = await env();
      const claim = await claimCard(e, CARD, 1, sign(1));
      if ("error" in claim) throw new Error("claim failed");
      await e.DB.prepare(`UPDATE card_epochs SET keeper_name = 'David' WHERE id = ?1`)
        .bind(claim.epochId)
        .run();

      expect(await saveKeeper(e, claim.epochId, { name: "David", lang: "zh-Hant" }))
        .toEqual({ ok: true, adopted: 0 });
      expect(await keeperState(e, claim.epochId)).toMatchObject({ lang: "zh-Hant" });

      // But changing it TO a different reserved name is still refused.
      expect(await saveKeeper(e, claim.epochId, { name: "Admin" }))
        .toEqual({ error: "reserved name" });
    });

    it("still lets a keeper save everything else", async () => {
      const e = await env();
      const claim = await claimCard(e, CARD, 1, sign(1));
      if ("error" in claim) throw new Error("claim failed");
      expect(await saveKeeper(e, claim.epochId, { name: "Sam", lang: "zh-Hant" }))
        .toEqual({ ok: true, adopted: 0 });
    });
  });
});

/**
 * `keeper_duck` is a credential, so it needs an invariant.
 *
 * ══ THE LOOP CODEX FOUND ══
 * Card setup accepted ANY duck whose edit key was submitted, with no card
 * or epoch constraint. Harmless while the link was decoration. Not
 * harmless once that duck's edit key became a durable way back into card
 * settings: a keeper holding the one-hour cookie could point keeper_duck
 * at a duck they control and convert an expiring cookie into permanent
 * authority, and any unrelated private link became card-settings
 * authority the moment it was saved.
 */
describe("the keeper's duck must be a duck this card made", () => {
  it("takes a duck minted by this card", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "ours", { card: CARD });

    expect(await saveKeeper(e, claim.epochId, { editKey: editKeyFor("ours") }))
      .toMatchObject({ ok: true });
    expect(await keeperState(e, claim.epochId)).toMatchObject({ duckSlug: "slug-ours" });
  });

  it("refuses a duck from somewhere else, and says so", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    // A stranger's duck. The attacker has its private link; that is the
    // whole premise, and it must still not become this card's credential.
    await makeDuck(e.DB, "theirs");

    expect(await saveKeeper(e, claim.epochId, { editKey: editKeyFor("theirs") }))
      .toEqual({ error: "not your duck" });
    expect(await keeperState(e, claim.epochId)).toMatchObject({ duckSlug: null });
  });

  it("leaves the link alone when the field is not sent at all", async () => {
    /*
     * ══ ABSENT IS NOT EMPTY ══
     * Omitting the key used to be indistinguishable from clearing it, so
     * any save that did not repost it silently unlinked the duck. Now
     * that the link is a credential, that would lock a keeper out of
     * their own card for the crime of changing their language.
     */
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "kept", { card: CARD });
    await saveKeeper(e, claim.epochId, { editKey: editKeyFor("kept") });

    await saveKeeper(e, claim.epochId, { name: "Sam", lang: "zh-Hant" });
    expect(await keeperState(e, claim.epochId))
      .toMatchObject({ keeper: "Sam", lang: "zh-Hant", duckSlug: "slug-kept" });
  });

  it("breaks the link when the field is sent empty", async () => {
    // Deliberate unlinking still has to be possible, and an empty string
    // is how the form says it.
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "letgo", { card: CARD });
    await saveKeeper(e, claim.epochId, { editKey: editKeyFor("letgo") });

    expect(await saveKeeper(e, claim.epochId, { editKey: "" })).toMatchObject({ ok: true });
    expect(await keeperState(e, claim.epochId)).toMatchObject({ duckSlug: null });
  });

  it("refuses a malformed key rather than reading it as a clearance", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "safe", { card: CARD });
    await saveKeeper(e, claim.epochId, { editKey: editKeyFor("safe") });

    expect(await saveKeeper(e, claim.epochId, { editKey: "nope" }))
      .toEqual({ error: "not your duck" });
    expect(await keeperState(e, claim.epochId), "the good link survives")
      .toMatchObject({ duckSlug: "slug-safe" });
  });
});

/**
 * `epochForEditKey` on its own.
 *
 * Tested at this level deliberately. Through the route its two guards are
 * invisible, because `keeperState` and `saveKeeper` BOTH re-check
 * `ended IS NULL` downstream — so removing it here changes no HTTP
 * response and a route test cannot tell. That makes it defence in depth
 * rather than dead code, and defence in depth still has to be checked, or
 * it rots into a comment.
 */
describe("resolving a keeper from their duck's private link", () => {
  it("finds the current tenure", async () => {
    const e = await env();
    const claim = await claimCard(e, CARD, 1, sign(1));
    if ("error" in claim) throw new Error("claim failed");
    await makeDuck(e.DB, "key", { card: CARD });
    await saveKeeper(e, claim.epochId, { editKey: editKeyFor("key") });

    expect(await epochForEditKey(e, editKeyFor("key"))).toBe(claim.epochId);
  });

  it("does not find a tenure that has ended", async () => {
    // The keeper keeps their duck and loses the card. That is what epochs
    // are for, and it must be true at every layer rather than only at the
    // one that happens to be checked last.
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await makeDuck(e.DB, "was", { card: CARD });
    await saveKeeper(e, first.epochId, { editKey: editKeyFor("was") });

    await claimCard(e, CARD, 2, sign(2));
    expect(await epochForEditKey(e, editKeyFor("was"))).toBe(null);
  });

  it("refuses a duck that is nobody's keeper duck", async () => {
    const e = await env();
    await claimCard(e, CARD, 1, sign(1));
    await makeDuck(e.DB, "other", { card: CARD });
    expect(await epochForEditKey(e, editKeyFor("other"))).toBe(null);
  });

  it("refuses nothing, and rubbish, without asking the database", async () => {
    const e = await env();
    expect(await epochForEditKey(e, null)).toBe(null);
    expect(await epochForEditKey(e, "")).toBe(null);
    expect(await epochForEditKey(e, "short")).toBe(null);
    expect(await epochForEditKey(e, "../../../etc/passwd")).toBe(null);
  });
});

/**
 * Blowing on your own card is not handing it over.
 *
 * Every claim opened a new epoch — right when a card changes hands, wrong
 * when it does not. A keeper who blew on their own card got a blank Card
 * setup and had silently lost their name, their language and their duck
 * link; the old tenure was still there holding their ducks, and they were
 * simply no longer in it. David hit it on the first try.
 */
describe("a keeper who re-claims their own card keeps their tenure", () => {
  it("resumes rather than replacing, and their settings are still there", async () => {
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await makeDuck(e.DB, "theirs", { card: CARD });
    await saveKeeper(e, first.epochId, {
      name: "Kariina", lang: "zh-Hant", editKey: editKeyFor("theirs"),
    });

    // Four blows again, by the same person, holding the same duck.
    const again = await claimCard(e, CARD, 2, sign(2), editKeyFor("theirs"));
    if ("error" in again) throw new Error("re-claim failed");

    expect(again.epochId, "the same tenure").toBe(first.epochId);
    expect(again.keeper, "and the name they set").toBe("Kariina");
    expect(again.lang).toBe("zh-Hant");
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM card_epochs`), "no new epoch").toBe(1);
  });

  it("still spends the counter, so it is no way around replay", async () => {
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await makeDuck(e.DB, "same", { card: CARD });
    await saveKeeper(e, first.epochId, { editKey: editKeyFor("same") });

    await claimCard(e, CARD, 4, sign(4), editKeyFor("same"));
    // The mark moved to 4, so 4 cannot be replayed and 3 is now stale.
    expect(await claimCard(e, CARD, 4, sign(4), editKeyFor("same")))
      .toEqual({ error: "already used" });
    expect(await claimCard(e, CARD, 3, sign(3), editKeyFor("same")))
      .toEqual({ error: "already used" });
  });

  it("hands the card over when the blower is somebody else", async () => {
    // The gesture's real job. A stranger's key — or none — is a
    // succession, and the new keeper inherits nothing.
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await makeDuck(e.DB, "was", { card: CARD });
    await saveKeeper(e, first.epochId, { name: "Sam", editKey: editKeyFor("was") });

    const next = await claimCard(e, CARD, 2, sign(2), null);
    if ("error" in next) throw new Error("second claim failed");
    expect(next.epochId, "a new tenure").not.toBe(first.epochId);
    expect(next.keeper, "inheriting no name").toBe("");
    expect(await count(
      e.DB, `SELECT COUNT(*) AS n FROM card_epochs WHERE ended IS NULL`,
    )).toBe(1);
  });

  it("is not fooled by a stranger's private link", async () => {
    const e = await env();
    const first = await claimCard(e, CARD, 1, sign(1));
    if ("error" in first) throw new Error("claim failed");
    await makeDuck(e.DB, "mine2", { card: CARD });
    await saveKeeper(e, first.epochId, { name: "Sam", editKey: editKeyFor("mine2") });
    // A duck that is not this tenure's keeper duck.
    await makeDuck(e.DB, "other2", { card: CARD });

    const next = await claimCard(e, CARD, 2, sign(2), editKeyFor("other2"));
    if ("error" in next) throw new Error("claim failed");
    expect(next.epochId, "still a succession").not.toBe(first.epochId);
  });
});
