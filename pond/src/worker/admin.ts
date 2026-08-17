/**
 * `/pondkeeper` — the one screen with a reader rather than visitors.
 *
 * ══ THE PASSWORD IS THE LOCK; THE PATH IS CONVENIENCE ══
 * URLs leak through browser history, referrers and server logs, so the
 * secret path is not treated as a secret. Everything here goes through
 * `authorised()`, and a wrong password gets the same 404 an unknown route
 * gets — an admin panel that announces itself is a thing to try passwords
 * against.
 *
 * ══ THIS IS THE ONLY MODULE THAT MAY READ A CONTACT ══
 * `ducks.ts` may not name the table at all and `release.ts` may only insert.
 * Reading one is a deliberate act that happens here, behind a password, and
 * `test/contacts-isolation.test.ts` enforces the rest.
 */

import type { Env } from "./types.js";
import { isReservedKeeperName } from "./keeper.js";
import { cleanText, json, nowSec, timingSafeEqual } from "./util.js";

/** Twelve hours: long enough for an evening of moderation, short enough. */
const ADMIN_TTL_SEC = 12 * 60 * 60;
const ADMIN_COOKIE = "pond_admin";

async function token(env: Env): Promise<string> {
  const { hmac } = await import("./session.js");
  // Derived, not stored: the password changing invalidates every session
  // without anything to clean up.
  return hmac(env.SESSION_SECRET, `admin:${env.ADMIN_PASSWORD}`);
}

export async function authorised(req: Request, env: Env): Promise<boolean> {
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)pond_admin=([A-Za-z0-9]+)/);
  if (!match?.[1]) return false;
  return timingSafeEqual(match[1], await token(env));
}

export async function signIn(env: Env, password: unknown): Promise<string | null> {
  if (typeof password !== "string" || !password) return null;
  // Constant-time: a fast reject leaks how much of the password was right.
  if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) return null;
  return [
    `${ADMIN_COOKIE}=${await token(env)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict", // no cross-site entry to an admin panel, ever
    `Max-Age=${ADMIN_TTL_SEC}`,
  ].join("; ");
}

export interface AdminDuck {
  id: string;
  slug: string;
  name: string;
  message: string;
  created: number;
  hidden: number;
  fortune: number;
  keeper: string | null;
  /** Admin-only, and the one place it is ever selected. */
  card: string | null;
  /**
   * The duck's private link, for putting somebody back in touch with their
   * own duck.
   *
   * ══ THIS IS THE CREDENTIAL, NOT AN IDENTIFIER ══
   * Whoever holds it can edit, redecorate or delete that duck. It is here
   * for one reason: people lose the link, and without it their duck is
   * stranded — still in the pond, still being bumped, and no longer
   * theirs. Recovery is a real need and there is no account to fall back
   * on.
   *
   * It is admin-only, behind the password, on the same screen that already
   * shows contacts — a stricter secret than this one. It must never reach
   * `PublicDuck`, and `contacts-isolation.test.ts` fails if it does.
   */
  editKey: string;
  reports: number;
  contact: string | null;
  scope: string | null;
  /**
   * Who the contact was actually shared WITH — the tenure it was given to,
   * which is not always the duck's current one.
   *
   * The query has always returned this and the client has always rendered
   * it; only this interface did not mention it. So the one thing standing
   * between "the consent shown beside a contact" and a silent server-side
   * edit that drops it was nobody happening to look. Codex found the gap.
   */
  contactKeeper: string | null;
  replied: number | null;
  postcard: number | null;
}

/**
 * Everything about every duck, contacts included.
 *
 * One query rather than a list plus a lookup per row: this is the only
 * screen that wants the join, and doing it here keeps the N+1 out of a
 * page that will one day show a hundred rows on a phone.
 */
/*
 * ══ CONSENT NAMES THE TENURE IT WAS GIVEN TO ══
 * `keeper` below comes from the DUCK's current tenure, which is the right
 * answer for what the pond shows. It is the wrong answer for a contact.
 * "Shared with Sam" means SAM — and after an unlink and a re-adoption a
 * duck's tenure can be somebody else entirely while the consent still
 * points where it was given. Showing the new keeper's name beside a
 * stranger's address would be this screen telling David that a person
 * agreed to something they never agreed to.
 *
 * So `contact_keeper` reads `contacts.epoch_id`, which is the row that
 * recorded the consent, and the two are kept apart.
 *
 * This note lives here rather than inside the SQL because that string is
 * a template literal, and a comment containing a backtick — around `via`,
 * as the first draft of this one did — ends the string early. That has
 * cost this project a truncated file once already.
 */
export async function adminDucks(env: Env): Promise<AdminDuck[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.slug, d.name, d.message, d.created, d.hidden, d.fortune,
            d.card_id AS card, d.edit_key AS edit_key,
            (SELECT e.keeper_name FROM card_epochs e WHERE e.id = d.epoch_id) AS keeper,
            (SELECT e.keeper_name FROM card_epochs e WHERE e.id = c.epoch_id)
              AS contact_keeper,
            (SELECT COUNT(*) FROM reports r WHERE r.duck_id = d.id AND r.resolved = 0) AS reports,
            c.value AS contact, c.scope, c.replied, c.postcard
       FROM ducks d
       LEFT JOIN contacts c ON c.duck_id = d.id
      ORDER BY d.created DESC`,
  ).all<Record<string, unknown>>();

  return (results ?? []).map((r) => ({
    id: String(r.id),
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    message: String(r.message ?? ""),
    created: Number(r.created),
    hidden: Number(r.hidden ?? 0),
    fortune: Number(r.fortune),
    keeper: r.keeper ? String(r.keeper) : null,
    contactKeeper: r.contact_keeper ? String(r.contact_keeper) : null,
    card: r.card ? String(r.card) : null,
    editKey: String(r.edit_key ?? ""),
    reports: Number(r.reports ?? 0),
    contact: r.contact ? String(r.contact) : null,
    scope: r.scope ? String(r.scope) : null,
    replied: r.replied === null || r.replied === undefined ? null : Number(r.replied),
    postcard: r.postcard === null || r.postcard === undefined ? null : Number(r.postcard),
  }));
}

