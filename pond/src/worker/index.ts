/**
 * The Pond — Worker entry point.
 *
 * Route map lives in docs/pond/BUILD-PLAN.md. Two things are worth reading
 * before changing anything here:
 *
 *  1. `?d=` is checked exactly once (see session.ts) and never again.
 *  2. `?d=` is also FORGEABLE — anyone can type /p?d=1. It proves a fortune
 *     was requested, not that a coin was inserted. Everything that could be
 *     abused because of that is rate-limited per card and per visitor, and
 *     the honest threat model is in docs/pond/SECURITY.md.
 */

import { createDuck, deleteDuck, duckByEditKey, listPond, updateDuck, validateDuck } from "./ducks";
import { extinguish, maybeIgnite, say, wave } from "./social";
import {
  loadSession,
  mintSession,
  readSessionCookie,
  sweepSessions,
  visitorHash,
} from "./session";
import type { Env } from "./types";
import { badRequest, intParam, json, notFound, nowSec, randomId, safeToken } from "./util";

const VISITOR_COOKIE = "pond_v";

/** Applied to every response. */
function securityHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  // The edit link IS the credential, so it must never travel in a Referer
  // header to anything a duck's message happens to link to.
  h.set("referrer-policy", "no-referrer");
  h.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; " +
      "frame-ancestors 'none'",
  );
  return h;
}

/**
 * A stable-per-browser id used only to count waves and rescues once per
 * person. Not an IP, not a fingerprint; if it's cleared, the worst that
 * happens is someone can wave at the same duck twice.
 */
