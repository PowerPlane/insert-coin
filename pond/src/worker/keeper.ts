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
 * Register a card the first time one of its own taps proves it exists.
 *
 * ══ WHY THERE IS NO LIST TO KEEP ══
 * Cards used to have to be recorded by hand — `record-card.sh` into
 * `cards.csv`, then `cards:import` — and the server refused any serial it
 * had not been told about. The reasoning was sound as far as it went:
 * `&c=` is typed text, so without a gate anyone could conjure cards that
 * never existed and the Cards tab would fill with phantoms.
 *
 * But that reasoning is about the SERIAL ON ITS OWN, and the serial never
 * travels alone. Every tag carries `&c=`, `&g=` and `&t=`, and `&t=` is an
 * HMAC over the serial and the counter using CARD_SECRET — which only the
 * firmware has. From `provision.cpp`: "the counter starts at 0 and its
 * signature ships with it". So a card proves who it is on its very first
 * tap, before it has ever been armed.
 *
 * The manual list was therefore guarding a door the cryptography already
 * locks. A phantom card needs a valid signature, a valid signature needs
 * the key, and anybody with the key could flash real cards anyway.
 *
 * So the gate moves from "is this serial on a list I maintain" to "is this
 * signature real" — which is a stronger question, asked automatically.
 *
 * Two things get BETTER rather than merely easier:
 *
 *   A card flashed with the all-zero placeholder key signs with zeros, so
 *   it never verifies and never registers. The KS0KEKBX class of mistake
 *   becomes visible — the card simply never appears — instead of sitting
 *   quietly in the pond with a forgeable token.
 *
 *   `cards.csv` stops being a thing that can drift from reality. The
 *   database learns from the cards themselves.
 *
 * Returns whether this tap came from a real card, so callers can tell a
 * genuine tap from somebody typing `?d=1` into a browser.
 */
