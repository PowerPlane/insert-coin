/**
 * Duck reads and writes.
 *
 * ══ THE ONE RULE ══
 * Nothing in this file may name the `contacts` table. The public pond read
 * must be structurally incapable of returning a contact — not "we remember
 * to strip the field", but "the query does not know the table exists".
 * `test/contacts-isolation.test.ts` greps this file to enforce it.
 */

import type { Env, PublicDuck } from "./types";
import { cleanText, nowSec, randomId } from "./util";

export const MAX_STICKERS = 6;
export const PAINT_B64_MAX = 512; // 24×24 @ 4bpp = 288 bytes → 384 b64 chars

/** Sticker ids the client ships. Anything else is rejected, not stored. */
const STICKER_IDS = new Set([
  "tophat","cap","beanie","cowboy","crown","party","wizard","wreath","halo","bow",
  "shades","specs","patch","blush","tache",
  "scarf","bowtie","chain","collar",
  "heart","star","spot","stripe","pocket",
  "balloon","fish","leaf","spark",
  "handbag","tote","basket","satchel",
]);

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
export function validateDuck(input: DuckInput): ValidatedDuck | { error: string } {
  const fortune = Number(input.fortune);
  if (!Number.isInteger(fortune) || fortune < 0 || fortune > 3) {
    return { error: "bad fortune" };
  }
  const tint = Number(input.tint);
  if (!Number.isInteger(tint) || tint < 0 || tint > 31) {
    return { error: "bad tint" };
  }

  let stickers: { id: string; x: number; y: number }[] = [];
  if (input.stickers !== undefined && input.stickers !== null) {
    if (!Array.isArray(input.stickers)) return { error: "bad stickers" };
    if (input.stickers.length > MAX_STICKERS) return { error: "too many stickers" };
    for (const raw of input.stickers) {
      if (typeof raw !== "object" || raw === null) return { error: "bad sticker" };
      const s = raw as Record<string, unknown>;
      const id = String(s.id ?? "");
      const x = Number(s.x);
      const y = Number(s.y);
      if (!STICKER_IDS.has(id)) return { error: "unknown sticker" };
      // The grid is 24×24; anything outside it can't render and is a probe.
      if (!Number.isInteger(x) || x < 0 || x > 23) return { error: "sticker out of bounds" };
      if (!Number.isInteger(y) || y < 0 || y > 23) return { error: "sticker out of bounds" };
      stickers.push({ id, x, y });
    }
  }

  let paint = "";
  if (typeof input.paint === "string" && input.paint.length > 0) {
    if (input.paint.length > PAINT_B64_MAX) return { error: "paint too large" };
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.paint)) return { error: "paint not base64" };
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

export interface CreatedDuck {
  id: string;
  editKey: string;
}

export async function createDuck(
  env: Env,
  sessionId: string,
  cardId: string | null,
  duck: ValidatedDuck,
): Promise<CreatedDuck | { error: string }> {
  const id = randomId(10);
  // Separate, longer secret. Never derived from `id`, so knowing a public
  // duck id tells you nothing about its edit key.
  const editKey = randomId(32);
  const ts = nowSec();

  // One duck per session, enforced by the UPDATE's WHERE clause rather than
  // a read-then-write: two parallel submits race, and exactly one wins.
  const claim = await env.DB.prepare(
    `UPDATE sessions SET spent_duck = ?1
       WHERE id = ?2 AND spent_duck IS NULL AND expires >= ?3`,
  )
    .bind(id, sessionId, ts)
    .run();
  if (!claim.meta.changes) return { error: "session already used or expired" };

  await env.DB.prepare(
    `INSERT INTO ducks
       (id, edit_key, card_id, fortune, tint, stickers, paint, name, message,
        created, updated)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`,
  )
    .bind(
      id,
      editKey,
      cardId,
      duck.fortune,
      duck.tint,
      JSON.stringify(duck.stickers),
      duck.paint,
      duck.name,
      duck.message,
      ts,
    )
    .run();

  return { id, editKey };
}

/**
 * The public pond.
 *
 * Reads only from `ducks`, plus the two derived bits the client needs to
 * draw (is it on fire, is it saying something). No join reaches anything
 * private. Capped and ordered so the response size is bounded no matter how
 * large the pond gets.
 */
export async function listPond(env: Env, limit = 200): Promise<PublicDuck[]> {
  const ts = nowSec();
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.fortune, d.tint, d.stickers, d.paint, d.name, d.message,
            d.created, d.wave_count, d.rescue_count,
            (SELECT 1 FROM fires f
               WHERE f.duck_id = d.id AND f.out_at IS NULL AND f.burns_until > ?1
               LIMIT 1) AS burning,
            (SELECT s.text FROM says s
               WHERE s.duck_id = d.id AND s.created > ?2
               ORDER BY s.created DESC LIMIT 1) AS say_text,
            (SELECT s.created FROM says s
               WHERE s.duck_id = d.id AND s.created > ?2
               ORDER BY s.created DESC LIMIT 1) AS say_at
       FROM ducks d
      WHERE d.hidden = 0
      ORDER BY d.created DESC
      LIMIT ?3`,
  )
    .bind(ts, ts - 45, limit)
    .all<Record<string, unknown>>();

  return (results ?? []).map((r) => ({
    id: String(r.id),
    fortune: Number(r.fortune),
    tint: Number(r.tint),
    stickers: safeParseStickers(r.stickers),
    paint: String(r.paint ?? ""),
    name: String(r.name ?? ""),
    message: String(r.message ?? ""),
    created: Number(r.created),
    waves: Number(r.wave_count ?? 0),
    rescues: Number(r.rescue_count ?? 0),
    burning: Boolean(r.burning),
    say: r.say_text ? { text: String(r.say_text), at: Number(r.say_at) } : null,
  }));
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
export async function duckByEditKey(env: Env, editKey: string) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(editKey)) return null;
  return env.DB.prepare(
    `SELECT id, fortune, tint, stickers, paint, name, message, created,
            wave_count, rescue_count, hidden
       FROM ducks WHERE edit_key = ?1`,
  )
    .bind(editKey)
    .first<Record<string, unknown>>();
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
 * `contacts.duck_id` is ON DELETE CASCADE, so the contact goes in the same
 * statement. "Take my duck out" has to actually mean it — a person who
 * leaves a phone number on a stranger's website must be able to withdraw it
 * without emailing anyone.
 */
export async function deleteDuck(env: Env, editKey: string): Promise<boolean> {
  const res = await env.DB.prepare(`DELETE FROM ducks WHERE edit_key = ?1`)
    .bind(editKey)
    .run();
  return Boolean(res.meta.changes);
}
