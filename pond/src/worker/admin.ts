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
import { json, nowSec, timingSafeEqual } from "./util.js";

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
  reports: number;
  contact: string | null;
  scope: string | null;
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
export async function adminDucks(env: Env): Promise<AdminDuck[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.slug, d.name, d.message, d.created, d.hidden, d.fortune,
            d.card_id AS card,
            (SELECT e.keeper_name FROM card_epochs e WHERE e.id = d.epoch_id) AS keeper,
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
    card: r.card ? String(r.card) : null,
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
}

export async function adminCards(env: Env): Promise<AdminCard[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.label, c.created, c.disabled,
            e.keeper_name AS keeper, e.lang,
            (SELECT COUNT(*) FROM ducks d WHERE d.card_id = c.id) AS ducks
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
  return json({ ducks, cards, now: nowSec() });
}