export async function ensureCard(
  env: Env,
  cardId: string | null,
  counterHex: string | null,
  token: string | null,
): Promise<boolean> {
  if (!cardId || !counterHex || !token) return false;
  const key = secret();
  if (!key) return false;

  const counter = parseInt(counterHex, 16);
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff) return false;
  if (!verifyClaim(key, cardId, counter, token)) return false;

  /*
   * INSERT OR IGNORE, and `claim_counter` is NOT seeded from the counter
   * on the tag. It starts at 0 so the first real claim — which must
   * EXCEED the stored mark — is still accepted. Seeding it from a card
   * that happened to arrive armed would retire that claim before anybody
   * could use it.
   */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cards (id, label, created) VALUES (?1, '', ?2)`,
  )
    .bind(cardId, nowSec())
    .run();
  return true;
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
 * Claim a card from the tap that just made a duck from it.
 *
 * ══ THE GESTURE NOBODY IS TOLD ABOUT ══
 * Keepership used to be reachable only by blowing on a card four times
 * during its boot window. That is a good proof — a card on a bar gets
 * tapped by accident and does not get blown on four times — and it is
 * useless as the ONLY route, because a friend handed a card will never
 * discover it. In practice every card given away stayed unclaimed and
 * every duck from it read `via` nobody.
 *
 * So the offer is made in the moment instead, to the person who has just
 * put a duck in the water from a card that nobody keeps. Blowing four
 * times remains the way to TAKE OVER a card that already has a keeper;
 * this is only ever about a card with no current epoch.
 *
 * ══ WHAT IS ACTUALLY BEING PROVED ══
 * That somebody is holding this card NOW. Five things, and the fourth is
 * the one that is easy to get wrong:
 *
 *   1. a live session — the cookie, checked by the caller,
 *   2. the session is bound to a card, which after the change in
 *      index.ts means its signature verified on this tap,
 *   3. the session released a duck,
 *   4. that duck came from the same card,
 *   5. the card exists and is not disabled.
 *
 * Number four has to be checked against `sessions.spent_duck` rather than
 * against `ducks.card_id` alone. `ducks.card_id` is DURABLE provenance —
 * it says which card minted a duck, months ago, and never expires — so
 * "holds the private link of a duck that came from this card" is not the
 * same claim as "is holding this card now", and accepting it would let an
 * old link claim a card nobody has touched.
 *
 * ══ THE COUNTER IS NOT SPENT ══
 * `claim_counter` stays exactly where it is. A four-blow claim must still
 * be able to take the card afterwards, and `claimCard` demands a counter
 * strictly ABOVE the stored mark — advancing it here would retire the
 * next real claim to pay for this one. The epoch records the counter it
 * opened at, which for a session claim is simply the current mark.
 *
 * The race is left to the database: the partial unique index on
 * `(card_id) WHERE ended IS NULL` means two simultaneous claims cannot
 * both open an epoch, and the loser is told somebody already keeps it
 * rather than getting a 500.
 */
export type SessionClaimRefusal =
  | "no session"
  | "no card"
  | "no duck"
  | "unknown card"
  | "already kept";

export async function claimFromSession(
  env: Env,
  session: { cardId: string | null; spentDuck: string | null },
  /*
   * ══ COMING BACK TO IT LATER ══
   * Somebody taps "Not now", thinks about it, and picks the card up again
   * the next day. The tap gives them a fresh session — so they are
   * demonstrably holding the card — but that session has released no
   * duck, and requiring `spent_duck` would tell them to make a second
   * duck to keep a card they already have one duck from.
   *
   * So a private link is accepted INSTEAD of `spent_duck`, and only ever
   * alongside a live session for the same card. The session is still what
   * proves present possession; the key only answers "and which duck here
   * is yours". Neither alone is enough, which is the property that
   * matters: an old private link on its own claims nothing, because
   * `ducks.card_id` is durable provenance and never expires.
   */
  editKey?: string | null,
): Promise<{ epochId: string; orphans: number } | { error: SessionClaimRefusal }> {
  const cardId = session.cardId;
  if (!cardId) return { error: "no card" };

  // The duck this session released, or — for somebody returning later —
  // one they can prove is theirs. Either way it must be from THIS card,
  // and that fact comes from a row the visitor cannot write.
  const duck = session.spentDuck
    ? await env.DB.prepare(`SELECT id, card_id FROM ducks WHERE id = ?1`)
        .bind(session.spentDuck)
        .first<{ id: string; card_id: string | null }>()
    : editKey && /^[A-Za-z0-9]{16,64}$/.test(editKey)
      ? await env.DB.prepare(`SELECT id, card_id FROM ducks WHERE edit_key = ?1`)
          .bind(editKey)
          .first<{ id: string; card_id: string | null }>()
      : null;
  if (!duck || duck.card_id !== cardId) return { error: "no duck" };

  // `card_epochs.card_id` is a foreign key and `counter` is NOT NULL, so
  // both are established before the insert rather than left to a
  // constraint violation.
  const card = await env.DB.prepare(
    `SELECT id, disabled, claim_counter FROM cards WHERE id = ?1`,
  )
    .bind(cardId)
    .first<{ id: string; disabled: number; claim_counter: number }>();
  if (!card || card.disabled) return { error: "unknown card" };

  const current = await env.DB.prepare(
    `SELECT id FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
  )
    .bind(cardId)
    .first<{ id: string }>();
  if (current) return { error: "already kept" };

  const epochId = randomId(16);
  try {
    /*
     * ══ keeper_duck IS SET AT CLAIM TIME, NOT AT SAVE TIME ══
     * It used to be written only by `saveKeeper`, which left two holes.
     *
     * A claimer who taps "Not now" on the sheet had NO keeper duck at
     * all, so once the one-hour cookie expired their only way back to
     * their own card was four blows or David — the exact dead end this
     * whole feature exists to remove.
     *
     * And the settings screen asks `/api/keeper?editKey=` for every duck,
     * so a route that falls back to the cookie when a key does not
     * resolve will answer with whatever card this browser claimed last.
     * Setting the link here is what lets that fallback be deleted.
     *
     * Safe by construction: `duck` was already checked to be from this
     * card, which is the invariant `saveKeeper` enforces.
     */
    await env.DB.prepare(
      `INSERT INTO card_epochs (id, card_id, keeper_name, lang, keeper_duck, counter, claimed)
       VALUES (?1, ?2, '', 'en', ?3, ?4, ?5)`,
    )
      .bind(epochId, cardId, duck.id, Number(card.claim_counter ?? 0), nowSec())
      .run();
  } catch {
    // The unique index fired: somebody else claimed it between the check
    // above and this insert. That is the same outcome as losing the race
    // by a second, and it is not an error worth a 500.
    return { error: "already kept" };
  }

  /*
   * ══ THE DUCK THAT CLAIMED IT BELONGS TO IT ══
   * Adoption is normally an explicit offer, because the ducks on a card
   * from before a claim are SOMEBODY ELSE'S and a keeper saying "yes,
   * those are mine" is a different act from the system deciding it.
   *
   * This one duck is not that. It is the duck this very person just made,
   * and it is the thing that proved the claim — leaving it an orphan
   * would mean the keeper's own duck was the one duck on the card that
   * did not read `via Sam`, which was found by a test asserting the
   * obvious and getting nothing.
   *
   * `epoch_id IS NULL` so this can never move a duck out of a previous
   * tenure, which is the rule the whole epoch design exists to keep.
   */
  await env.DB.prepare(
    `UPDATE ducks SET epoch_id = ?1 WHERE id = ?2 AND epoch_id IS NULL`,
  )
    .bind(epochId, duck.id)
    .run();

  return { epochId, orphans: await orphanCount(env, cardId) };
}

