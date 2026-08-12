/**
 * Rate limits.
 *
 * ══ WHY THESE EXIST ══
 * `?d=N` is forgeable. Anyone can type ducky.davidyang.work/?d=1 and get a
 * great-luck session without ever touching a card — the digit proves a
 * fortune was *requested*, not that a coin was *inserted*. That is the
 * central fact in docs/pond/SECURITY.md, and these counters are most of
 * what holds the line against it.
 *
 * They were written down there long before they were built, which is
 * exactly the failure mode a threat model has: a documented control that
 * does not exist reads identically to one that does.
 *
 * ══ THE SHAPE ══
 * A fixed window, one row per bucket per window, and the whole decision in
 * a single upsert — the same pattern as bumps. A read-then-write limiter is
 * not a limiter: two requests both read 9, both decide they are fine, and
 * both write 10.
 */

import type { Env } from "./types.js";
import { nowSec } from "./util.js";

/** Fixed windows, reset daily. Long enough that a burst is not the story. */
export const RATE_WINDOW_SEC = 24 * 60 * 60;

/**
 * A card is a shared object. Passing one round a table is the whole point,
 * so this has to be generous enough that a good evening never trips it and
 * tight enough that a scripted card id cannot mint hundreds overnight.
 */
export const MINT_PER_CARD = 60;

/**
 * A person. Clearing cookies to farm ducks should be slow and boring rather
 * than impossible — the honest goal here is friction, not prevention.
 */
export const MINT_PER_VISITOR = 10;

export interface Bucket {
  key: string;
  limit: number;
}

/**
 * Take one from each bucket, all in one transaction.
 *
 * Returns true only if every bucket had room. Note that a request refused
 * by one bucket still counts against the others: the attempt happened, and
 * refunding it would mean a second write and a window to crash inside. For
 * a pond among friends, charging for the attempt is the right side of that
 * trade — and it makes hammering a limit you have already hit ineffective
 * rather than free.
 */
export async function consume(env: Env, buckets: Bucket[]): Promise<boolean> {
  if (!buckets.length) return true;

  const now = nowSec();
  const window = now - (now % RATE_WINDOW_SEC);

  const results = await env.DB.batch(
    buckets.map((b) =>
      env.DB.prepare(
        `INSERT INTO rate_limits (bucket, window_start, hits)
         SELECT ?1, ?2, 1
          WHERE COALESCE((SELECT hits FROM rate_limits
                           WHERE bucket = ?1 AND window_start = ?2), 0) < ?3
            ON CONFLICT (bucket, window_start) DO UPDATE
               SET hits = rate_limits.hits + 1`,
      ).bind(b.key, window, b.limit),
    ),
  );

  // changes = 1 means this bucket had room and has now been charged for it;
  // 0 means the WHERE refused the row.
  return results.every((r) => r.meta.changes > 0);
}

/** Buckets charged when a tap is exchanged for a session. */
export function mintBuckets(cardId: string | null, visitor: string): Bucket[] {
  const buckets: Bucket[] = [{ key: `mint:v:${visitor}`, limit: MINT_PER_VISITOR }];
  if (cardId) buckets.push({ key: `mint:card:${cardId}`, limit: MINT_PER_CARD });
  return buckets;
}

/** Housekeeping: yesterday's windows can never be consulted again. */
export async function sweepRateLimits(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?1`)
    .bind(nowSec() - 2 * RATE_WINDOW_SEC)
    .run();
}
