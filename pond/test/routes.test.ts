/**
 * The whole flow, through the real routes, against a real database.
 *
 * ══ WHY THIS FILE IS THE POINT OF PHASE 1B ══
 * Phase 1b is done when `curl /api/pond` returns JSON *and* a deployed
 * delete-a-duck test shows the contact row gone. The deployed half needs a
 * database and a domain that do not exist yet; this is the half that can be
 * proved now, and it is the more useful half, because it runs on every
 * change instead of once.
 *
 * It drives `handle()` and the page handlers with constructed `Request`
 * objects and a cookie jar, so it exercises the things unit tests miss:
 * that the tap actually becomes a cookie, that the cookie actually carries
 * a fortune to the release, that the release actually writes the contact,
 * and that DELETE actually takes it away again.
 *
 * The nine screens in Phase 3 are built against exactly these responses.
 */

import { afterEach, describe, expect, it } from "vitest";
import { handle } from "../src/worker/index";
import { duckPage, editPage, pondPage } from "../src/worker/pages";
import { MINT_PER_VISITOR } from "../src/worker/limits";
import { BUMP_UNRETURNED_CAP } from "../src/worker/social";
import type { Db } from "../src/db/types";
import type { Env } from "../src/worker/types";
import { count, fresh, makeCard } from "./helpers";

let open: Db | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

const ORIGIN = "https://ducky.davidyang.work";

async function env(): Promise<Env> {
  const db = (open = await fresh());
  return { DB: db, SESSION_SECRET: "test-secret", ADMIN_PASSWORD: "test-admin" };
}

/**
 * A browser, more or less: it keeps its cookies.
 *
 * Without this the test would be checking that each endpoint works in
 * isolation, which is not the thing that breaks. What breaks is the seam —
 * a cookie set with the wrong path, a session read before it is written.
 */
class Visitor {
  private jar = new Map<string, string>();

  constructor(private readonly e: Env) {}

  private absorb(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (pair && eq > 0) this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return { ...(cookie ? { cookie } : {}), ...extra };
  }

  /** Tap a card: the one request that turns `?d=` into a session. */
  async tap(query = "?d=1"): Promise<Response> {
    const res = await pondPage(
      new Request(`${ORIGIN}/${query}`, { headers: this.headers() }),
      this.e,
    );
    this.absorb(res);
    return res;
  }

  async api(path: string, init: RequestInit = {}): Promise<Response> {
    const body = init.body;
    const res = await handle(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: this.headers(body ? { "content-type": "application/json" } : {}),
      }),
      this.e,
    );
    this.absorb(res);
    return res;
  }

  post(path: string, body: unknown): Promise<Response> {
    return this.api(path, { method: "POST", body: JSON.stringify(body) });
  }

  async json<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.api(path, init)).json()) as T;
  }
}

interface Released {
  id: string;
  slug: string;
  editKey: string;
}

