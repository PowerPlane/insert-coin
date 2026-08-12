/**
 * Sessions — turning a tap into a ticket.
 *
 * The card's `?d=` digit is only live for NDEF_EXPIRY_SECONDS (300 s) before
 * the MCU resets it to '0'. Decorating a duck takes minutes. So freshness is
 * checked exactly ONCE, on the first request, and exchanged for a session.
 * Nothing downstream ever reads the digit again.
 *
 * This is the single most important decision in the app: check late and
 * every duck dies on the submit button.
 */

import type { Env } from "./types";
import { nowSec, randomId, timingSafeEqual } from "./util";

export const SESSION_COOKIE = "pond_s";
export const SESSION_TTL_SEC = 30 * 60;

export interface Session {
  id: string;
  cardId: string | null;
  fortune: number;
  nonce: string | null;
  expires: number;
  spentDuck: string | null;
}

/** HMAC-SHA256, hex. Used to sign cookies and to derive visitor hashes. */
export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A visitor identity that is stable per browser but is NOT a device
 * fingerprint and is NOT an IP address. It exists only so "waves" and
 * "rescues" can be counted once per person instead of once per tap.
 */
export async function visitorHash(env: Env, clientId: string): Promise<string> {
  return (await hmac(env.SESSION_SECRET, `v:${clientId}`)).slice(0, 32);
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.get("cookie");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A malformed percent-escape in ANY cookie — including one this app
      // never set — would otherwise throw and turn an ordinary request into
      // a 500. Ignore the bad value, keep the rest.
      out[name] = value;
    }
  }
  return out;
}

/** `<id>.<sig>` — the id is the DB key, the signature stops forgery. */
export async function signSessionCookie(env: Env, id: string): Promise<string> {
  return `${id}.${await hmac(env.SESSION_SECRET, `s:${id}`)}`;
}

export async function readSessionCookie(env: Env, req: Request): Promise<string | null> {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = await hmac(env.SESSION_SECRET, `s:${id}`);
  // Constant-time: a fast reject leaks which prefix was right.
  return timingSafeEqual(sig, expect) ? id : null;
}

export function sessionCookieHeader(value: string, maxAge = SESSION_TTL_SEC): string {
  // No Domain attribute: host-only, so it never leaks to another subdomain.
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/p",
    "HttpOnly",
    "Secure",
    "SameSite=Lax", // Lax, not Strict: the visitor arrives by a cross-site tap
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export async function loadSession(env: Env, id: string): Promise<Session | null> {
  const row = await env.DB.prepare(
    `SELECT id, card_id, fortune, nonce, expires, spent_duck
       FROM sessions WHERE id = ?1`,
  )
    .bind(id)
    .first<{
      id: string;
      card_id: string | null;
      fortune: number;
      nonce: string | null;
      expires: number;
      spent_duck: string | null;
    }>();
  if (!row) return null;
  if (row.expires < nowSec()) return null;
  return {
    id: row.id,
    cardId: row.card_id,
    fortune: row.fortune,
    nonce: row.nonce,
    expires: row.expires,
    spentDuck: row.spent_duck,
  };
}

export interface MintResult {
  session: Session;
  cookie: string;
}

/**
 * Exchange a fresh `?d=` for a session.
 *
 * Returns null when the digit is 0 or absent — that is the ordinary
 * "someone tapped a card with no coin in it" case, and it must produce a
 * read-only pond rather than an error.
 */
export async function mintSession(
  env: Env,
  opts: { digit: number; cardId: string | null; nonce: string | null },
): Promise<MintResult | null> {
  if (!Number.isInteger(opts.digit) || opts.digit < 1 || opts.digit > 4) return null;

  // `c=` comes off a physical card, but anyone can type one. An unknown id
  // is stored as NULL rather than passed through — `sessions.card_id` has a
  // foreign key, so a forged or typoed value would otherwise turn
  // /p?d=1&c=whatever into an unhandled database error.
  let cardId: string | null = null;
  if (opts.cardId) {
    const card = await env.DB.prepare(`SELECT id, disabled FROM cards WHERE id = ?1`)
      .bind(opts.cardId)
      .first<{ id: string; disabled: number }>();
    // A card that has been lost or is being abused can be switched off
    // without touching any duck already in the pond.
    if (card?.disabled) return null;
    cardId = card ? card.id : null;
  }

  // If the firmware supplies a nonce, one coin insert mints exactly one
  // session. INSERT on a (card_id, nonce) primary key is the whole check:
  // a replay collides and throws.
  if (opts.nonce && cardId) {
    try {
      await env.DB.prepare(
        `INSERT INTO nonces (card_id, nonce, used) VALUES (?1, ?2, ?3)`,
      )
        .bind(cardId, opts.nonce, nowSec())
        .run();
    } catch {
      return null; // already spent
    }
  }

  const id = randomId(24);
  const expires = nowSec() + SESSION_TTL_SEC;
  await env.DB.prepare(
    `INSERT INTO sessions (id, card_id, fortune, nonce, created, expires)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, cardId, opts.digit - 1, opts.nonce, nowSec(), expires)
    .run();

  return {
    session: { id, cardId, fortune: opts.digit - 1, nonce: opts.nonce, expires, spentDuck: null },
    cookie: sessionCookieHeader(await signSessionCookie(env, id)),
  };
}

/** Housekeeping. Cheap, and keeps the sessions table from growing forever. */
export async function sweepSessions(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires < ?1`)
    .bind(nowSec() - 86400)
    .run();
}