async function ensureVisitor(
  req: Request,
  env: Env,
): Promise<{ visitor: string; setCookie: string | null }> {
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)pond_v=([A-Za-z0-9]{8,64})/);
  if (match) return { visitor: await visitorHash(env, match[1]), setCookie: null };

  const raw = randomId(24);
  const setCookie = [
    `${VISITOR_COOKIE}=${raw}`,
    "Path=/p",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=31536000",
  ].join("; ");
  return { visitor: await visitorHash(env, raw), setCookie };
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!req.headers.get("content-type")?.includes("application/json")) return null;
  // A public write endpoint should not accept an unbounded body.
  const text = await req.text();
  if (text.length > 4096) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (!path.startsWith("/p")) return notFound();

    const { visitor, setCookie } = await ensureVisitor(req, env);
    const headers = securityHeaders();
    if (setCookie) headers.append("set-cookie", setCookie);

    // ── the app shell ───────────────────────────────────────────────────
    if (path === "/p") {
      const digit = intParam(url.searchParams.get("d"), 0, 4);
      const cardId = safeToken(url.searchParams.get("c"), 12);
      const nonce = safeToken(url.searchParams.get("n"), 32);

      // Freshness is converted to a session HERE and nowhere else. After
      // this point the digit is irrelevant, which is what lets someone
      // spend ten minutes decorating.
      if (digit && digit > 0) {
        const existing = await readSessionCookie(env, req);
        if (!existing || !(await loadSession(env, existing))) {
          const minted = await mintSession(env, { digit, cardId, nonce });
          if (minted) headers.append("set-cookie", minted.cookie);
        }
      }

      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      for (const [k, v] of headers) out.headers.append(k, v);
      return out;
    }

    // ── the private link ────────────────────────────────────────────────
    if (path.startsWith("/p/d/")) {
      // Never let a search engine index a bearer URL.
      headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      const res = await env.ASSETS.fetch(new Request(new URL("/p", url), req));
      const out = new Response(res.body, res);
      for (const [k, v] of headers) out.headers.append(k, v);
      return out;
    }

    // ── API ─────────────────────────────────────────────────────────────
    if (path === "/p/api/pond" && req.method === "GET") {
      const ducks = await listPond(env);
      return json({ ducks, now: nowSec() }, { headers });
    }

    if (path === "/p/api/session" && req.method === "GET") {
      const id = await readSessionCookie(env, req);
      const s = id ? await loadSession(env, id) : null;
      return json(
        s
          ? { active: true, fortune: s.fortune, spent: Boolean(s.spentDuck) }
          : { active: false },
        { headers },
      );
    }

    if (path === "/p/api/duck" && req.method === "POST") {
      const id = await readSessionCookie(env, req);
      const s = id ? await loadSession(env, id) : null;
      if (!s) return json({ error: "no session" }, { status: 401, headers });
      if (s.spentDuck) return json({ error: "already released" }, { status: 409, headers });

      const body = await readJson(req);
      if (!body) return badRequest("bad body");

      // The fortune comes from the SESSION, never from the client — the
      // browser can ask for a duck, it cannot choose which fortune it got.
      const checked = validateDuck({ ...(body as never), fortune: s.fortune });
      if ("error" in checked) return badRequest(checked.error);

      const made = await createDuck(env, s.id, s.cardId, checked);
      if ("error" in made) return json({ error: made.error }, { status: 409, headers });

      const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 120) : "";
      if (contact) {
        // Private. Separate table, separate statement, never joined by the
        // public read path.
        await env.DB.prepare(
          `INSERT INTO contacts (duck_id, value, created) VALUES (?1, ?2, ?3)`,
        )
          .bind(made.id, contact, nowSec())
          .run();
      }

      return json({ id: made.id, editKey: made.editKey }, { status: 201, headers });
    }

    if (path === "/p/api/wave" && req.method === "POST") {
      const body = await readJson(req);
      const duckId = typeof body?.id === "string" ? body.id : "";
      if (!/^[A-Za-z0-9]{6,16}$/.test(duckId)) return badRequest("bad id");
      const waves = await wave(env, duckId, visitor);
      return waves === null ? notFound() : json({ waves }, { headers });
    }

    if (path === "/p/api/say" && req.method === "POST") {
      const body = await readJson(req);
      const editKey = typeof body?.editKey === "string" ? body.editKey : "";
      const duck = await duckByEditKey(env, editKey);
      if (!duck) return json({ error: "unknown duck" }, { status: 403, headers });
      const result = await say(env, String(duck.id), body?.text);
      return result.ok
        ? json({ ok: true, text: result.text }, { headers })
        : json({ ok: false, retryAfter: result.retryAfter }, { status: 429, headers });
    }

    if (path.startsWith("/p/api/fire/") && path.endsWith("/out") && req.method === "POST") {
      const duckId = path.slice("/p/api/fire/".length, -"/out".length);
      if (!/^[A-Za-z0-9]{6,16}$/.test(duckId)) return badRequest("bad id");
      // Being late is not an error — animate the extinguish regardless.
      const r = await extinguish(env, duckId, visitor);
      return json({ ok: true, ...r }, { headers });
    }

    if (path.startsWith("/p/api/duck/")) {
      const editKey = path.slice("/p/api/duck/".length);
      const duck = await duckByEditKey(env, editKey);
      if (!duck) return notFound();

      if (req.method === "GET") return json({ duck }, { headers });

      if (req.method === "PATCH") {
        const body = await readJson(req);
        if (!body) return badRequest("bad body");
        const checked = validateDuck({ ...(body as never), fortune: Number(duck.fortune) });
        if ("error" in checked) return badRequest(checked.error);
        const ok = await updateDuck(env, editKey, checked);
        return ok ? json({ ok: true }, { headers }) : notFound();
      }

      if (req.method === "DELETE") {
        // Cascades to `contacts`. One action, everything gone.
        const ok = await deleteDuck(env, editKey);
        return ok ? json({ ok: true }, { headers }) : notFound();
      }
    }

    return notFound();
  },

  /** Housekeeping: light a fire now and then, sweep dead sessions. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await maybeIgnite(env);
    await sweepSessions(env);
  },
};