/**
 * Is there a card here for the taking?
 *
 * What the pond bar asks before it offers. Deliberately the same shape as
 * the claim's own checks, minus the writes — anything else and the button
 * appears for a claim that will be refused.
 */
export async function keeperOffer(
  env: Env,
  session: { cardId: string | null; spentDuck: string | null } | null,
  editKey?: string | null,
): Promise<boolean> {
  if (!session?.cardId) return false;
  /*
   * Exactly the claim's own precondition, or the button appears for a
   * claim that will be refused.
   *
   * "Exactly" includes the spent duck's own card. This used to trust
   * `spent_duck` on sight while `claimFromSession` went on to check that
   * the duck still exists and still belongs to this card — so a duck that
   * had been deleted, or moved by admin, produced an offer that refused
   * itself. Codex found the pair had drifted by one condition.
   */
  if (session.spentDuck) {
    const spent = await env.DB.prepare(`SELECT card_id FROM ducks WHERE id = ?1`)
      .bind(session.spentDuck)
      .first<{ card_id: string | null }>();
    if (!spent || spent.card_id !== session.cardId) return false;
  } else {
    if (!editKey || !/^[A-Za-z0-9]{16,64}$/.test(editKey)) return false;
    const mine = await env.DB.prepare(
      `SELECT 1 AS x FROM ducks WHERE edit_key = ?1 AND card_id = ?2`,
    )
      .bind(editKey, session.cardId)
      .first<{ x: number }>();
    if (!mine) return false;
  }
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM card_epochs e
              WHERE e.card_id = c.id AND e.ended IS NULL) AS kept,
            c.disabled
       FROM cards c WHERE c.id = ?1`,
  )
    .bind(session.cardId)
    .first<{ kept: number; disabled: number }>();
  return Boolean(row) && !row!.disabled && Number(row!.kept) === 0;
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

/**
 * The name the current keeper of a card chose, if they chose one.
 *
 * Reached only through a session, and a session needs the physical card —
 * so this cannot be used to enumerate keeper names from a guessed serial.
 * The name is public anyway: every duck from the card already reads
 * "via Sam" to everyone.
 */
export async function keeperNameOfCard(env: Env, cardId: string | null): Promise<string | null> {
  if (!cardId) return null;
  const row = await env.DB.prepare(
    `SELECT keeper_name FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
  )
    .bind(cardId)
    .first<{ keeper_name: string }>();
  // A card nobody has claimed, and a keeper who left the name blank, are the
  // same thing here: there is no one to name, so nothing is offered.
  return (row?.keeper_name ?? "").trim() || null;
}

