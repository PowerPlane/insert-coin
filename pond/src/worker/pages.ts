/**
 * The three HTML routes.
 *
 * Kept apart from the API router because they are reached differently:
 * `/api/*` lands on a catch-all by filename, so it sees the real path,
 * while `/`, `/d/<slug>` and `/e/<key>` are rewrites in `vercel.json` that
 * pass what they matched as a query parameter. Nothing here reads
 * `url.pathname` for that reason — a rewrite's destination is not the path
 * the visitor typed, and depending on which it is would be a bug that only
 * shows up in production.
 */

import { duckBySlug } from "./ducks.js";
import { ensureVisitor, mintFromQuery, securityHeaders } from "./index.js";
import { duckShell, editShell, pickLanguage, pondShell } from "./shell.js";
import type { Env } from "./types.js";

function html(body: string, headers: Headers, status = 200): Response {
  headers.set("content-type", "text/html; charset=utf-8");
  // The shell carries a session cookie and, on /d/, a duck's current words.
  // Neither is cacheable by anything shared.
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(body, { status, headers });
}

/** The keeper's chosen default for the card that was tapped, if any. */
async function keeperLanguage(env: Env, cardId: string | null): Promise<string | null> {
  if (!cardId) return null;
  const row = await env.DB.prepare(
    `SELECT lang FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
  )
    .bind(cardId)
    .first<{ lang: string }>();
  return row?.lang ?? null;
}

/**
 * `/` — the pond.
 *
 * The one route that must be a function rather than a static file: this is
 * where a tap becomes a session, exactly once, before anyone starts
 * decorating.
 */
export async function pondPage(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const { visitor, setCookie } = await ensureVisitor(req, env);
  const headers = securityHeaders();
  if (setCookie) headers.append("set-cookie", setCookie);

  const session = await mintFromQuery(req, env, url, visitor);
  if (session) headers.append("set-cookie", session);

  const lang = pickLanguage(
    req.headers.get("accept-language"),
    await keeperLanguage(env, url.searchParams.get("c")),
  );
  return html(pondShell(lang, {}), headers);
}

/**
 * `/d/<slug>` — a duck's public page, server-rendered for link previews.
 *
 * Public on purpose and indexable on purpose. The slug is an address, not a
 * credential; there is nothing here that visiting the pond would not show.
 */
export async function duckPage(req: Request, env: Env, slug: string): Promise<Response> {
  const headers = securityHeaders();
  const duck = await duckBySlug(env, slug);
  const lang = pickLanguage(req.headers.get("accept-language"));

  if (!duck) {
    // Still the shell, so a mistyped link lands in the pond rather than on
    // a dead end — but with the status that says so.
    return html(pondShell(lang, { missing: slug }), headers, 404);
  }

  const origin = new URL(req.url).origin;
  return html(duckShell(lang, duck, origin), headers);
}

/**
 * `/e/<key>` — the private edit page.
 *
 * The URL is the credential, so: never indexed, never in a Referer, and
 * nothing about the duck baked into the document. The client fetches it
 * with the key over the API instead.
 */
export async function editPage(req: Request, env: Env, key: string): Promise<Response> {
  const headers = securityHeaders();
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  const lang = pickLanguage(req.headers.get("accept-language"));
  // Not validated against the database here on purpose: a wrong key should
  // look exactly like a right one until the API says otherwise, so this
  // page cannot be used to test keys.
  return html(editShell(lang, key), headers);
}