export interface AdminCard {
  id: string;
  label: string;
  created: number;
  disabled: number;
  keeper: string | null;
  lang: string | null;
  ducks: number;
  /*
   * ══ CLAIMED IS NOT THE SAME AS NAMED ══
   * `keeper` is null both when nobody has claimed the card and when its
   * keeper left the name blank, and admin could not tell those apart —
   * which is exactly the distinction David needs when deciding whether to
   * assign somebody. A keeper with no name has still claimed it, and
   * offering the card to the next visitor would be offering something
   * already taken.
   */
  claimed: boolean;
  /** Ducks from this card that no tenure has adopted. */
  orphans: number;
  /*
   * ══ THE HIGH-WATER MARK ══
   * A claim is accepted only when its counter EXCEEDS this. It is the
   * single number that decides whether four blows work, and it was
   * invisible — so "the gesture did nothing" could not be told apart
   * from "the card armed at a counter the server had already retired"
   * without reading the tag with a phone.
   */
  claimCounter: number;
}

export async function adminCards(env: Env): Promise<AdminCard[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.label, c.created, c.disabled, c.claim_counter,
            e.id AS epoch, e.keeper_name AS keeper, e.lang,
            (SELECT COUNT(*) FROM ducks d WHERE d.card_id = c.id) AS ducks,
            (SELECT COUNT(*) FROM ducks d
              WHERE d.card_id = c.id AND d.epoch_id IS NULL) AS orphans
       FROM cards c
       LEFT JOIN card_epochs e ON e.card_id = c.id AND e.ended IS NULL
      ORDER BY c.created`,
  ).all<Record<string, unknown>>();

  return (results ?? []).map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    created: Number(r.created),
    disabled: Number(r.disabled ?? 0),
    keeper: r.keeper ? String(r.keeper) : null,
    lang: r.lang ? String(r.lang) : null,
    ducks: Number(r.ducks ?? 0),
    claimed: Boolean(r.epoch),
    orphans: Number(r.orphans ?? 0),
    claimCounter: Number(r.claim_counter ?? 0),
  }));
}

/** Hide or unhide. Never a hard delete, so a mistake is one tap back. */
export async function setHidden(env: Env, duckId: string, hidden: boolean): Promise<boolean> {
  const res = await env.DB.prepare(`UPDATE ducks SET hidden = ?1 WHERE id = ?2`)
    .bind(hidden ? 1 : 0, duckId)
    .run();
  return Boolean(res.meta.changes);
}

/** Mark a contact answered, or a postcard posted. Dates, not booleans. */
export async function markContact(
  env: Env,
  duckId: string,
  field: "replied" | "postcard",
  done: boolean,
): Promise<boolean> {
  // The column name is not interpolated from input — these two literals are
  // the only values this can ever be.
  const sql =
    field === "replied"
      ? `UPDATE contacts SET replied = ?1 WHERE duck_id = ?2`
      : `UPDATE contacts SET postcard = ?1 WHERE duck_id = ?2`;
  const res = await env.DB.prepare(sql).bind(done ? nowSec() : null, duckId).run();
  return Boolean(res.meta.changes);
}

/**
 * Rename a card, in the admin's own words.
 *
 * `label` is what the Cards tab shows when a card has no keeper yet — "the
 * one I gave Sam". It is never seen by a visitor and never leaves this
 * screen.
 */
export async function setCardLabel(env: Env, cardId: string, label: string): Promise<boolean> {
  const res = await env.DB.prepare(`UPDATE cards SET label = ?1 WHERE id = ?2`)
    .bind(cleanText(label, 40), cardId)
    .run();
  return Boolean(res.meta.changes);
}

/**
 * Switch a card off, or back on.
 *
 * ══ THIS IS THE KILL SWITCH, AND IT IS WHY DELETE IS NOT ══
 * `mintSession` refuses a disabled card, so this stops new fortunes and
 * new claims dead while leaving every duck that came off it exactly where
 * it is, still carrying its keeper's name. And it is reversible, which is
 * the whole difference: a card switched off by mistake is one tap from
 * being a card again.
 */
export async function setCardDisabled(
  env: Env,
  cardId: string,
  disabled: boolean,
): Promise<boolean> {
  const res = await env.DB.prepare(`UPDATE cards SET disabled = ?1 WHERE id = ?2`)
    .bind(disabled ? 1 : 0, cardId)
    .run();
  return Boolean(res.meta.changes);
}

/**
 * Amend the CURRENT keeper's settings.
 *
 * ══ AMEND, NEVER END AND REOPEN ══
 * The obvious implementation is to end the epoch and open a new one with
 * the new name. It would be wrong. A contact's consent is tied to the
 * epoch it was given under — "shared with Sam" means SAM — so ending an
 * epoch to change a spelling would orphan consent that somebody gave to a
 * person who has not actually changed.
 *
 * Ending an epoch is what a NEW KEEPER does, by holding the card and
 * blowing on it. This is the admin correcting a label on the same tenure,
 * which is a different act and must not look like the other one.
 *
 * Refuses a reserved name for the same reason the four-blow path does: a
 * keeper called "admin" or "pond" would be quoting the pond itself on
 * every duck from that card.
 */
export async function setKeeper(
  env: Env,
  cardId: string,
  fields: { name?: unknown; lang?: unknown },
): Promise<{ ok: true } | { error: "reserved name" | "no epoch" }> {
  const epoch = await env.DB.prepare(
    `SELECT id FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
  )
    .bind(cardId)
    .first<{ id: string }>();
  // No open epoch means nobody has claimed this card, and there is no
  // tenure to amend. Not an error worth dressing up — the Cards tab knows.
  if (!epoch) return { error: "no epoch" };

  if (fields.name !== undefined) {
    const name = cleanText(fields.name, 18);
    if (isReservedKeeperName(name)) return { error: "reserved name" };
    await env.DB.prepare(`UPDATE card_epochs SET keeper_name = ?1 WHERE id = ?2`)
      .bind(name, epoch.id)
      .run();
  }
  if (fields.lang !== undefined) {
    const lang = fields.lang === "zh-Hant" ? "zh-Hant" : "en";
    await env.DB.prepare(`UPDATE card_epochs SET lang = ?1 WHERE id = ?2`)
      .bind(lang, epoch.id)
      .run();
  }
  return { ok: true };
}