/** Tap, decorate, release. The happy path, in three lines. */
async function release(
  v: Visitor,
  extra: Record<string, unknown> = {},
  query = "?d=1",
): Promise<Released> {
  await v.tap(query);
  const res = await v.post("/api/duck", {
    tint: 3,
    stickers: [{ id: "tophat", x: 4, y: 2 }],
    paint: "",
    name: "Sam",
    message: "found this card at the bar",
    ...extra,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Released;
}

describe("GET /api/pond", () => {
  it("returns JSON — the phase's own done-when, minus the deploy", async () => {
    const e = await env();
    const res = await handle(new Request(`${ORIGIN}/api/pond`), e);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { ducks: unknown[]; now: number };
    expect(body.ducks).toEqual([]);
    expect(body.now).toBeGreaterThan(0);
  });

  it("carries the keeper's name and never the card serial", async () => {
    const e = await env();
    const { card } = await makeCard(e.DB, { keeper: "Sam" });
    const v = new Visitor(e);
    await release(v, {}, `?d=2&c=${card}`);

    const raw = await (await handle(new Request(`${ORIGIN}/api/pond`), e)).text();
    expect(raw).toContain('"keeper":"Sam"');
    // The serial is half of what a card claim is keyed on. It must not
    // appear anywhere in a public response, under any key.
    expect(raw).not.toContain(card);
  });
});

describe("a tap becomes a session, exactly once", () => {
  it("mints on ?d= and reports the fortune it dealt", async () => {
    const e = await env();
    const v = new Visitor(e);
    await v.tap("?d=3");

    const s = await v.json<{ active: boolean; fortune: number; spent: boolean }>("/api/session");
    expect(s.active).toBe(true);
    // ?d=3 is the third fortune, stored zero-based.
    expect(s.fortune).toBe(2);
    expect(s.spent).toBe(false);
  });

  it("does not deal a second fortune to someone already holding one", async () => {
    const e = await env();
    const v = new Visitor(e);
    await v.tap("?d=1");
    await v.tap("?d=4"); // re-tap mid-decoration

    const s = await v.json<{ fortune: number }>("/api/session");
    expect(s.fortune).toBe(0); // still the first one
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM sessions`)).toBe(1);
  });

  it("gives a read-only pond to someone who just walked up", async () => {
    const e = await env();
    const v = new Visitor(e);
    await v.tap(""); // no ?d= at all

    expect(await v.json<{ active: boolean }>("/api/session")).toEqual({ active: false });
    const res = await v.post("/api/duck", { tint: 0, stickers: [], paint: "", name: "", message: "" });
    expect(res.status).toBe(401);
  });

  it("spends the session on release, so one tap is one duck", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v);

    expect((await v.json<{ spent: boolean }>("/api/session")).spent).toBe(true);
    const second = await v.post("/api/duck", {
      tint: 0, stickers: [], paint: "", name: "", message: "",
    });
    expect(second.status).toBe(409);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM ducks`)).toBe(1);
  });

  it("takes the fortune from the session, never from the client", async () => {
    const e = await env();
    const v = new Visitor(e);
    await v.tap("?d=1"); // 大吉
    const duck = await v.post("/api/duck", {
      tint: 0, stickers: [], paint: "", name: "", message: "",
      fortune: 3, // asking to be 凶, which is the one that catches fire
    });
    const { editKey } = (await duck.json()) as Released;

    const mine = await v.json<{ duck: { fortune: number } }>(`/api/duck/${editKey}`);
    expect(mine.duck.fortune).toBe(0);
  });
});

