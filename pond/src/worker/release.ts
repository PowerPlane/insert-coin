/**
 * Releasing a duck, and every other write that touches `contacts`.
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
 *
 * ══ AND NOW A SECOND WRITE, IN THE SAME FILE ON PURPOSE ══
 * `setContact` lives here rather than beside the withdrawal in contact.ts,
 * and the reason is the invariant rather than the subject matter: the
 * isolation test asserts that exactly ONE module writes this table. A
 * second writer anywhere would make that assertion pass by listing two
 * files, which is a weaker claim wearing the same words. So the file
 * keeps its meaning — everything that puts a contact IN is here, and the
 * only thing that takes one OUT is in contact.ts, which cannot read or
 * write, only delete.
 */

import type { ContactScope, ValidatedDuck } from "./ducks.js";
import { freeSlug } from "./slug.js";
import type { Env } from "./types.js";
import { nowSec, randomId } from "./util.js";

/**
 * Replace the contact left with a duck, or set one for the first time.
 *
 * ══ WHAT THIS DELIBERATELY CANNOT DO ══
 * It takes a value and stores it. It never reads one back, and there is no
 * function anywhere that will — the screen offering this shows an EMPTY
 * field, always, because prefilling it would mean handing a stranger's
 * phone number to whoever is holding a private link that got pasted into a
 * group chat.
 *
 * So this is "replace", not "edit". You cannot see what is there; you can
 * only put something else in its place, or take it out entirely (that is
 * `withdrawContact`, and it is a different verb in a different file).
 *
 * ══ THE SCOPE IS NOT A CHOICE HERE ══
 * `'david'` always, and that is the narrowest of the three. The contact
 * screen can offer to share with the card's keeper because it runs inside
 * a card SESSION and knows who that keeper is; the private-link screen has
 * no session and no keeper to name. Offering "share with the keeper" there
 * would be asking somebody to agree to a person the screen cannot name.
 *
 * Storing the narrowest scope also means a person who once agreed to a
 * wider one and now edits their contact has that consent NARROWED rather
 * than silently carried over. Narrowing is always safe; widening would
 * need to be asked for.
 */
export async function setContact(
  env: Env,
  editKey: string,
  value: string,
): Promise<boolean> {
  // The same shape check the duck reads use, so a malformed key never
  // reaches the database.
  if (!/^[A-Za-z0-9]{16,64}$/.test(editKey)) return false;
  if (!value) return false;

  const res = await env.DB.prepare(
    `INSERT INTO contacts (duck_id, value, scope, epoch_id, created)
     SELECT d.id, ?2, 'david', d.epoch_id, ?3 FROM ducks d WHERE d.edit_key = ?1
     ON CONFLICT(duck_id) DO UPDATE SET value = ?2, scope = 'david', created = ?3`,
  )
    .bind(editKey, value, nowSec())
    .run();

  return Boolean(res.meta.changes);
}

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
  /** Retry depth. One retry only — see the catch below. */
  attempt = 0,
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

  try {
    const [, claim] = await env.DB.batch(writes);
    if (!claim?.meta.changes) return { error: "session already used or expired" };
  } catch (err) {
    // `freeSlug` is advisory — slug.ts says so, and says the UNIQUE index is
    // what actually makes two simultaneous releases safe. It does, but by
    // THROWING: two visitors landing on the same generated name, or one
    // racing a rename into it, would otherwise surface as a 500 and lose a
    // duck somebody just spent minutes decorating.
    //
    // One retry with a fresh name. Two collisions in a row is not a race,
    // it is something else, and pretending otherwise would hide it.
    if (attempt > 0) throw err;
    return createDuck(env, sessionId, cardId, duck, contact, attempt + 1);
  }

  return { id, slug, editKey };
}