/**
 * Remove a card entirely — and only when that costs nothing.
 *
 * ══ WHY THIS REFUSES MORE THAN IT ACCEPTS ══
 * `card_epochs.card_id` is ON DELETE CASCADE and `ducks.epoch_id` is ON
 * DELETE SET NULL, so deleting a card with any history silently strips
 * every duck that came off it of its keeper — "via Sam" gone, for ducks
 * belonging to people who never asked. `ducks.card_id` has no on-delete
 * rule at all, so it either errors or dangles depending on whether keys
 * are being enforced.
 *
 * And it cannot be undone by adding the serial back: the epochs are gone,
 * and `claim_counter` returns to 0, which makes a counter the server
 * already retired acceptable again — a replay window opened by a cleanup.
 *
 * So this deletes only a card that has never been used: no ducks, no
 * epochs. A mis-provisioned or bench card. Anything else is `disabled`,
 * which is reversible and costs nobody their provenance.
 */
export async function deleteCard(
  env: Env,
  cardId: string,
): Promise<{ ok: true } | { error: "in use" }> {
  const used = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM ducks WHERE card_id = ?1)
          + (SELECT COUNT(*) FROM card_epochs WHERE card_id = ?1) AS n`,
  )
    .bind(cardId)
    .first<{ n: number }>();
  if (Number(used?.n ?? 0) > 0) return { error: "in use" };

  await env.DB.prepare(`DELETE FROM cards WHERE id = ?1`).bind(cardId).run();
  return { ok: true };
}

/**
 * Make a card new again — the safe half.
 *
 * ══ THREE OPERATIONS, NOT ONE BUTTON ══
 * "Reset this card" sounds like one thing and is three, with very
 * different consequences, so they are three:
 *
 *   resetKeeper   ends the tenure. The card is claimable again. Every
 *                 duck stays exactly where it is and keeps its `via`,
 *                 because it WAS from that keeper's card and rewriting
 *                 that is a lie about the past rather than a tidy-up.
 *   unlinkDucks   detaches the ducks from every tenure. They stay in the
 *                 pond, lose the `via`, and — because `card_id` is kept —
 *                 become adoptable again by whoever keeps the card next.
 *   attachDuck    the inverse, for a duck that never got a card at all.
 *
 * None of them deletes anything. The destructive one is separate, below,
 * and goes through the ordinary delete path so the deletion promise
 * holds.
 */
export async function resetKeeper(env: Env, cardId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE card_epochs SET ended = ?1 WHERE card_id = ?2 AND ended IS NULL`,
  )
    .bind(nowSec(), cardId)
    .run();
  return Boolean(res.meta.changes);
}

