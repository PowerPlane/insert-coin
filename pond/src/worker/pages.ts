// ABOUTME: Renders Pond HTML routes and exchanges NFC query data before the client starts.
// ABOUTME: Applies visitor identity, language, and private-route metadata to each page shell.

/**
 * The three HTML routes.
 *
 * Kept apart from the API router, though both arrive the same way: EVERY
 * route here is a rewrite in `vercel.json`, and a rewritten request carries
 * its DESTINATION path rather than the one the visitor typed. So `/`,
 * `/d/<slug>` and `/e/<key>` pass what they matched as a query parameter,
 * and nothing in this file reads `url.pathname` — depending on it would be
 * a bug that only appears in production.
 *
 * (This used to claim `/api/*` was a filename catch-all that saw the real
 * path. It was, once, and it silently swallowed every path with more than
 * one segment; `api/router.ts` tells that story at length. The comment
 * outlived the fact by several months.)
 */

import { duckBySlug } from "./ducks.js";
import { ensureVisitor, mintFromQuery, securityHeaders } from "./index.js";
import { adminShell, duckShell, editShell, pickLanguage, pondShell } from "./shell.js";
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
  const { visitor, setCookie } = await ensureVisitor(req);
  const headers = securityHeaders();
  if (setCookie) headers.append("set-cookie", setCookie);

  const { cookie, card } = await mintFromQuery(req, env, url, visitor);
  if (cookie) headers.append("set-cookie", cookie);

  /*
   * The keeper's default language comes from the card that was TAPPED, and
   * `card` is the serial only once its signature has been checked.
   *
   * It used to be `url.searchParams.get("c")` — the raw query string, not
   * even through `safeToken`. Typing a serial somebody had once seen was
   * enough to pick the language this page rendered in. Small on its own,
   * and the same mistake as binding the session to an unchecked serial;
   * both are fixed by there being one checked value to reach for.
   */
  const lang = pickLanguage(
    req.headers.get("accept-language"),
    await keeperLanguage(env, card),
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

/**
 * `/pondkeeper` — the admin.
 *
 * Never indexed, and the noindex is set here as well as in vercel.json.
 * Belt and braces on the one header whose absence cannot be noticed until
 * the page is already in a search index.
 */
export async function adminPage(req: Request, _env: Env): Promise<Response> {
  const headers = securityHeaders();
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  const lang = pickLanguage(req.headers.get("accept-language"));
  // The admin stays English — one reader, and it is David. COPY.md § 09.
  void lang;
  return html(adminShell(), headers);
}
