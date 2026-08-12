/**
 * Waves, fires and speech.
 *
 * Every one of these is a high-frequency action from many clients at once,
 * so nothing here is read-then-write. Each is a single atomic statement
 * whose WHERE clause is the check — two parallel requests race and exactly
 * one wins, without a transaction.
 */

import type { Env } from "./types";
import { cleanText, nowSec } from "./util";

export const SAY_COOLDOWN_SEC = 10 * 60;
export const SAY_MAX_CHARS = 60;
export const FIRE_BURN_SEC = 90;
export const FIRE_MIN_GAP_SEC = 45;
export const FIRE_REIGNITE_SEC = 10 * 60;
export const FIRE_MAX_CONCURRENT = 2;

/**
 * Wave once per person per duck.
 *
 * `INSERT OR IGNORE` against the (duck_id, visitor) primary key gives the
 * idempotency, and the counter only moves when the insert actually
 * inserted — so hammering the button earns nothing.
 *
 * The INSERT ... SELECT form matters: `OR IGNORE` does not swallow foreign
 * key violations, so a plain insert with a well-shaped but nonexistent duck
 * id would raise instead of returning a clean 404.
 */
export async function wave(env: Env, duckId: string, visitor: string): Promise<number | null> {
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO waves (duck_id, visitor, created)
     SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM ducks WHERE id = ?1)`,
  )
    .bind(duckId, visitor, nowSec())
    .run();

  if (ins.meta.changes) {
    // += 1 in SQL, never read-modify-write in JS: concurrent waves would
    // otherwise both read N and both write N+1.
    await env.DB.prepare(
      `UPDATE ducks SET wave_count = wave_count + 1 WHERE id = ?1`,
    )
      .bind(duckId)
      .run();
  }

  const row = await env.DB.prepare(`SELECT wave_count FROM ducks WHERE id = ?1`)
    .bind(duckId)
    .first<{ wave_count: number }>();
  return row ? row.wave_count : null;
}

/**
 * Say something. The 10-minute cooldown is enforced here, not in the
 * client, because the client is the one part an attacker controls.
 *
 * The INSERT ... SELECT ... WHERE NOT EXISTS makes the cooldown atomic:
 * two simultaneous posts cannot both pass a separate "check then insert".
 */
export async function say(
  env: Env,
  duckId: string,
  raw: unknown,
): Promise<{ ok: true; text: string } | { ok: false; retryAfter: number }> {
  const text = cleanText(raw, SAY_MAX_CHARS);
  const ts = nowSec();

  if (!text) return { ok: false, retryAfter: 0 };

  const res = await env.DB.prepare(
    `INSERT INTO says (duck_id, text, created)
     SELECT ?1, ?2, ?3
      WHERE NOT EXISTS (
        SELECT 1 FROM says WHERE duck_id = ?1 AND created > ?4
      )`,
  )
    .bind(duckId, text, ts, ts - SAY_COOLDOWN_SEC)
    .run();

  if (res.meta.changes) return { ok: true, text };

  const last = await env.DB.prepare(
    `SELECT created FROM says WHERE duck_id = ?1 ORDER BY created DESC LIMIT 1`,
  )
    .bind(duckId)
    .first<{ created: number }>();
  const retryAfter = last ? Math.max(0, last.created + SAY_COOLDOWN_SEC - ts) : 0;
  return { ok: false, retryAfter };
}

/**
 * Ignite a 凶 duck. Server-only — no client can start a fire, so there is
 * nothing to farm and no griefing vector. Called from a scheduled handler.
 */
export async function maybeIgnite(env: Env): Promise<boolean> {
  const ts = nowSec();

  // One statement, so two overlapping cron invocations can't both pass the
  // caps and light three fires at once. Every guard lives in the WHERE:
  //   * fewer than FIRE_MAX_CONCURRENT currently burning
  //   * at least FIRE_MIN_GAP_SEC since the last ignition
  //   * the duck is a visible 凶 that isn't burning and hasn't burned recently
  const res = await env.DB.prepare(
    `INSERT INTO fires (duck_id, lit_at, burns_until)
     SELECT d.id, ?1, ?1 + ?2
       FROM ducks d
      WHERE d.fortune = 3
        AND d.hidden = 0
        AND NOT EXISTS (
              SELECT 1 FROM fires f
               WHERE f.duck_id = d.id
                 AND ((f.out_at IS NULL AND f.burns_until > ?1)
                      OR f.lit_at > ?1 - ?3))
        AND (SELECT COUNT(*) FROM fires
              WHERE out_at IS NULL AND burns_until > ?1) < ?4
        AND COALESCE((SELECT MAX(lit_at) FROM fires), 0) <= ?1 - ?5
      ORDER BY RANDOM()
      LIMIT 1`,
  )
    .bind(ts, FIRE_BURN_SEC, FIRE_REIGNITE_SEC, FIRE_MAX_CONCURRENT, FIRE_MIN_GAP_SEC)
    .run();

  return Boolean(res.meta.changes);
}

/**
 * Put a fire out.
 *
 * `UPDATE ... WHERE out_at IS NULL` is the race: the first writer wins and
 * gets changes=1, everyone else gets 0. A late tap is not an error — the
 * client animates the extinguish either way and simply isn't credited.
 * Nobody should see a failure message for being a second slow.
 */
export async function extinguish(
  env: Env,
  duckId: string,
  visitor: string,
): Promise<{ alreadyOut: boolean; credited: boolean }> {
  const ts = nowSec();

  const fire = await env.DB.prepare(
    `SELECT id FROM fires
      WHERE duck_id = ?1 AND out_at IS NULL AND burns_until > ?2
      ORDER BY lit_at DESC LIMIT 1`,
  )
    .bind(duckId, ts)
    .first<{ id: number }>();
  if (!fire) return { alreadyOut: true, credited: false };

  const won = await env.DB.prepare(
    `UPDATE fires SET out_at = ?1, out_by = ?2 WHERE id = ?3 AND out_at IS NULL`,
  )
    .bind(ts, visitor, fire.id)
    .run();

  // Credit belongs to whoever actually put it out. Crediting on every tap
  // would hand a rescue to people who arrived after the fire was already
  // out, which makes the number on someone's duck card a lie.
  if (!won.meta.changes) return { alreadyOut: true, credited: false };

  // Per person per fire, so spamming taps still earns nothing.
  const credit = await env.DB.prepare(
    `INSERT OR IGNORE INTO rescues (fire_id, visitor, created) VALUES (?1, ?2, ?3)`,
  )
    .bind(fire.id, visitor, ts)
    .run();

  if (credit.meta.changes) {
    await env.DB.prepare(
      `UPDATE ducks SET rescue_count = rescue_count + 1 WHERE id = ?1`,
    )
      .bind(duckId)
      .run();
  }

  return { alreadyOut: false, credited: Boolean(credit.meta.changes) };
}