describe("the deletion promise, over HTTP", () => {
  it("DELETE takes the duck and the contact together", async () => {
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com" });

    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(1);

    const res = await v.api(`/api/duck/${editKey}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    // The whole reason this project has a database adapter.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(0);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1`, id)).toBe(0);
  });

  it("stores a contact only when one was given", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v, { contact: "   " }); // whitespace is not a contact
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts`)).toBe(0);
  });

  it("records the scope that was actually consented to", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v, { contact: "sam@example.com", scope: "keeper" });
    const row = await e.DB.prepare(`SELECT scope FROM contacts`).first<{ scope: string }>();
    expect(row?.scope).toBe("keeper");
  });

  it("falls back to the stated default when asked for a scope that isn't one", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v, { contact: "sam@example.com", scope: "everyone" });
    const row = await e.DB.prepare(`SELECT scope FROM contacts`).first<{ scope: string }>();
    expect(row?.scope).toBe("david");
  });

  /**
   * The default has to be the sentence on the screen.
   *
   * The contact screen asks "Want David to reply?" and answers "Only David
   * sees this." Someone who never opens a scope picker has agreed to that
   * and nothing wider — so a default of `keeper_and_david` would share it
   * with a person the screen never named.
   */
  it("stores only what the screen promised when nobody picked a scope", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v, { contact: "sam@example.com" });
    const row = await e.DB.prepare(`SELECT scope FROM contacts`).first<{ scope: string }>();
    expect(row?.scope).toBe("david");
  });
});

describe("bumps", () => {
  async function twoDucks(e: Env): Promise<[Released, Released]> {
    const a = await release(new Visitor(e), {}, "?d=1");
    const b = await release(new Visitor(e), {}, "?d=2");
    return [a, b];
  }

  it("needs a duck of your own", async () => {
    const e = await env();
    const [a] = await twoDucks(e);
    const stranger = new Visitor(e);
    const res = await stranger.post("/api/bump", { id: a.id });
    expect(res.status).toBe(403);
  });

  it("counts, and shows up in the pond", async () => {
    const e = await env();
    const [a, b] = await twoDucks(e);
    const v = new Visitor(e);

    const res = await v.post("/api/bump", { id: a.id, editKey: b.editKey });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, bumps: 1, unreturned: 1 });

    const pond = await v.json<{ ducks: { id: string; bumps: number }[] }>("/api/pond");
    expect(pond.ducks.find((d) => d.id === a.id)?.bumps).toBe(1);
  });

  it("stops at ten unreturned, and a bump back frees a slot", async () => {
    const e = await env();
    const [a, b] = await twoDucks(e);
    const v = new Visitor(e);

    for (let i = 0; i < BUMP_UNRETURNED_CAP; i++) {
      expect((await v.post("/api/bump", { id: a.id, editKey: b.editKey })).status).toBe(200);
    }
    const capped = await v.post("/api/bump", { id: a.id, editKey: b.editKey });
    expect(capped.status).toBe(409);
    expect(await capped.json()).toMatchObject({ reason: "capped" });

    // a bumps back once — now b has room again. This is the poke dynamic:
    // the cap is a nudge toward reciprocity, not a wall.
    await v.post("/api/bump", { id: b.id, editKey: a.editKey });
    expect((await v.post("/api/bump", { id: a.id, editKey: b.editKey })).status).toBe(200);
  });

  it("will not let a duck bump itself for a number", async () => {
    const e = await env();
    const [a] = await twoDucks(e);
    const res = await new Visitor(e).post("/api/bump", { id: a.id, editKey: a.editKey });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "self" });
  });

  it("ranks who bumped a duck most, for the duck card", async () => {
    const e = await env();
    const [target, one] = await twoDucks(e);
    const two = await release(new Visitor(e), {}, "?d=3");
    const v = new Visitor(e);

    await v.post("/api/bump", { id: target.id, editKey: one.editKey });
    await v.post("/api/bump", { id: target.id, editKey: one.editKey });
    await v.post("/api/bump", { id: target.id, editKey: two.editKey });

    const page = await v.json<{ bumpers: { slug: string; count: number }[] }>(
      `/api/duck/by-slug/${target.slug}`,
    );
    expect(page.bumpers[0]).toMatchObject({ slug: one.slug, count: 2 });
    expect(page.bumpers[1]).toMatchObject({ slug: two.slug, count: 1 });
  });
});

describe("reports", () => {
  it("records the reason and the note", async () => {
    const e = await env();
    const duck = await release(new Visitor(e));
    const v = new Visitor(e);

    const res = await v.post("/api/report", {
      id: duck.id,
      reason: "private",
      note: "that is my phone number",
    });
    expect(res.status).toBe(200);

    const row = await e.DB.prepare(`SELECT reason, note FROM reports`).first<{
      reason: string;
      note: string;
    }>();
    expect(row).toMatchObject({ reason: "private", note: "that is my phone number" });
  });

  it("is idempotent — reporting twice is the same report", async () => {
    const e = await env();
    const duck = await release(new Visitor(e));
    const v = new Visitor(e);

    expect(await (await v.post("/api/report", { id: duck.id, reason: "spam" })).json())
      .toMatchObject({ filed: true });
    // Same visitor, same duck: no error, no second row.
    expect(await (await v.post("/api/report", { id: duck.id, reason: "rude" })).json())
      .toMatchObject({ filed: false });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM reports`)).toBe(1);
  });

  it("refuses a reason that is not one of the four buttons", async () => {
    const e = await env();
    const duck = await release(new Visitor(e));
    const res = await new Visitor(e).post("/api/report", { id: duck.id, reason: "because" });
    expect(res.status).toBe(400);
  });
});

