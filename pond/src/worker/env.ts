/**
 * Building an `Env` from the process environment, once per warm instance.
 *
 * ══ THE CONNECTION IS CACHED AT MODULE SCOPE, AND NEVER CLOSED ══
 * A serverless function is not a script. The module is evaluated once and
 * then reused across many invocations, so a client created per request
 * would open a connection per request and a `close()` in a finally block
 * would tear down the one the next invocation was about to use. Module
 * scope is the correct lifetime here; the platform reclaims it when it
 * reclaims the instance.
 *
 * The promise, not the client, is what is cached — otherwise two requests
 * arriving during a cold start both begin connecting and one of them wins a
 * race for no reason.
 */

import { connect } from "../db/libsql.js";
import type { Db } from "../db/types.js";
import type { Env } from "./types.js";

let connecting: Promise<Db> | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Loud and specific. A missing secret that produces a generic 500 costs
    // an hour of looking in the wrong place.
    throw new Error(`${name} is not set. See docs/pond/HOSTING.md § 4.`);
  }
  return value;
}

/**
 * Turn a connection failure into something a person can act on.
 *
 * These run at a bench, with a card in hand, from a shell where the
 * likeliest mistake by far is a mistyped or expired token — and libSQL
 * reports that as a bare `SERVER_ERROR: HTTP status 400` on top of a
 * fifteen-line stack trace, which names neither the cause nor the fix.
 */
export function explainConnectionFailure(url: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const token = process.env.TURSO_TOKEN ?? "";

  // 400 is what Turso returns for a MALFORMED token, which is the common
  // case here — 401/403 are for a well-formed one that has been revoked.
  // The first version of this checked only 401/403 and therefore stayed
  // silent on the exact mistake it was written for.
  if (/\b40[0-3]\b/.test(message) || /auth|token/i.test(message)) {
    const looksLikePlaceholder = /[<>]/.test(token) || token.trim() === "";
    return [
      `Turso refused the connection to ${url.replace(/\?.*$/, "")}.`,
      "",
      looksLikePlaceholder
        ? "TURSO_TOKEN is empty or still a placeholder — the shell pasted the" +
          "\n  angle brackets rather than a token."
        : "TURSO_TOKEN was rejected. It may have been invalidated.",
      "",
      "  Let the shell fetch it, so there is nothing to paste:",
      "",
      '    TURSO_TOKEN="$(turso db tokens create pond)" \\',
      "      npm run <the command you just ran>",
      "",
    ].join("\n");
  }

  if (/ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
    return `Could not reach ${url}. Check the URL and the network.`;
  }

  return message;
}

export function db(): Promise<Db> {
  if (!connecting) {
    const url = required("TURSO_URL");
    // A file: URL needs no token, and local work should not have to invent
    // one. A libsql:// URL without a token will fail at the first query,
    // which is soon enough and clearer than a guess here.
    connecting = connect(url, process.env.TURSO_TOKEN).catch((err) => {
      // Do not cache a failed connection: the next request should try
      // again rather than inherit a dead promise for the life of the
      // instance.
      connecting = null;
      throw err;
    });
  }
  return connecting;
}

export async function loadEnv(): Promise<Env> {
  return {
    DB: await db(),
    SESSION_SECRET: required("SESSION_SECRET"),
    ADMIN_PASSWORD: required("ADMIN_PASSWORD"),
  };
}

/**
 * Wrap a handler so a thrown error becomes a 500 rather than a platform
 * stack trace. The message is logged, never sent — a missing-secret message
 * names the secret.
 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    console.error("[pond]", err);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
