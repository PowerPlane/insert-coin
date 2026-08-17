/**
 * Taking a contact back.
 *
 * ══ WHY THIS FILE EXISTS ══
 * A contact could be given and never withdrawn. `release.ts` writes one,
 * the schema's delete trigger removes it along with the whole duck, and
 * nothing in between could touch it. So the only way to withdraw a phone
 * number was to destroy the duck it came with — which asks someone to give
 * up the thing they made in order to take back the thing they regret.
 *
 * That is the wrong trade to put in front of a person, and it is the one
 * trade this project promised not to: "a person who leaves a phone number
 * on a stranger's website must be able to withdraw it without emailing
 * anyone" is written above `deleteDuck`, and until now it was only half
 * true.
 *
 * ══ IT DELETES, AND THAT IS ALL IT DOES ══
 * There is no SELECT here and no INSERT. Not an oversight — the whole
 * point.
 *
 * `contacts-isolation.test.ts` states the invariant plainly: the correct
 * number of reads of this table anywhere in the worker is zero, because
 * reading one is Phase 4, behind a password, in a module that does not
 * exist yet. Withdrawal does not need a read. "Is there a contact to take
 * back" is answered by taking it back and counting the rows that went, so
 * the answer only ever exists as a consequence of the owner asking for it
 * — never as something the server will tell you if you ask nicely.
 *
 * The value itself is never returned, to anyone, ever. Somebody holding
 * the private link can already delete the duck outright; that is not a
 * reason to also hand them a stranger's email address back in a JSON
 * response, which is what "let the owner see what they left" would mean
 * the day a link is pasted into a group chat.
 *
 * ══ THE EDIT KEY IS THE AUTHORISATION ══
 * The router has already resolved the key to a duck before calling this,
 * so an unknown key is a 404 before it reaches here. The DELETE still
 * matches on the key rather than on an id passed down, because a statement
 * that carries its own authorisation cannot be called wrongly by the next
 * person to add a route.
 */

import type { Env } from "./types.js";

/**
 * Withdraw the contact left with a duck, if there is one.
 *
 * Returns whether a row went. False is not a failure: it means there was
 * nothing to take back, which is a perfectly ordinary thing to discover
 * and worth telling the person plainly rather than pretending an action
 * happened.
 */
export async function withdrawContact(env: Env, editKey: string): Promise<boolean> {
  // Same shape check the duck reads use. Cheap, and it keeps a malformed
  // key from ever reaching the database.
  if (!/^[A-Za-z0-9]{16,64}$/.test(editKey)) return false;

  const res = await env.DB.prepare(
    `DELETE FROM contacts
      WHERE duck_id = (SELECT id FROM ducks WHERE edit_key = ?1)`,
  )
    .bind(editKey)
    .run();

  return Boolean(res.meta.changes);
}