/*
 * ══ A KEEPER MAY NOT CLAIM TO BE THE POND ══
 * The contact screen asks, in names: "Only David", "{keeper} and David".
 * A keeper who names themselves David turns that picker into a working
 * phishing page — two options that read the same, one of which quietly
 * routes a stranger's address somewhere else. The name is the one keeper
 * field a visitor is asked to trust, so it is the one that needs a floor.
 *
 * Compared on a folded form rather than literally: spacing, case and
 * punctuation are exactly what somebody would vary to get around a list.
 * This does not attempt homoglyphs — a Cyrillic а is a different problem,
 * and admin can rename in one tap, which the artifact's threat model
 * already relies on.
 */
const RESERVED = new Set([
  "david", "davidyang", "davidyangwork",
  "byproduct", "byproductlab",
  "thepond", "pond", "pondkeeper", "ducky",
  "admin", "administrator", "moderator", "support", "help", "official",
  "system", "staff",
]);

/**
 * Case, spacing and punctuation folded away — the variations a list invites.
 *
 * NFKC first, and that is the load-bearing part: it maps the compatibility
 * forms to their plain ASCII equivalents, so fullwidth Ｄａｖｉｄ and the
 * mathematical alphabets fold to "david" rather than to nothing. Without it
 * the ASCII-only filter below silently deleted every one of those
 * characters, and a name that renders as David sailed through as empty.
 *
 * This is not a homoglyph defence — Cyrillic а is a different letter and
 * NFKC keeps it so. That case is left to admin, which can rename in one
 * tap, exactly as the design assumed.
 */
