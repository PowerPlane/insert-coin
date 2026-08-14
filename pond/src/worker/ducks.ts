/**
 * Duck reads and writes.
 *
 * ══ THE ONE RULE ══
 * Nothing in this file may name the `contacts` table AT ALL, and nothing
 * may select `card_id` into anything a visitor receives. The public read
 * must be structurally incapable of returning either — not "we remember to
 * strip the field", but "the query does not know the table exists".
 * `test/contacts-isolation.test.ts` greps this file to enforce it.
 *
 * That rule is why releasing a duck lives in `release.ts` rather than here:
 * the release has to write the contact and the duck in one transaction, and
 * doing it in this file would have bought that atomicity by spending the
 * one property that makes the privacy claim checkable.
 */

import type { Env, PublicDuck } from "./types.js";
import { normaliseSlug, slugTaken } from "./slug.js";
import { cleanText, nowSec } from "./util.js";

export const MAX_STICKERS = 6;
/** 24×24 @ 4bpp = 288 bytes → exactly 384 base64 characters. */
export const PAINT_B64_LEN = 384;
/** Keep in step with TINTS in src/client/sprites.ts. */
export const TINT_COUNT = 12;
/** Ranked senders on a duck card — `.p-bumper`, max 5. See UI.md § 7. */
export const TOP_BUMPERS = 5;

/** Sticker ids the client ships. Anything else is rejected, not stored. */
const STICKER_IDS = new Set([
  "tophat","cap","beanie","cowboy","crown","party","wizard","wreath","halo","bow",
  "shades","specs","patch","blush","tache",
  "scarf","bowtie","chain","collar",
  "heart","star","spot","stripe","pocket",
  "balloon","fish","leaf","spark",
  "handbag","tote","basket","satchel",
]);

/**
 * Who a contact may be read by. "Nobody" is spelled "no contact at all".
 *
 * The default is the narrowest of the three because it is the only one the
 * contact screen actually promises: "Want David to reply?" … "Only David
 * sees this." Someone who never opens a scope picker has agreed to that
 * sentence, so that sentence is what is stored.
 */
export const CONTACT_SCOPES = ["david", "keeper", "keeper_and_david"] as const;
export type ContactScope = (typeof CONTACT_SCOPES)[number];
export const DEFAULT_CONTACT_SCOPE: ContactScope = "david";

export interface DuckInput {
  fortune: number;
  tint: number;
  stickers: unknown;
  paint: unknown;
  name: unknown;
  message: unknown;
}

export interface ValidatedDuck {
  fortune: number;
  tint: number;
  stickers: { id: string; x: number; y: number }[];
  paint: string;
  name: string;
  message: string;
}

/**
 * Validate everything a client sends. This is a public write endpoint, so
 * every field is hostile until proven otherwise: unknown sticker ids,
 * out-of-range coordinates, oversized blobs, and control characters in text
 * are all rejected rather than clamped-and-stored.
 */
/** Strict: a real number in range. Number("1") is 1, so coercing here would
 *  quietly accept a string where a number belongs — which is exactly how
 *  malformed data gets past a validator and into storage. */
function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

export function validateDuck(input: DuckInput): ValidatedDuck | { error: string } {
  const fortune = intIn(input.fortune, 0, 3);
  if (fortune === null) return { error: "bad fortune" };

  // Must match the client's TINTS palette length exactly. A tint outside it
  // has no colour to render and would fall back to gold, silently.
  const tint = intIn(input.tint, 0, TINT_COUNT - 1);
  if (tint === null) return { error: "bad tint" };

  let stickers: { id: string; x: number; y: number }[] = [];
  if (input.stickers !== undefined && input.stickers !== null) {
    if (!Array.isArray(input.stickers)) return { error: "bad stickers" };
    if (input.stickers.length > MAX_STICKERS) return { error: "too many stickers" };
    for (const raw of input.stickers) {
      if (typeof raw !== "object" || raw === null) return { error: "bad sticker" };
      const s = raw as Record<string, unknown>;
      const id = typeof s.id === "string" ? s.id : "";
      if (!STICKER_IDS.has(id)) return { error: "unknown sticker" };
      // The grid is 24×24; anything outside it can't render and is a probe.
      const x = intIn(s.x, 0, 23);
      const y = intIn(s.y, 0, 23);
      if (x === null || y === null) return { error: "sticker out of bounds" };
      stickers.push({ id, x, y });
    }
  }

  // Either no paint at all, or exactly one canonical 24×24 layer. Accepting
  // any base64-ish string of the right rough size would let a client store
  // blobs that decode to nothing and render as an empty duck.
  let paint = "";
  if (typeof input.paint === "string" && input.paint.length > 0) {
    if (input.paint.length !== PAINT_B64_LEN) return { error: "bad paint length" };
    if (!/^[A-Za-z0-9+/]{384}$/.test(input.paint)) return { error: "paint not base64" };
    paint = input.paint;
  }

  return {
    fortune,
    tint,
    stickers,
    paint,
    name: cleanText(input.name, 18),
    message: cleanText(input.message, 90),
  };
}