export async function unlinkDucks(env: Env, cardId: string): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE ducks SET epoch_id = NULL WHERE card_id = ?1 AND epoch_id IS NOT NULL`,
  )
    .bind(cardId)
    .run();
  return Number(res.meta.changes ?? 0);
}

/**
 * Attach a duck to the card that made it.
 *
 * ══ WHY THIS HAS TO EXIST ══
 * Ducks made before cards registered themselves hold `card_id = NULL` —
 * `mintSession` stores NULL for a serial it has never heard of, because
 * `sessions.card_id` is a foreign key and `?c=` is typed text. Two real
 * ducks in the pond are in that state and auto-registration cannot repair
 * them, because their rows were written before it existed.
 *
 * `epoch_id` is deliberately NOT set here. Which tenure a duck belongs to
 * is a question about consent, and the keeper answers it by adopting.
 * Admin only says which card it came off.
 */
export async function attachDuck(
  env: Env,
  duckId: string,
  cardId: string,
): Promise<{ ok: true } | { error: "unknown card" | "unknown duck" }> {
  const card = await env.DB.prepare(`SELECT id FROM cards WHERE id = ?1`)
    .bind(cardId)
    .first<{ id: string }>();
  if (!card) return { error: "unknown card" };

  const res = await env.DB.prepare(`UPDATE ducks SET card_id = ?1 WHERE id = ?2`)
    .bind(cardId, duckId)
    .run();
  return res.meta.changes ? { ok: true } : { error: "unknown duck" };
}

/**
 * Delete every duck from a card. The destructive one.
 *
 * ══ THE DELETION PROMISE IS NOT NEGOTIABLE ══
 * One `DELETE FROM ducks` so the `ducks_before_delete` trigger fires for
 * every row — contacts, fires, says, reports and bumps go with them, and
 * the references that would otherwise pin the rows are released. A bulk
 * path that reached around the trigger would be the one way this product
 * can break a promise it makes in writing.
 *
 * The card row itself survives. It is a physical object and still exists.
 */
export async function deleteCardDucks(env: Env, cardId: string): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM ducks WHERE card_id = ?1`)
    .bind(cardId)
    .run();
  return Number(res.meta.changes ?? 0);
}

