/**
 * Releasing a duck — the one write that touches `contacts`.
 *
 * ══ WHY THIS IS ITS OWN FILE ══
 * `ducks.ts` may not name the `contacts` table at all. That rule is what
 * makes the privacy claim checkable by grep instead of by review, and
 * `test/contacts-isolation.test.ts` enforces it.
 *
 * The release needs the contact and the duck to land together — a duck in
 * the pond with the contact still in flight is a half-state, and it was one
 * of the three cases `batch()` was built for. Putting it in ducks.ts would
 * have bought that atomicity by spending the rule; putting it here buys
 * both. The seam is honest: releasing is a different operation from reading
 * and editing, and it is the only one that has ever needed this table.
 *
 * There is no SELECT from `contacts` anywhere in this file either. Nothing
 * reads a contact except the admin screens, which are Phase 4 and will get
 * their own module and their own password.
 */

import type { ContactScope, ValidatedDuck } from "./ducks.js";
import { freeSlug } from "./slug.js";
import type { Env } from "./types.js";
import { nowSec, randomId } from "./util.js";

export interface CreatedDuck {
  id: string;
  slug: string;
  editKey: string;
}

/**
 * Release a duck.
 *
 * One session mints one duck, and that is enforced by the SHAPE of these
 * statements rather than by a check before them. Both the insert and the
 * claim carry the same `WHERE … spent_duck IS NULL AND expires >= now`
 * guard, and they run in one `batch()`, so:
 *
 *   * two parallel submits race and exactly one produces a duck,
 *   * the loser inserts nothing — there is no orphan to compensate for,
 *   * a crash between the two is impossible; there is no "between".
 *
 * The earlier version inserted the duck first and deleted it again if it
 * lost the race. That worked, but only while the process survived long
 * enough to run the apology.
 */
export async function createDuck(
  env: Env,
  sessionId: string,
  cardId: string | null,
  duck: ValidatedDuck,
  contact?: { value: string; scope: ContactScope } | null,
): Promise<CreatedDuck | { error: string }> {
  const id = randomId(10);
  // Separate, longer secret. Never derived from `id` or the slug, so a
  // readable public URL tells you nothing about the edit key.
  const editKey = randomId(32);
  const ts = nowSec();
  // Auto-assigned so nobody has to invent a unique name to release a duck.
  // Renameable afterwards in settings.
  const slug = await freeSlug(env);

  const writes = [
    env.DB.prepare(
      `INSERT INTO ducks
         (id, slug, edit_key, card_id, epoch_id, fortune, tint, stickers,
          paint, name, message, created, updated)
       SELECT ?1, ?2, ?3, ?4,
              (SELECT e.id FROM card_epochs e
                WHERE e.card_id = ?4 AND e.ended IS NULL),
              ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
        WHERE EXISTS (SELECT 1 FROM sessions
                       WHERE id = ?12 AND spent_duck IS NULL AND expires >= ?11)`,
    ).bind(
      id,
      slug,
      editKey,
      cardId,
      duck.fortune,
      duck.tint,
      JSON.stringify(duck.stickers),
      duck.paint,
      duck.name,
      duck.message,
      ts,
      sessionId,
    ),
    env.DB.prepare(
      `UPDATE sessions SET spent_duck = ?1
        WHERE id = ?2 AND spent_duck IS NULL AND expires >= ?3`,
    ).bind(id, sessionId, ts),
  ];

  if (contact) {
    // Private. Its own table, its own statement, never joined by any public
    // read. The epoch is copied from the duck so the consent expires with
    // the keeper it was given to — a contact shared with Sam is not
    // inherited by whoever keeps the card next.
    //
    // Guarded by the same EXISTS as the duck: if this session lost the
    // race, the duck was not inserted and the contact must not be either.
    // An orphaned contact is the one row in this database that must never
    // exist.
    writes.push(
      env.DB.prepare(
        `INSERT INTO contacts (duck_id, value, scope, epoch_id, created)
         SELECT ?1, ?2, ?3, (SELECT epoch_id FROM ducks WHERE id = ?1), ?4
          WHERE EXISTS (SELECT 1 FROM ducks WHERE id = ?1)`,
      ).bind(id, contact.value, contact.scope, ts),
    );
  }

  const [, claim] = await env.DB.batch(writes);
  if (!claim?.meta.changes) return { error: "session already used or expired" };

  return { id, slug, editKey };
}
