/**
 * Claiming a card, and being its keeper.
 *
 * ══ A CARD HAS A SUCCESSION OF KEEPERS, NOT AN OWNER ══
 * Every claim opens a new epoch and closes the last. That is not
 * bookkeeping: ducks and contacts point at an EPOCH, so when a card changes
 * hands the new keeper inherits neither. A contact shared with Sam was
 * shared with SAM — Mika picking up the same card later sees none of it,
 * and does not have to be trusted not to.
 *
 * ══ THE CARD SIGNS ITS CLAIM ══
 * An earlier design accepted an unseen counter as proof, which was not a
 * credential at all: everything in the URL is typed text, so an unseen
 * number proves only that nobody used THAT number yet. Anyone who learned a
 * serial could walk the counter space by hand.
 *
 * A claim is accepted when the token verifies AND the counter exceeds the
 * highest seen for that card. Both, never either — the signature stops
 * forgery, the counter stops replay.
 */

import { verifyClaim } from "../card/identity.js";
import type { Env } from "./types.js";
import { cleanText, nowSec, randomId } from "./util.js";

export type ClaimRefusal = "unknown card" | "bad token" | "already used" | "no secret";

export interface Claim {
  epochId: string;
  card: string;
  keeper: string;
  lang: string;
  /** Ducks from this card that predate the claim, offered for adoption. */
  orphans: number;
}

/** The 16-byte key the firmware signs with, as hex in CARD_SECRET. */
function secret(): Uint8Array | null {
  const hex = process.env.CARD_SECRET ?? "";
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
}

/**
 * Turn a signed claim into an epoch.
 *
 * The counter is advanced in the SAME statement that checks it, so two taps
 * of the same armed card race and exactly one wins. A read-then-write here
 * would let both through, and both would open an epoch.
 */
export async function claimCard(
  env: Env,
  cardId: string,
  counter: number,
  token: string,
): Promise<Claim | { error: ClaimRefusal }> {
  const key = secret();
  // A server with no CARD_SECRET cannot verify anything, and must not fall
  // back to accepting claims. Phase 5 is the first thing that needs it.
  if (!key) return { error: "no secret" };

  const card = await env.DB.prepare(`SELECT id, disabled FROM cards WHERE id = ?1`)
    .bind(cardId)
    .first<{ id: string; disabled: number }>();
  if (!card || card.disabled) return { error: "unknown card" };

  if (!verifyClaim(key, cardId, counter, token)) return { error: "bad token" };

  // The counter check and its advance, in one statement. `>` not `>=`:
  // a counter that has been used is spent, and the firmware increments
  // EEPROM before it writes the tag precisely so this can be strict.
  const advanced = await env.DB.prepare(
    `UPDATE cards SET claim_counter = ?1 WHERE id = ?2 AND claim_counter < ?1`,
  )
    .bind(counter, cardId)
    .run();
  if (!advanced.meta.changes) return { error: "already used" };

  const epochId = randomId(16);
  const ts = nowSec();

  // Close the previous tenure and open the new one together, so a card is
  // never briefly ownerless and never briefly has two keepers. The partial
  // unique index on (card_id) WHERE ended IS NULL enforces the second.
  await env.DB.batch([
    env.DB.prepare(`UPDATE card_epochs SET ended = ?1 WHERE card_id = ?2 AND ended IS NULL`)
      .bind(ts, cardId),
    env.DB.prepare(
      `INSERT INTO card_epochs (id, card_id, keeper_name, lang, counter, claimed)
       VALUES (?1, ?2, '', 'en', ?3, ?4)`,
    ).bind(epochId, cardId, counter, ts),
  ]);

  return {
    epochId,
    card: cardId,
    keeper: "",
    lang: "en",
    orphans: await orphanCount(env, cardId),
  };
}

/**
 * Ducks from this card with no epoch — released before anyone claimed it.
 *
 * Offered for adoption rather than adopted automatically: they are somebody
 * else's ducks, and a keeper saying "yes, those are from my card" is a
 * different act from the system deciding it for them.
 */
async function orphanCount(env: Env, cardId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ducks WHERE card_id = ?1 AND epoch_id IS NULL`,
  )
    .bind(cardId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export interface KeeperSettings {
  name?: unknown;
  lang?: unknown;
  /** The keeper's own duck, by its private edit key. */
  editKey?: unknown;
  /** Adopt the ducks that predate this claim. */
  adopt?: unknown;
}

/**
 * Save Card setup.
 *
 * Everything is optional and everything is reversible. A keeper who fills
 * in nothing has still claimed the card — the epoch exists, and `via` is
 * simply not shown.
 */
export async function saveKeeper(
  env: Env,
  epochId: string,
  s: KeeperSettings,
): Promise<{ ok: true; adopted: number } | { error: string }> {
  const epoch = await env.DB.prepare(
    `SELECT id, card_id FROM card_epochs WHERE id = ?1 AND ended IS NULL`,
  )
    .bind(epochId)
    .first<{ id: string; card_id: string }>();
  if (!epoch) return { error: "not the current keeper" };

  const name = cleanText(s.name, 18);
  const lang = s.lang === "zh-Hant" ? "zh-Hant" : "en";

  // The keeper's own duck, resolved from the edit key they pasted. Only
  // they have it, which is what makes this an authorisation rather than a
  // claim about somebody else's duck.
  let keeperDuck: string | null = null;
  if (typeof s.editKey === "string" && /^[A-Za-z0-9]{16,64}$/.test(s.editKey)) {
    const duck = await env.DB.prepare(`SELECT id FROM ducks WHERE edit_key = ?1`)
      .bind(s.editKey)
      .first<{ id: string }>();
    keeperDuck = duck ? String(duck.id) : null;
  }

  const writes = [
    env.DB.prepare(
      `UPDATE card_epochs SET keeper_name = ?1, lang = ?2, keeper_duck = ?3 WHERE id = ?4`,
    ).bind(name, lang, keeperDuck, epochId),
  ];

  if (s.adopt) {
    // Only the ducks with NO epoch. A duck from a previous keeper's tenure
    // stays with that tenure — adopting those would hand this keeper the
    // consent the last one was given.
    writes.push(
      env.DB.prepare(
        `UPDATE ducks SET epoch_id = ?1 WHERE card_id = ?2 AND epoch_id IS NULL`,
      ).bind(epochId, epoch.card_id),
    );
  }

  const results = await env.DB.batch(writes);
  return { ok: true, adopted: s.adopt ? (results[1]?.meta.changes ?? 0) : 0 };
}

/** What Card setup needs to render. */
export async function keeperState(env: Env, epochId: string): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    `SELECT e.id, e.card_id, e.keeper_name, e.lang, e.keeper_duck,
            (SELECT slug FROM ducks d WHERE d.id = e.keeper_duck) AS keeper_slug
       FROM card_epochs e WHERE e.id = ?1 AND e.ended IS NULL`,
  )
    .bind(epochId)
    .first<Record<string, unknown>>();
  if (!row) return null;

  return {
    epochId: String(row.id),
    keeper: String(row.keeper_name ?? ""),
    lang: String(row.lang ?? "en"),
    duckSlug: row.keeper_slug ? String(row.keeper_slug) : null,
    orphans: await orphanCount(env, String(row.card_id)),
    // The serial is NOT returned. A keeper does not need it, and it is half
    // of what a claim is keyed on.
  };
}