/**
 * Remove one duck.
 *
 * ══ HIDE IS FOR MODERATION; THIS IS FOR REMOVAL ══
 * `setHidden` exists because almost everything admin does to somebody
 * else's duck should be one tap back. This is the other case: a test
 * duck, a duplicate, a person who asked in a message rather than through
 * their own private link. Hiding those leaves them in the pond forever,
 * invisible and counted.
 *
 * One `DELETE FROM ducks`, so `ducks_before_delete` fires and the
 * contact, the fires, the says, the reports and the bumps go with it —
 * the same path "Take my duck out" uses. There is no second way to remove
 * a duck in this product and there must not be, because the deletion
 * promise is made in writing on the contact screen.
 */
export async function deleteDuckAsAdmin(env: Env, duckId: string): Promise<boolean> {
  const res = await env.DB.prepare(`DELETE FROM ducks WHERE id = ?1`).bind(duckId).run();
  return Boolean(res.meta.changes);
}

/** Clear the open reports on a duck once it has been dealt with. */
export async function resolveReports(env: Env, duckId: string): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE reports SET resolved = 1 WHERE duck_id = ?1 AND resolved = 0`,
  )
    .bind(duckId)
    .run();
  return res.meta.changes;
}

/**
 * Contacts as CSV.
 *
 * Generated on demand, never synced. BUILD-PLAN is explicit about why: a
 * spreadsheet drifts out of step with a deleted contact, and "take my duck
 * out" has to mean it everywhere, including in whatever David exported last
 * month. A file downloaded today is honest about being a snapshot; a synced
 * sheet quietly is not.
 */
export function contactsCsv(ducks: AdminDuck[]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = ducks
    .filter((d) => d.contact)
    .map((d) =>
      [
        d.name, d.contact ?? "", d.scope ?? "", d.message,
        new Date(d.created * 1000).toISOString().slice(0, 10),
        d.keeper ?? "",
        d.replied ? new Date(d.replied * 1000).toISOString().slice(0, 10) : "",
        d.postcard ? new Date(d.postcard * 1000).toISOString().slice(0, 10) : "",
      ]
        .map((v) => escape(String(v)))
        .join(","),
    );
  return ["name,contact,scope,message,released,via,replied,postcard", ...rows].join("\n");
}

/** Everything the admin screen renders, in one request. */
export async function adminState(env: Env): Promise<Response> {
  const [ducks, cards] = await Promise.all([adminDucks(env), adminCards(env)]);
  /*
   * ══ A MISSING KEY IS SILENT, AND IT STOPS EVERYTHING ══
   * Every card identifies itself with an HMAC over its serial and counter,
   * signed with CARD_SECRET. Without a correctly shaped key on the server
   * NOTHING verifies: no card registers, no duck gets provenance, no card
   * can be claimed or kept — and none of it errors. The pond keeps
   * working, cards simply stop being cards.
   *
   * That is the worst shape a misconfiguration can take, so admin says so
   * rather than leaving David to infer it from an empty Cards tab. Only
   * whether it is the right SHAPE — the key itself never leaves here.
   */
  const secret = process.env.CARD_SECRET ?? "";
  return json({
    ducks,
    cards,
    cardSecret: /^[0-9a-fA-F]{32}$/.test(secret),
    now: nowSec(),
  });
}