/** A contact scope a client asked for, or the default if it asked for nonsense. */
export function validateScope(raw: unknown): ContactScope {
  return CONTACT_SCOPES.includes(raw as ContactScope)
    ? (raw as ContactScope)
    : DEFAULT_CONTACT_SCOPE;
}

/**
 * The columns every public read shares.
 *
 * Written once so the pond, the duck page and the owner's own view cannot
 * drift apart — and so that adding a column here is a deliberate act
 * reviewed in one place rather than three.
 *
 * `bumps` and `rescues` are DERIVED. They used to be denormalised counters
 * on `ducks`, kept in step by a second write after the first; that second
 * write was a window where a crash left a bump recorded with no count, and
 * a stored total sitting beside the per-pair table it is supposed to equal
 * is a drift waiting to happen. Correlated aggregates over indexed columns
 * cost nothing at pond scale. The ceiling, and the fix when it arrives, is
 * in docs/pond/SECURITY.md § 5.
 *
 * `?1` is now and `?2` is the say cutoff in EVERY query that uses this, so
 * `?3` is always free for whatever that query is actually looking up. A gap
 * in the numbering would bind silently to the wrong column.
 */
const PUBLIC_COLUMNS = `
  d.id, d.slug, d.fortune, d.tint, d.stickers, d.paint, d.name, d.message,
  d.created,
  (SELECT COALESCE(SUM(b.total), 0) FROM bumps b WHERE b.to_duck = d.id) AS bumps,
  (SELECT COUNT(*) FROM fires f
    WHERE f.duck_id = d.id AND f.out_by IS NOT NULL) AS rescues,
  (SELECT 1 FROM fires f
     WHERE f.duck_id = d.id AND f.out_at IS NULL AND f.burns_until > ?1
     LIMIT 1) AS burning,
  (SELECT s.text FROM says s
     WHERE s.duck_id = d.id AND s.created > ?2
     ORDER BY s.created DESC LIMIT 1) AS say_text,
  (SELECT s.created FROM says s
     WHERE s.duck_id = d.id AND s.created > ?2
     ORDER BY s.created DESC LIMIT 1) AS say_at,
  (SELECT e.keeper_name FROM card_epochs e WHERE e.id = d.epoch_id) AS keeper
`;

/** Speech bubbles live 45 s on screen; older ones are not sent at all. */
export const SAY_VISIBLE_SEC = 45;

function toPublicDuck(r: Record<string, unknown>): PublicDuck {
  const keeper = typeof r.keeper === "string" ? r.keeper.trim() : "";
  return {
    id: String(r.id),
    slug: String(r.slug ?? ""),
    fortune: Number(r.fortune),
    tint: Number(r.tint),
    stickers: safeParseStickers(r.stickers),
    paint: String(r.paint ?? ""),
    name: String(r.name ?? ""),
    message: String(r.message ?? ""),
    created: Number(r.created),
    bumps: Number(r.bumps ?? 0),
    rescues: Number(r.rescues ?? 0),
    burning: Boolean(r.burning),
    say: r.say_text ? { text: String(r.say_text), at: Number(r.say_at) } : null,
    // An unclaimed card has no keeper, and a keeper who left the name blank
    // is the same thing to a reader: nothing to show.
    keeper: keeper || null,
  };
}

/**
 * The public pond.
 *
 * Reads only from `ducks` plus the derived bits the client needs to draw.
 * No join reaches anything private. Capped and ordered so the response size
 * is bounded no matter how large the pond gets.
 */
export async function listPond(env: Env, limit = 200): Promise<PublicDuck[]> {
  const ts = nowSec();
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS}
       FROM ducks d
      WHERE d.hidden = 0
      ORDER BY d.created DESC
      LIMIT ?3`,
  )
    .bind(ts, ts - SAY_VISIBLE_SEC, limit)
    .all<Record<string, unknown>>();

  return (results ?? []).map(toPublicDuck);
}

/** Stored JSON is ours, but a corrupt row must not take the pond down. */
function safeParseStickers(raw: unknown): { id: string; x: number; y: number }[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && STICKER_IDS.has(s.id))
      .slice(0, MAX_STICKERS)
      .map((s) => ({ id: String(s.id), x: Number(s.x) | 0, y: Number(s.y) | 0 }));
  } catch {
    return [];
  }
}

/** Look a duck up by its private edit key. Constant-time via the index. */
export async function duckByEditKey(env: Env, editKey: string): Promise<PublicDuck | null> {
  if (!/^[A-Za-z0-9]{16,64}$/.test(editKey)) return null;
  const ts = nowSec();
  const row = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS} FROM ducks d WHERE d.edit_key = ?3`,
  )
    .bind(ts, ts - SAY_VISIBLE_SEC, editKey)
    .first<Record<string, unknown>>();
  return row ? toPublicDuck(row) : null;
}

