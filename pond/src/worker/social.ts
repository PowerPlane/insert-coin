/**
 * Bumps, fires, speech and reports.
 *
 * Every one of these is a high-frequency action from many clients at once,
 * so nothing here is read-then-write. Each is a single atomic statement
 * whose WHERE clause is the check — two parallel requests race and exactly
 * one wins, without a transaction.
 *
 * That constraint is why the schema looks the way it does. Where a rule
 * could not be expressed in one statement, the schema changed until it
 * could, rather than the code growing a lock.
 */

import type { Env } from "./types.js";
import { cleanText, nowSec } from "./util.js";

export const SAY_COOLDOWN_SEC = 10 * 60;
export const SAY_MAX_CHARS = 60;
export const FIRE_BURN_SEC = 90;
export const FIRE_MIN_GAP_SEC = 45;
export const FIRE_REIGNITE_SEC = 10 * 60;
export const FIRE_MAX_CONCURRENT = 2;
/**
 * Ten unreturned bumps and it is their turn.
 *
 * The poke dynamic: it forces reciprocity instead of one-way spam. Counted
 * as sent-minus-received for the PAIR, so a bump back always frees up room
 * to bump again, and nobody can be silenced by someone else's enthusiasm.
 */
export const BUMP_UNRETURNED_CAP = 10;

export const REPORT_REASONS = ["rude", "private", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_NOTE_MAX = 200;

export type BumpResult =
  | { ok: true; bumps: number; unreturned: number }
  | { ok: false; reason: "unknown" | "self" | "capped" };

/**
 * Bump another duck.
 *
 * Directional and per-pair, so "bump back" is derivable and the cap is
 * expressible. The whole rule lives in one upsert:
 *
 *   * the target must exist and be visible,
 *   * sent-minus-received for this pair must be under the cap,
 *   * and on conflict the existing row increments.
 *
 * The caller has already proved it owns `fromDuck` by presenting that
 * duck's private edit key. That matters more than it looks: with a
 * forgeable `from`, anyone could burn through a stranger's ten unreturned
 * bumps on their behalf and lock them out of bumping someone. An
 * unauthenticated cap is not a cap, it is a weapon.
 */
export async function bump(
  env: Env,
  fromDuck: string,
  toDuck: string,
): Promise<BumpResult> {
  if (fromDuck === toDuck) return { ok: false, reason: "self" };
  const ts = nowSec();

  const res = await env.DB.prepare(
    `INSERT INTO bumps (from_duck, to_duck, total, first_at, last_at)
     SELECT ?1, ?2, 1, ?3, ?3
      WHERE EXISTS (SELECT 1 FROM ducks WHERE id = ?2 AND hidden = 0)
        AND (COALESCE((SELECT b.total FROM bumps b
                        WHERE b.from_duck = ?1 AND b.to_duck = ?2), 0)
             - COALESCE((SELECT b.total FROM bumps b
                          WHERE b.from_duck = ?2 AND b.to_duck = ?1), 0)) < ?4
        ON CONFLICT (from_duck, to_duck) DO UPDATE
           SET total = bumps.total + 1, last_at = ?3`,
  )
    .bind(fromDuck, toDuck, ts, BUMP_UNRETURNED_CAP)
    .run();

  if (!res.meta.changes) {
    // Nothing happened, and the two reasons need different words on screen:
    // a duck that is gone or hidden is "that duck isn't in the pond", a cap
    // is "bump them back first".
    const exists = await env.DB.prepare(
      `SELECT 1 AS x FROM ducks WHERE id = ?1 AND hidden = 0`,
    )
      .bind(toDuck)
      .first<{ x: number }>();
    return { ok: false, reason: exists ? "capped" : "unknown" };
  }

  const totals = await env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(b.total), 0) FROM bumps b WHERE b.to_duck = ?2) AS bumps,
            COALESCE((SELECT b.total FROM bumps b
                       WHERE b.from_duck = ?1 AND b.to_duck = ?2), 0)
            - COALESCE((SELECT b.total FROM bumps b
                         WHERE b.from_duck = ?2 AND b.to_duck = ?1), 0) AS unreturned`,
  )
    .bind(fromDuck, toDuck)
    .first<{ bumps: number; unreturned: number }>();

  return {
    ok: true,
    bumps: Number(totals?.bumps ?? 0),
    unreturned: Number(totals?.unreturned ?? 0),
  };
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
 * nothing to farm and no griefing vector.
 *
 * Called from GET /api/pond, not from a timer. Vercel Hobby crons run once
 * a day and a finer expression fails at deploy time, but that turned out to
 * be a better design anyway: nobody sees a fire that starts while nobody is
 * looking, so the timer was never doing real work.
 */
export async function maybeIgnite(env: Env): Promise<boolean> {
  const ts = nowSec();

  // One statement, so two overlapping requests can't both pass the caps and
  // light three fires at once. Every guard lives in the WHERE:
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
 * ONE statement. `WHERE … out_at IS NULL` is the race: the first writer
 * wins and gets `changes = 1`, everyone else gets 0. Winning and being
 * credited are the same event — `out_by` records who did it — so there is
 * no second write to keep in step and no window to crash inside.
 *
 * A late tap is not an error. The client animates the extinguish either way
 * and simply isn't credited; nobody should see a failure message for being
 * a second slow.
 */
export async function extinguish(
  env: Env,
  duckId: string,
  visitor: string,
): Promise<{ alreadyOut: boolean; credited: boolean }> {
  const ts = nowSec();

  const res = await env.DB.prepare(
    `UPDATE fires
        SET out_at = ?1, out_by = ?2
      WHERE id = (SELECT id FROM fires
                   WHERE duck_id = ?3 AND out_at IS NULL AND burns_until > ?1
                   ORDER BY lit_at DESC LIMIT 1)`,
  )
    .bind(ts, visitor, duckId)
    .run();

  const won = Boolean(res.meta.changes);
  return { alreadyOut: !won, credited: won };
}

/**
 * Report a duck.
 *
 * Anyone can file; only the admin acts. A reason is required and a note is
 * optional, because a report that arrives as a bare row tells David nothing
 * he can act on — "Rude or abusive" and "Private details" need different
 * responses, and the second one needs answering quickly.
 *
 * One report per visitor per duck, enforced by a UNIQUE index rather than a
 * check, so the button is idempotent ("Reported ✓") and the queue cannot be
 * flooded by one person tapping repeatedly. Filing twice is not an error to
 * show anybody — it is the same report.
 */
export async function report(
  env: Env,
  duckId: string,
  visitor: string,
  reason: unknown,
  note: unknown,
): Promise<{ ok: true; filed: boolean } | { ok: false; reason: "unknown" | "bad reason" }> {
  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    return { ok: false, reason: "bad reason" };
  }

  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO reports (duck_id, visitor, reason, note, created)
     SELECT ?1, ?2, ?3, ?4, ?5
      WHERE EXISTS (SELECT 1 FROM ducks WHERE id = ?1)`,
  )
    .bind(duckId, visitor, reason, cleanText(note, REPORT_NOTE_MAX), nowSec())
    .run();

  if (res.meta.changes) return { ok: true, filed: true };

  // Either the duck is gone, or this visitor already reported it. Only the
  // first is worth telling anyone about.
  const exists = await env.DB.prepare(`SELECT 1 AS x FROM ducks WHERE id = ?1`)
    .bind(duckId)
    .first<{ x: number }>();
  return exists ? { ok: true, filed: false } : { ok: false, reason: "unknown" };
}