describe("rate limits", () => {
  it("stops one browser minting sessions all day", async () => {
    const e = await env();
    const v = new Visitor(e);

    for (let i = 0; i < MINT_PER_VISITOR; i++) {
      await v.tap("?d=1");
      // Spend it, so the next tap is allowed to mint rather than reusing.
      await e.DB.prepare(`UPDATE sessions SET expires = 0`).run();
    }
    await v.tap("?d=1");

    // The eleventh tap produced nothing, and looks exactly like walking up
    // to a card with no coin in it — which is the only honest thing to show.
    expect(await v.json<{ active: boolean }>("/api/session")).toEqual({ active: false });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM sessions`)).toBe(MINT_PER_VISITOR);
  });
});

describe("the HTML routes", () => {
  it("/ serves a document with a language and a bootstrap", async () => {
    const e = await env();
    const res = await pondPage(new Request(`${ORIGIN}/`), e);
    const html = await res.text();

    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('id="pond-bootstrap"');
  });

  it("/ speaks 繁體中文 to a phone that asks for it", async () => {
    const e = await env();
    const res = await pondPage(
      new Request(`${ORIGIN}/`, { headers: { "accept-language": "zh-TW,zh;q=0.9" } }),
      e,
    );
    // Getting this wrong shows a Chinese reader Japanese letterforms.
    expect(await res.text()).toContain('<html lang="zh-Hant">');
  });

  it("/ serves simplified-Chinese readers English rather than the wrong script", async () => {
    const e = await env();
    const res = await pondPage(
      new Request(`${ORIGIN}/`, { headers: { "accept-language": "zh-CN,zh;q=0.9" } }),
      e,
    );
    expect(await res.text()).toContain('<html lang="en">');
  });

  it("/d/<slug> renders the duck's own words for a link preview", async () => {
    const e = await env();
    const duck = await release(new Visitor(e));
    const res = await duckPage(new Request(`${ORIGIN}/d/${duck.slug}`), e, duck.slug);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<meta property="og:title" content="Sam · the pond">');
    expect(html).toContain('content="found this card at the bar"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/d/${duck.slug}">`);
    // Public on purpose: a duck you cannot share is not worth making.
    expect(html).not.toContain("noindex");
  });

  it("/d/<slug> escapes a duck's message rather than trusting it", async () => {
    const e = await env();
    const v = new Visitor(e);
    const duck = await release(v, { message: `"><script>alert(1)</script>` });
    const html = await (await duckPage(new Request(`${ORIGIN}/`), e, duck.slug)).text();

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("/d/<unknown> is a 404 that still lands you in the pond", async () => {
    const e = await env();
    const res = await duckPage(new Request(`${ORIGIN}/d/nobody-here`), e, "nobody-here");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('id="pond-bootstrap"');
  });

  it("/e/<key> is noindex and gives away nothing about the duck", async () => {
    const e = await env();
    const v = new Visitor(e);
    const duck = await release(v, { contact: "sam@example.com" });
    const res = await editPage(new Request(`${ORIGIN}/e/${duck.editKey}`), e, duck.editKey);
    const html = await res.text();

    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(html).toContain("noindex, nofollow, noarchive");
    expect(html).not.toContain("sam@example.com");
    expect(html).not.toContain("found this card at the bar");
  });

  it("every response carries the headers that keep an edit key private", async () => {
    const e = await env();
    const res = await handle(new Request(`${ORIGIN}/api/pond`), e);
    // no-referrer is what stops /e/<key> travelling in a Referer header to
    // whatever a duck's message happens to link to.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