function fold(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isReservedKeeperName(name: string): boolean {
  return RESERVED.has(fold(name));
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
    `SELECT id, card_id, keeper_name FROM card_epochs WHERE id = ?1 AND ended IS NULL`,
  )
    .bind(epochId)
    .first<{ id: string; card_id: string; keeper_name: string }>();
  if (!epoch) return { error: "not the current keeper" };

  /*
   * ══ ABSENT IS NOT EMPTY, FOR EVERY FIELD ══
   * This was true of `editKey` and false of `name` and `lang`: an omitted
   * name became "" and an omitted language became "en", on every save.
   *
   * The full setup screen's unlink button posts `{ editKey: "" }` and
   * nothing else — so unlinking a duck also wiped the keeper's name off
   * every duck on the card and quietly reset a Chinese card to English.
   * Codex found it by reading the one caller that does not repost the
   * whole form.
   *
   * The rule is now the same everywhere: a field that is not sent is not
   * touched. Which means each one has to be looked at before it is
   * written, rather than all of them being read into locals first.
   */
  const name = s.name === undefined ? undefined : cleanText(s.name, 18);
  /*
   * Only a name that CHANGED can be refused. Card setup reposts every
   * field together, so checking unconditionally would lock a keeper whose
   * stored name is already reserved out of saving their language, their
   * duck link or an adoption — punishing them for a row admin created.
   * It also disarms the truncation case: `cleanText` cuts to 18 code
   * points first, so a longer innocent name that happens to end up folding
   * to a reserved word is only refused if they just typed it.
   */
  if (name && name !== epoch.keeper_name && isReservedKeeperName(name)) {
    return { error: "reserved name" };
  }
  const lang = s.lang === undefined
    ? undefined
    : s.lang === "zh-Hant" ? "zh-Hant" : "en";

  /*
   * The keeper's own duck, resolved from the edit key. Only they have it,
   * which is what makes this an authorisation rather than a claim about
   * somebody else's duck.
   *
   * ══ AND IT MUST BE A DUCK THIS CARD MADE ══
   * This used to accept ANY duck whose edit key was submitted, with no
   * card or epoch constraint at all. That was survivable while
   * `keeper_duck` was decoration. It stopped being survivable when the
   * duck's edit key became a durable credential for this very screen
   * (docs/pond/KEEPER.md § 4.4): a keeper holding a one-hour cookie could
   * point `keeper_duck` at a duck they control and convert an expiring
   * cookie into permanent authority over somebody's card, and any
   * unrelated private link became card-settings authority the moment it
   * was saved. Codex found the loop.
   *
   * `card_id` comes from the EPOCH, never from the request. The
   * constraint is true by construction in every honest case — a keeper's
   * duck came from the card they keep — and it closes the loop, because
   * the credential now names a duck the card itself produced.
   *
   * ══ ABSENT IS NOT EMPTY ══
   * Omitting the field leaves the link alone; sending an empty string
   * breaks it deliberately. They used to be the same thing, so any save
   * that did not repost the key silently unlinked the duck — which, now
   * that the link is a credential, would lock a keeper out of their own
   * card for saving their language.
   */
  let keeperDuck: string | null | undefined;
  if (s.editKey === "" || s.editKey === null) {
    keeperDuck = null;
  } else if (typeof s.editKey === "string") {
    if (!/^[A-Za-z0-9]{16,64}$/.test(s.editKey)) return { error: "not your duck" };
    const duck = await env.DB.prepare(
      `SELECT id FROM ducks WHERE edit_key = ?1 AND card_id = ?2`,
    )
      .bind(s.editKey, epoch.card_id)
      .first<{ id: string }>();
    // Silently storing NULL here is how a mistyped key used to read as
    // "unlink". Say so instead — the sheet renders it against the field.
    if (!duck) return { error: "not your duck" };
    keeperDuck = String(duck.id);
  }

  /*
   * Built from what was actually sent. A save that mentions nothing but
   * `adopt` writes nothing to the epoch at all, which is the correct
   * amount of damage for a request that asked for nothing.
   */
  const sets: string[] = [];
  const args: unknown[] = [];
  if (name !== undefined) { sets.push(`keeper_name = ?${sets.length + 1}`); args.push(name); }
  if (lang !== undefined) { sets.push(`lang = ?${sets.length + 1}`); args.push(lang); }
  if (keeperDuck !== undefined) {
    sets.push(`keeper_duck = ?${sets.length + 1}`);
    args.push(keeperDuck);
  }

  const writes = sets.length
    ? [
        env.DB.prepare(
          `UPDATE card_epochs SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`,
        ).bind(...args, epochId),
      ]
    : [];

  // Only the ducks with NO epoch. A duck from a previous keeper's tenure
  // stays with that tenure — adopting those would hand this keeper the
  // consent the last one was given.
  // The adoption's index depends on whether there was an epoch update at
  // all, which there is not for a save that only adopts.
  const adoptAt = writes.length;
  if (s.adopt) {
    writes.push(
      env.DB.prepare(
        `UPDATE ducks SET epoch_id = ?1 WHERE card_id = ?2 AND epoch_id IS NULL`,
      ).bind(epochId, epoch.card_id),
    );
  }
  const results = writes.length ? await env.DB.batch(writes) : [];
  return { ok: true, adopted: s.adopt ? (results[adoptAt]?.meta.changes ?? 0) : 0 };
}

/**
 * Hand the card on.
 *
 * ══ ENDING A TENURE IS NOT DELETING ANYTHING ══
 * The epoch is closed, and that is all. Every duck stays exactly where it
 * is, keeps its `epoch_id`, and keeps reading `via Sam` — because it WAS
 * from Sam's card, and rewriting that would be a lie about the past
 * rather than a tidy-up. Contacts stay attached to the tenure they were
 * given to, which is the entire reason contacts point at an epoch: the
 * next keeper inherits none of them and does not have to be trusted not
 * to.
 *
 * Afterwards the card is claimable again — by the next person to make a
 * duck from it, or by four blows.
 *
 * This is deliberately NOT the same act as "take my name off", which is
 * `saveKeeper` with an empty name: that keeps the card and drops the
 * byline. Two intentions, two actions, because collapsing them into one
 * button called Delete would make the reversible one look final.
 */