/** The public duck page. Read-only — a slug is an address, not a key. */
export async function duckBySlug(env: Env, slug: string): Promise<PublicDuck | null> {
  const clean = normaliseSlug(slug);
  if (!clean) return null;
  const ts = nowSec();
  const row = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS} FROM ducks d WHERE d.slug = ?3 AND d.hidden = 0`,
  )
    .bind(ts, ts - SAY_VISIBLE_SEC, clean)
    .first<Record<string, unknown>>();
  return row ? toPublicDuck(row) : null;
}

/**
 * "Most bumps from" — the ranked senders on a duck card.
 *
 * A query, not a table. This is the payoff for making bumps per-pair
 * instead of a counter: the duck card gets real names for free, and so does
 * whatever Phase 3 decides to do with them.
 */
export interface Bumper {
  slug: string;
  name: string;
  count: number;
  /* Enough to DRAW them. The duck card shows a row of the actual ducks
     rather than a list of names, because a number is a score and a row of
     faces is a relationship — it is the one place the pond shows that the
     same person came back. */
  fortune: number;
  tint: number;
  stickers: unknown;
  paint: string;
}

export async function topBumpers(
  env: Env,
  duckId: string,
  limit = TOP_BUMPERS,
): Promise<Bumper[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.slug AS slug, d.name AS name, b.total AS total,
            d.fortune AS fortune, d.tint AS tint,
            d.stickers AS stickers, d.paint AS paint
       FROM bumps b
       JOIN ducks d ON d.id = b.from_duck
      WHERE b.to_duck = ?1 AND d.hidden = 0
      ORDER BY b.total DESC, b.last_at DESC
      LIMIT ?2`,
  )
    .bind(duckId, limit)
    .all<Record<string, unknown>>();

  return (results ?? []).map((r) => ({
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    count: Number(r.total ?? 0),
    fortune: Number(r.fortune ?? 1),
    tint: Number(r.tint ?? 0),
    stickers: safeParseStickers(r.stickers),
    paint: String(r.paint ?? ""),
  }));
}

/**
 * Rename. Returns why it failed rather than a bare false, because "that one
 * is taken" and "that isn't a usable name" need different words on screen.
 */
export async function renameDuck(
  env: Env,
  editKey: string,
  requested: unknown,
): Promise<{ ok: true; slug: string } | { ok: false; reason: "invalid" | "taken" }> {
  const slug = normaliseSlug(requested);
  if (!slug) return { ok: false, reason: "invalid" };

  const current = await duckByEditKey(env, editKey);
  if (!current) return { ok: false, reason: "invalid" };
  if (current.slug === slug) return { ok: true, slug };

  if (await slugTaken(env, slug)) return { ok: false, reason: "taken" };

  try {
    const res = await env.DB.prepare(
      `UPDATE ducks SET slug = ?1, updated = ?2 WHERE edit_key = ?3`,
    )
      .bind(slug, nowSec(), editKey)
      .run();
    if (!res.meta.changes) return { ok: false, reason: "invalid" };
  } catch {
    // The UNIQUE index is the real guard; someone can take the name between
    // the check above and this write.
    return { ok: false, reason: "taken" };
  }
  return { ok: true, slug };
}

export async function updateDuck(
  env: Env,
  editKey: string,
  duck: ValidatedDuck,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE ducks
        SET tint = ?1, stickers = ?2, paint = ?3, name = ?4, message = ?5,
            updated = ?6
      WHERE edit_key = ?7`,
  )
    .bind(
      duck.tint,
      JSON.stringify(duck.stickers),
      duck.paint,
      duck.name,
      duck.message,
      nowSec(),
      editKey,
    )
    .run();
  return Boolean(res.meta.changes);
}

/**
 * Remove a duck completely.
 *
 * One statement, because `ducks_before_delete` in the schema does the rest:
 * the contact, the bumps in both directions, the fires and their rescues,
 * the says, the reports, and the references that would otherwise pin the
 * row. A trigger rather than a cascade, so it holds even where foreign keys
 * are not being enforced — see the header of that trigger.
 *
 * "Take my duck out" has to actually mean it. A person who leaves a phone
 * number on a stranger's website must be able to withdraw it without
 * emailing anyone.
 */
export async function deleteDuck(env: Env, editKey: string): Promise<boolean> {
  const res = await env.DB.prepare(`DELETE FROM ducks WHERE edit_key = ?1`)
    .bind(editKey)
    .run();
  return Boolean(res.meta.changes);
}
