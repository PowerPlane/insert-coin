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

import { connect } from "../db/libsql";
import type { Db } from "../db/types";
import type { Env } from "./types";

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