export async function endTenure(env: Env, epochId: string): Promise<boolean> {
  const done = await env.DB.prepare(
    `UPDATE card_epochs SET ended = ?1 WHERE id = ?2 AND ended IS NULL`,
  )
    .bind(nowSec(), epochId)
    .run();
  return Boolean(done.meta.changes);
}

/**
 * Link the claimer's own duck to the tenure they just opened.
 *
 * ══ CLAIMED AND STRANDED ══
 * `claimFromSession` sets `keeper_duck` as it claims, because it knows
 * which duck proved the claim. The four-blow path does not: it opens an
 * epoch from a signature alone, and `saveKeeper` was the only thing that
 * ever wrote the link.
 *
 * So somebody who blew four times, tapped, and then closed Card setup
 * without filling anything in ended up keeping a card with no name and no
 * duck attached — and once the one-hour cookie expired, no way back to it
 * at all except David in admin. That is the exact dead end this whole
 * feature exists to remove, reached by doing nothing wrong. David reached
 * it on his own card, and it read as "kept · no name" in the Cards tab.
 *
 * So the claim takes the duck the browser is holding, if it has one and if
 * this card made it. Same invariant `saveKeeper` enforces — a keeper's
 * duck must be a duck their card minted — checked here rather than
 * trusted, and `keeper_duck IS NULL` so it can never overwrite a link an
 * actual keeper chose.
 */
export async function linkClaimerDuck(
  env: Env,
  epochId: string,
  cardId: string,
  editKey: string | null,
): Promise<void> {
  if (!editKey || !/^[A-Za-z0-9]{16,64}$/.test(editKey)) return;
  const duck = await env.DB.prepare(
    `SELECT id FROM ducks WHERE edit_key = ?1 AND card_id = ?2`,
  )
    .bind(editKey, cardId)
    .first<{ id: string }>();
  if (!duck) return;

  await env.DB.prepare(
    `UPDATE card_epochs SET keeper_duck = ?1 WHERE id = ?2 AND keeper_duck IS NULL`,
  )
    .bind(duck.id, epochId)
    .run();
  // And into the tenure, the same way a session claim adopts the duck that
  // proved it. `epoch_id IS NULL` so a previous keeper's duck is untouched.
  await env.DB.prepare(
    `UPDATE ducks SET epoch_id = ?1 WHERE id = ?2 AND epoch_id IS NULL`,
  )
    .bind(epochId, duck.id)
    .run();
}

/**
 * The other way into card settings: the keeper's own duck.
 *
 * ══ AN HOUR IS A BOOTSTRAP, NOT A KEY ══
 * `pond_keeper` lasts 3600 seconds. That is right for the thing it is —
 * the moment after a claim — and hopeless as the only way back: after an
 * hour a keeper could reach their card again only by blowing on it four
 * times, which is the gesture this whole feature exists because nobody
 * knows about.
 *
 * So the durable credential is one they already have and are already
 * told to keep: their duck's private link. `keeper_duck` names that duck,
 * and `saveKeeper` will only accept a duck THIS CARD MINTED — without
 * that constraint this would be circular, and any private link would open
 * any card's settings.
 *
 * The tenure must be current. A keeper whose epoch ended keeps their
 * duck and loses the card, which is the entire point of epochs.
 */
export async function epochForEditKey(
  env: Env,
  editKey: string | null,
): Promise<string | null> {
  if (!editKey || !/^[A-Za-z0-9]{16,64}$/.test(editKey)) return null;
  const row = await env.DB.prepare(
    `SELECT e.id
       FROM card_epochs e
       JOIN ducks d ON d.id = e.keeper_duck
      WHERE d.edit_key = ?1 AND e.ended IS NULL`,
  )
    .bind(editKey)
    .first<{ id: string }>();
  return row ? String(row.id) : null;
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
