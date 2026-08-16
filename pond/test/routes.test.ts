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
import { handle } from "../src/worker/index.js";
import { cardToken } from "../src/card/identity.js";
import { duckPage, editPage, pondPage } from "../src/worker/pages.js";
import { MINT_PER_VISITOR } from "../src/worker/limits.js";
import { BUMP_UNRETURNED_CAP } from "../src/worker/social.js";
import type { Db } from "../src/db/types.js";
import type { Env } from "../src/worker/types.js";
import { count, fresh, makeCard } from "./helpers.js";

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
    /*
     * The tap is SIGNED. It used to be `?d=2&c=${card}` — a bare serial —
     * and it worked, because the serial was bound to the session straight
     * off the query string. It is not any more: a card is only attached to
     * a session once `&t=` verifies, so a fixture that skips the signature
     * now produces a duck from no card and no keeper at all. See the
     * "a serial alone is not a card" suite below.
     */
    const secret = testSecret();
    await release(v, {}, `?d=2&c=${card}&g=0000&t=${cardToken(secret, card, 0)}`);

    const raw = await (await handle(new Request(`${ORIGIN}/api/pond`), e)).text();
    expect(raw).toContain('"keeper":"Sam"');
    // The serial is half of what a card claim is keyed on. It must not
    // appear anywhere in a public response, under any key.
    expect(raw).not.toContain(card);
  });
});

describe("the path the router dispatches on", () => {
  /**
   * On Vercel `/api/*` arrives through a rewrite, so `req.url` is the
   * DESTINATION (`/api/router?__path=duck/by-slug/x`), not what the visitor
   * typed. `api/router.ts` reassembles the real path and passes it in.
   *
   * This is the seam that made half the API unreachable on the first deploy,
   * so the override is tested rather than assumed.
   */
  it("comes from the argument when given one, not from the URL", async () => {
    const e = await env();
    const res = await handle(
      new Request(`${ORIGIN}/api/router?__path=pond`),
      e,
      "/api/pond",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ducks: [] });
  });

  it("falls back to the URL when no path is passed", async () => {
    const e = await env();
    const res = await handle(new Request(`${ORIGIN}/api/pond`), e);
    expect(res.status).toBe(200);
  });

  it("routes a multi-segment path — the one that 404'd in production", async () => {
    const e = await env();
    const duck = await release(new Visitor(e));
    const res = await handle(
      new Request(`${ORIGIN}/api/router?__path=duck/by-slug/${duck.slug}`),
      e,
      `/api/duck/by-slug/${duck.slug}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duck: { slug: duck.slug } });
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

  /*
   * ══ WITHDRAWING A CONTACT WITHOUT LOSING THE DUCK ══
   * The promise above `deleteDuck` is that somebody who leaves a phone
   * number on a stranger's website can withdraw it without emailing
   * anyone. Until this route existed that was only half true: the only way
   * to take back a number was to destroy the duck it came with.
   */
  it("DELETE /contact takes the contact and leaves the duck", async () => {
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com" });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(1);

    const res = await v.api(`/api/duck/${editKey}/contact`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(0);
    // The duck is the whole point: it stays, decorated, named, in the pond.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1`, id)).toBe(1);
  });

  it("answers a duck that never had a contact exactly the same way", async () => {
    /*
     * ══ THE RESPONSE IS NOT AN ORACLE ══
     * An earlier version returned `removed`, so the screen could say
     * "Gone" or "there was nothing to take back". That boolean is the
     * same fact this route refuses to serve over GET — "did this person
     * leave their number" — merely spent destructively, and a leaked
     * private link could still ask it once.
     *
     * Byte-for-byte identical, so there is nothing left to compare.
     */
    const e = await env();
    const v = new Visitor(e);
    const withOne = await release(v, { contact: "sam@example.com" });
    const v2 = new Visitor(e);
    const without = await release(v2, {});

    const a = await v.api(`/api/duck/${withOne.editKey}/contact`, { method: "DELETE" });
    const b = await v2.api(`/api/duck/${without.editKey}/contact`, { method: "DELETE" });

    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it("withdrawing twice is not an error", async () => {
    // The second tap of a button somebody is anxious about must not look
    // like a failure.
    const e = await env();
    const v = new Visitor(e);
    const { editKey } = await release(v, { contact: "sam@example.com" });

    const first = await v.api(`/api/duck/${editKey}/contact`, { method: "DELETE" });
    const again = await v.api(`/api/duck/${editKey}/contact`, { method: "DELETE" });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    // And the second says nothing the first did not.
    expect(await again.text()).toBe(await first.text());
  });

  it("refuses an edit key that names no duck", async () => {
    /*
     * Otherwise a guessed key would answer `removed: false` exactly as a
     * real duck with no contact does — and a 200 to a guess is a probe
     * that says "this key is not one of ours" for free.
     */
    const e = await env();
    const v = new Visitor(e);
    await release(v, { contact: "sam@example.com" });

    const res = await v.api(`/api/duck/${"z".repeat(32)}/contact`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("will not tell you whether a contact exists", async () => {
    /*
     * There is no GET. Asking is the leak: a private link that has been
     * pasted somewhere would otherwise answer "did this person leave their
     * number", which is smaller than the number itself and still something
     * nobody agreed to.
     */
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com" });

    expect((await v.api(`/api/duck/${editKey}/contact`)).status).toBe(404);
    expect((await v.api(`/api/duck/${editKey}/contact`, { method: "PATCH" })).status).toBe(404);
    // And nothing was disturbed by asking.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(1);
  });

  /*
   * ══ REPLACING A CONTACT, WITHOUT EVER SEEING IT ══
   * The settings screen offers an EMPTY field, always. You cannot read
   * what is there; you can only put something else in its place, or take
   * it out. These tests pin that shape, because the obvious "improvement"
   * — prefill it so people can edit — is the one change that would hand a
   * stranger's phone number to whoever holds a pasted private link.
   */
  it("PUT /contact replaces a contact without echoing the old one", async () => {
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com" });

    const res = await v.api(`/api/duck/${editKey}/contact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: "sam@newjob.example" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("sam@example.com");

    const row = await e.DB.prepare(`SELECT value, scope FROM contacts WHERE duck_id = ?1`)
      .bind(id).first<{ value: string; scope: string }>();
    expect(row?.value).toBe("sam@newjob.example");
    // One row, not two: the duck's contact was replaced, not accumulated.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, id)).toBe(1);
  });

  it("stores the narrowest scope, even over a wider one", async () => {
    /*
     * The contact screen can offer to share with the card's KEEPER,
     * because it runs inside a session that knows who that is. The
     * private-link screen has no session and no keeper to name, so it
     * cannot ask — and a screen that cannot ask must not assume. Editing
     * therefore narrows an existing wider consent rather than carrying it
     * silently forward.
     */
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com", scope: "keeper" });
    expect((await e.DB.prepare(`SELECT scope FROM contacts WHERE duck_id = ?1`)
      .bind(id).first<{ scope: string }>())?.scope).toBe("keeper");

    await v.api(`/api/duck/${editKey}/contact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: "sam@newjob.example" }),
    });
    expect((await e.DB.prepare(`SELECT scope FROM contacts WHERE duck_id = ?1`)
      .bind(id).first<{ scope: string }>())?.scope).toBe("david");
  });

  it("answers a first contact exactly as it answers a replacement", async () => {
    // Same argument as the DELETE: the response must not reveal whether
    // there was one there before.
    const e = await env();
    const withOne = new Visitor(e);
    const a = await release(withOne, { contact: "sam@example.com" });
    const without = new Visitor(e);
    const b = await release(without, {});

    const put = (v: Visitor, key: string) => v.api(`/api/duck/${key}/contact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: "new@example.com" }),
    });
    const ra = await put(withOne, a.editKey);
    const rb = await put(without, b.editKey);
    expect(ra.status).toBe(rb.status);
    expect(await ra.text()).toBe(await rb.text());
  });

  it("refuses a PUT with an edit key that names no duck", async () => {
    const e = await env();
    const v = new Visitor(e);
    await release(v, {});
    const res = await v.api(`/api/duck/${"z".repeat(32)}/contact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: "someone@example.com" }),
    });
    expect(res.status).toBe(404);
    // And nothing was written for a duck that does not exist.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM contacts`)).toBe(0);
  });

  it("refuses an empty contact rather than storing a blank one", async () => {
    // Empty means "leave it alone" on the screen. It must never reach the
    // database as a contact somebody can be written to at.
    const e = await env();
    const v = new Visitor(e);
    const { editKey, id } = await release(v, { contact: "sam@example.com" });
    const res = await v.api(`/api/duck/${editKey}/contact`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: "   " }),
    });
    expect(res.status).toBe(400);
    // The one that was there is untouched.
    expect((await e.DB.prepare(`SELECT value FROM contacts WHERE duck_id = ?1`)
      .bind(id).first<{ value: string }>())?.value).toBe("sam@example.com");
  });

  it("never returns the contact value on the owner's own read", async () => {
    // The private link is ownership, but it is also a string that gets
    // pasted into group chats. It buys editing, not a copy of the number.
    const e = await env();
    const v = new Visitor(e);
    const { editKey } = await release(v, { contact: "sam@example.com" });

    const body = await (await v.api(`/api/duck/${editKey}`)).text();
    expect(body).not.toContain("sam@example.com");
  });

it("every page can be added to an iPhone home screen", async () => {
    /*
     * Asked for as "minimise the Safari URL bar", which iOS gives no way
     * to do. Installed to the Home Screen there is no bar at all, which
     * is what the request was reaching for — and it hands the layout back
     * the chrome the screens were budgeted against.
     *
     * Checked on the rendered HTML rather than by reading shell.ts,
     * because the head is a template literal and a stray backtick in a
     * comment silently truncated it once already.
     */
    const e = await env();
    const html = await (await pondPage(
      new Request(`${ORIGIN}/`), e,
    )).text();

    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain("apple-mobile-web-app-title");
    /*
     * And deliberately NOT this one: Apple advises against it now, and it
     * can spoil the install when the manifest is what is being honoured.
     * Asserted so it cannot be added back as a well-meaning "fix".
     */
    expect(html).not.toContain('name="apple-mobile-web-app-capable"');
  });

  it("the pond never carries an edit key, now that the admin does", async () => {
    /*
     * The admin shows a duck's private link so somebody who lost theirs
     * can be given it back — a real need, with no account to recover
     * from. That makes `edit_key` selected in a second place, and the
     * only thing standing between "the admin can see it" and "everyone
     * can" is that the public read does not ask for it.
     *
     * So this checks the wire, not the intention: the whole pond
     * response, as bytes, must not contain the key.
     */
    const e = await env();
    const v = new Visitor(e);
    const { editKey } = await release(v, {});
    expect(editKey.length).toBeGreaterThan(16);

    const pond = await (await v.api("/api/pond")).text();
    expect(pond).not.toContain(editKey);

    // Nor the duck's own public page, which is the other unauthenticated
    // read and the one somebody would think to try.
    const bySlug = await (await v.api(`/api/duck/by-slug/${(await release(new Visitor(e), {})).slug}`)).text();
    expect(bySlug).not.toContain(editKey);
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

describe("every response carries the security headers, errors included", () => {
  /**
   * `securityHeaders()` is documented in index.ts as "applied to every
   * response", and it was not: `badRequest()` and `notFound()` built their
   * own responses from scratch, so every 400 and 404 went out with no CSP,
   * no `referrer-policy: no-referrer`, no frame protection — and dropped
   * the pending visitor `set-cookie` on the floor.
   *
   * A 404 is a perfectly good place to be handed a page that then leaks an
   * edit key in a Referer header, which is exactly what no-referrer exists
   * to prevent.
   */
  const REQUIRED = [
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "content-security-policy",
  ];

  it("on a 404 from an unknown route", async () => {
    const e = await env();
    const res = await handle(new Request(`${ORIGIN}/api/nothing`), e);
    expect(res.status).toBe(404);
    for (const h of REQUIRED) expect(res.headers.get(h), h).not.toBeNull();
  });

  it("on a 404 from a duck that is not there", async () => {
    const e = await env();
    const res = await handle(new Request(`${ORIGIN}/api/duck/by-slug/nope-nope`), e);
    expect(res.status).toBe(404);
    for (const h of REQUIRED) expect(res.headers.get(h), h).not.toBeNull();
  });

  it("on a 400 from a bad id, and it keeps the visitor cookie", async () => {
    const e = await env();
    const res = await handle(
      new Request(`${ORIGIN}/api/bump`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "!!" }),
      }),
      e,
    );
    expect(res.status).toBe(400);
    for (const h of REQUIRED) expect(res.headers.get(h), h).not.toBeNull();
    // The cookie was minted for this request and would have been lost.
    expect(res.headers.getSetCookie?.().some((c) => c.startsWith("pond_v="))).toBe(true);
  });
});

describe("the admin editing cards", () => {
  const signedIn = async (e: Env) => {
    const v = new Visitor(e);
    await v.api("/api/admin/in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "test-admin" }),
    });
    return v;
  };
  const post = (v: Visitor, path: string, body: unknown) =>
    v.api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("renames a card, and sets the current keeper without ending the epoch", async () => {
    /*
     * The point of the whole feature: find the card that made a duck and
     * put the right name on it, so future taps say "via Kariina".
     *
     * AMENDING the open epoch rather than ending it is the part that
     * matters. A contact's consent is tied to the epoch it was given
     * under — "shared with Sam" means Sam — so ending one to fix a
     * spelling would orphan consent that was given to a person who has
     * not changed.
     */
    const e = await env();
    await makeCard(e.DB, { card: "CARD0001" });
    const v = await signedIn(e);

    expect((await post(v, "/api/admin/card/label", { card: "CARD0001", label: "the one for Kariina" })).status).toBe(200);
    const before = await e.DB.prepare(`SELECT id FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`)
      .bind("CARD0001").first<{ id: string }>();

    expect((await post(v, "/api/admin/card/keeper", { card: "CARD0001", name: "Kariina", lang: "zh-Hant" })).status).toBe(200);

    const after = await e.DB.prepare(
      `SELECT id, keeper_name, lang, ended FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
    ).bind("CARD0001").first<{ id: string; keeper_name: string; lang: string; ended: number | null }>();
    expect(after?.keeper_name).toBe("Kariina");
    expect(after?.lang).toBe("zh-Hant");
    // The SAME epoch, still open. Not a new tenure.
    if (before) expect(after?.id).toBe(before.id);
    expect(after?.ended).toBeNull();
  });

  it("refuses a reserved keeper name here too", async () => {
    // The four-blow path already refuses these; an admin route that did
    // not would be a way around the guard rather than a second one.
    const e = await env();
    await makeCard(e.DB, { card: "CARD0002" });
    const v = await signedIn(e);
    const res = await post(v, "/api/admin/card/keeper", { card: "CARD0002", name: "admin" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "reserved name" });
  });

  it("switches a card off and on again", async () => {
    const e = await env();
    await makeCard(e.DB, { card: "CARD0003" });
    const v = await signedIn(e);
    await post(v, "/api/admin/card/disabled", { card: "CARD0003", disabled: true });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1 AND disabled = 1`, "CARD0003")).toBe(1);
    await post(v, "/api/admin/card/disabled", { card: "CARD0003", disabled: false });
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1 AND disabled = 0`, "CARD0003")).toBe(1);
  });

  it("will not delete a card that anything hangs off", async () => {
    /*
     * ══ THE REFUSAL IS THE FEATURE ══
     * `card_epochs.card_id` is ON DELETE CASCADE and `ducks.epoch_id` is
     * ON DELETE SET NULL, so deleting a used card strips every duck that
     * came off it of its keeper — for people who never asked. Adding the
     * serial back does not undo it: the epochs are gone and
     * `claim_counter` returns to 0, which makes a retired counter valid
     * again.
     */
    const e = await env();
    await makeCard(e.DB, { card: "CARD0004" });
    const v = await signedIn(e);

    const res = await post(v, "/api/admin/card/delete", { card: "CARD0004" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "in use" });
    // Still there, with its history.
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, "CARD0004")).toBe(1);
  });

  it("deletes a card that has never been used", async () => {
    // A mis-provisioned or bench card: no ducks, no epochs, nothing to
    // lose. This is the only case where delete costs nobody anything.
    const e = await env();
    await e.DB.prepare(`INSERT INTO cards (id, label, created) VALUES (?1, ?2, ?3)`)
      .bind("CARD0005", "flashed by mistake", 1786600000).run();
    const v = await signedIn(e);

    const res = await post(v, "/api/admin/card/delete", { card: "CARD0005" });
    expect(res.status).toBe(200);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, "CARD0005")).toBe(0);
  });

  it("lets nobody who is not signed in touch any of it", async () => {
    const e = await env();
    await makeCard(e.DB, { card: "CARD0006" });
    const v = new Visitor(e); // no sign-in
    for (const path of ["label", "disabled", "keeper", "delete"]) {
      const res = await post(v, `/api/admin/card/${path}`, { card: "CARD0006", name: "x" });
      expect(res.status, path).toBe(404);
    }
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, "CARD0006")).toBe(1);
  });
});



/**
 * The key the test server verifies with.
 *
 * `secret()` in keeper.ts reads `process.env.CARD_SECRET` and demands
 * exactly 32 hex characters, so the tests set the same one rather than
 * guessing at the shape.
 */
function testSecret(): Uint8Array {
  const hex = "0123456789abcdef0123456789abcdef";
  process.env.CARD_SECRET = hex;
  return new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
}

describe("a card introduces itself", () => {
  /*
   * ══ NO LIST TO KEEP ══
   * Cards used to be recorded by hand and the server refused any serial it
   * had not been told about. But a serial never travels alone: every tag
   * carries `&t=`, an HMAC over the serial and counter using CARD_SECRET,
   * written from the very first boot. The list was guarding a door the
   * signature already locks.
   */
  const tapUrl = (card: string, counter: number, token: string, digit = 1) =>
    `${ORIGIN}/?d=${digit}&c=${card}&g=${counter.toString(16).padStart(4, "0")}&t=${token}`;

  it("registers itself on a tap the signature vouches for", async () => {
    const e = await env();
    const secret = testSecret();
    const serial = "NEWCARD1";
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, serial)).toBe(0);

    await pondPage(new Request(tapUrl(serial, 0, cardToken(secret, serial, 0))), e);

    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, serial)).toBe(1);
    /*
     * And `claim_counter` starts at 0 rather than being seeded from the
     * counter on the tag. Seeding it from a card that happened to arrive
     * armed would retire that claim before anybody could use it.
     */
    expect(await count(e.DB, `SELECT claim_counter AS n FROM cards WHERE id = ?1`, serial)).toBe(0);
  });

  it("registers a card whose fortune window has closed", async () => {
    // `?d=0` is a card that has gone quiet. It is no less real for that,
    // and somebody who taps it should still be able to claim it.
    const e = await env();
    const secret = testSecret();
    const serial = "QNETCRD2";
    await pondPage(new Request(tapUrl(serial, 0, cardToken(secret, serial, 0), 0)), e);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, serial)).toBe(1);
  });

  it("ignores a serial with no signature to back it", async () => {
    /*
     * The phantom-card problem the manual list existed to prevent, tested
     * directly: anybody can type `&c=` into a browser, and typing it must
     * create nothing.
     */
    const e = await env();
    await pondPage(new Request(`${ORIGIN}/?d=1&c=MADEUPXX`), e);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, "MADEPXX5")).toBe(0);
  });

  it("ignores a signature signed with the wrong key", async () => {
    // NOTE: the serial here is deliberately a VALID Crockford one, so the
    // test fails for the reason it claims. An invented serial containing
    // I, L, O or U is rejected on its shape before the signature is even
    // looked at, and would pass while proving nothing.
    /*
     * A card flashed with the all-zero placeholder from secrets.h.example
     * signs with zeros. It never verifies, so it never registers — which
     * makes that mistake VISIBLE (the card simply never appears) instead
     * of leaving a card with a forgeable token quietly in the pond.
     */
    const e = await env();
    const wrong = new Uint8Array(16); // the placeholder, all zeros
    const serial = "PACEHDX4";
    await pondPage(new Request(tapUrl(serial, 0, cardToken(wrong, serial, 0))), e);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, serial)).toBe(0);
  });

  it("lets a brand new card be claimed without anybody registering it", async () => {
    // The whole point, end to end: flash a card, hand it over, blow four
    // times, tap. Nothing was recorded and nothing was imported.
    const e = await env();
    const secret = testSecret();
    const serial = "GFTCARD3";
    const v = new Visitor(e);

    // The ordinary tap that introduces it.
    await pondPage(new Request(tapUrl(serial, 0, cardToken(secret, serial, 0))), e);
    // And the armed one, after four blows.
    const res = await v.api("/api/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card: serial, counter: 1, token: cardToken(secret, serial, 1) }),
    });
    expect(res.status).toBe(200);
    expect(await count(e.DB, `SELECT claim_counter AS n FROM cards WHERE id = ?1`, serial)).toBe(1);
  });
});

/**
 * A serial alone is not a card.
 *
 * ══ WHY THIS SUITE EXISTS ══
 * `mintFromQuery` called `ensureCard` — which answers "was this a real
 * card saying hello" — and threw the answer away, then bound the serial to
 * the session straight off the query string.
 *
 * That was survivable while `mintSession` was the only reader: it refuses
 * a serial absent from `cards`, so the worst outcome was a duck attributed
 * to a card that at least exists. It stops being survivable the moment a
 * session can CLAIM a card (docs/pond/KEEPER.md § 6) — keepership would go
 * to whoever typed a serial they had once seen, which is exactly what the
 * signature scheme exists to prevent.
 *
 * Requiring the signature costs nothing real: `&c=`, `&g=` and `&t=` are
 * all written at provisioning and only the fortune digit is ever patched,
 * so there is no such thing as a genuine tap without one.
 */
describe("a serial alone is not a card", () => {
  const signed = (card: string, secret: Uint8Array, digit = 1) =>
    `?d=${digit}&c=${card}&g=0000&t=${cardToken(secret, card, 0)}`;

  it("attributes a duck to the card only when the tap was signed", async () => {
    const e = await env();
    const secret = testSecret();
    const { card } = await makeCard(e.DB, { keeper: "Sam" });

    const honest = new Visitor(e);
    const mine = await release(honest, {}, signed(card, secret));
    expect(
      await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1 AND card_id = ?2`,
        mine.id, card),
      "a signed tap attributes the duck to its card",
    ).toBe(1);

    // The same serial, typed rather than tapped. The card is real and is
    // in `cards` — this is somebody who once saw the URL.
    const liar = new Visitor(e);
    const theirs = await release(liar, {}, `?d=1&c=${card}`);
    expect(
      await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1 AND card_id IS NULL`,
        theirs.id),
      "a typed serial attributes nothing",
    ).toBe(1);
  });

  it("refuses a signature that is real but for a different card", async () => {
    const e = await env();
    const secret = testSecret();
    const { card } = await makeCard(e.DB, { keeper: "Sam" });
    const other = "TWNCARD5";

    // A perfectly valid token — for `other` — presented alongside `card`.
    const v = new Visitor(e);
    const duck = await release(v, {}, `?d=1&c=${card}&g=0000&t=${cardToken(secret, other, 0)}`);
    expect(
      await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1 AND card_id IS NULL`,
        duck.id),
    ).toBe(1);
  });

  it("does not let a typed serial choose the language the page renders in", async () => {
    /*
     * `pondPage` read the serial a SECOND time, raw, and handed it to
     * `keeperLanguage` — not even through `safeToken`. Typing a serial was
     * enough to pick the language. Small next to the claim, and the same
     * mistake, so it is closed with it and pinned here.
     */
    const e = await env();
    const secret = testSecret();
    const { card } = await makeCard(e.DB, { keeper: "Sam", lang: "zh-Hant" });

    const typed = await pondPage(new Request(`${ORIGIN}/?d=1&c=${card}`), e);
    expect(await typed.text(), "a typed serial gets the fallback").toContain('<html lang="en"');

    const tapped = await pondPage(new Request(`${ORIGIN}/${signed(card, secret)}`), e);
    expect(await tapped.text(), "a signed tap gets the keeper's default")
      .toContain('<html lang="zh-Hant"');
  });

  it("still registers and attributes a card nobody has ever recorded", async () => {
    // The two changes have to compose: auto-registration happens BEFORE
    // the session is minted, so a card's very first tap both introduces it
    // and attributes the duck it produces.
    const e = await env();
    const secret = testSecret();
    const serial = "FRSHCRD6";
    const v = new Visitor(e);

    const duck = await release(v, {}, signed(serial, secret));
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards WHERE id = ?1`, serial)).toBe(1);
    expect(
      await count(e.DB, `SELECT COUNT(*) AS n FROM ducks WHERE id = ?1 AND card_id = ?2`,
        duck.id, serial),
    ).toBe(1);
  });
});

/**
 * Keeping a card by having opened it.
 *
 * ══ THE GESTURE NOBODY IS TOLD ABOUT ══
 * Keepership was reachable only by blowing on a card four times during
 * its boot window. A good proof and a useless only-route: a friend handed
 * a card never discovers it, so every card given away stayed unclaimed
 * and every duck from it read `via` nobody.
 *
 * The offer is now made to whoever put a duck in the water from a card
 * nobody keeps. What has to be proved is that somebody is holding the
 * card NOW — which is `sessions.spent_duck`, not `ducks.card_id`. The
 * second is durable provenance that never expires, and accepting it would
 * let a months-old private link claim a card nobody has touched.
 */
describe("claiming a card from the tap that made a duck", () => {
  const signed = (card: string, secret: Uint8Array, digit = 1) =>
    `?d=${digit}&c=${card}&g=0000&t=${cardToken(secret, card, 0)}`;

  it("offers, and gives, the card to whoever opened it", async () => {
    const e = await env();
    const secret = testSecret();
    const serial = "NEWGFT27";
    const v = new Visitor(e);

    // Nothing exists yet: no card row, no keeper, nobody registered it.
    await release(v, {}, signed(serial, secret));

    const before = await v.json<{ keeperOffer: boolean }>("/api/session");
    expect(before.keeperOffer, "a card nobody keeps is on offer").toBe(true);

    const res = await v.api("/api/claim/first", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await count(
      e.DB,
      `SELECT COUNT(*) AS n FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
      serial,
    )).toBe(1);

    // And the offer goes away, because it has been taken.
    const after = await v.json<{ keeperOffer: boolean }>("/api/session");
    expect(after.keeperOffer).toBe(false);
  });

  it("does not spend the claim counter, so four blows still take it back", async () => {
    /*
     * `claimCard` demands a counter strictly ABOVE the stored mark.
     * Advancing it here would retire the next real claim to pay for this
     * one — a card could be kept by a session and then never taken over
     * by its actual owner.
     */
    const e = await env();
    const secret = testSecret();
    const serial = "HANDVER8";
    const v = new Visitor(e);

    await release(v, {}, signed(serial, secret));
    await v.api("/api/claim/first", { method: "POST" });
    expect(await count(e.DB, `SELECT claim_counter AS n FROM cards WHERE id = ?1`, serial)).toBe(0);

    // The real owner blows four times and takes it.
    const owner = new Visitor(e);
    const res = await owner.post("/api/claim", {
      card: serial, counter: 1, token: cardToken(secret, serial, 1),
    });
    expect(res.status).toBe(200);
    expect(await count(
      e.DB,
      `SELECT COUNT(*) AS n FROM card_epochs WHERE card_id = ?1 AND ended IS NULL`,
      serial,
    )).toBe(1);
  });

  it("refuses a card somebody already keeps, and says so distinctly", async () => {
    const e = await env();
    const secret = testSecret();
    const { card } = await makeCard(e.DB, { keeper: "Sam" });
    const v = new Visitor(e);

    await release(v, {}, signed(card, secret));
    expect((await v.json<{ keeperOffer: boolean }>("/api/session")).keeperOffer).toBe(false);

    const res = await v.api("/api/claim/first", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, kept: true });
  });

  it("refuses a keeper who left their name blank — claimed is not unnamed", async () => {
    // The distinction the client must never try to infer from `keeper`.
    const e = await env();
    const secret = testSecret();
    const { card } = await makeCard(e.DB, { keeper: "" });
    const v = new Visitor(e);

    await release(v, {}, signed(card, secret));
    const s = await v.json<{ keeper: string | null; keeperOffer: boolean }>("/api/session");
    expect(s.keeper, "no name to show").toBe(null);
    expect(s.keeperOffer, "but the card is taken").toBe(false);
  });

  it("refuses a session whose tap was not signed", async () => {
    // The whole point of the previous commit, reaching this route: a
    // typed serial binds no card, so there is no card to claim.
    const e = await env();
    testSecret();
    const { card } = await makeCard(e.DB, { keeper: "" });
    await e.DB.prepare(`UPDATE card_epochs SET ended = 1 WHERE card_id = ?1`).bind(card).run();

    const v = new Visitor(e);
    await release(v, {}, `?d=1&c=${card}`);
    expect((await v.json<{ keeperOffer: boolean }>("/api/session")).keeperOffer).toBe(false);

    const res = await v.api("/api/claim/first", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("refuses a session that has not released a duck", async () => {
    // Tapping is not keeping. The duck is the deliberate act.
    const e = await env();
    const secret = testSecret();
    const serial = "NTAPYET9";
    const v = new Visitor(e);
    await v.tap(signed(serial, secret));

    expect((await v.json<{ keeperOffer: boolean }>("/api/session")).keeperOffer).toBe(false);
    expect((await v.api("/api/claim/first", { method: "POST" })).status).toBe(403);
  });

  it("refuses with no session at all", async () => {
    const e = await env();
    const res = await handle(
      new Request(`${ORIGIN}/api/claim/first`, { method: "POST" }),
      e,
    );
    expect(res.status).toBe(401);
  });

  it("refuses a disabled card", async () => {
    // The kill switch for a lost card has to cover this route too, or
    // switching a card off would still let the finder keep it.
    const e = await env();
    const secret = testSecret();
    const serial = "DEADCRD2";
    const v = new Visitor(e);
    await release(v, {}, signed(serial, secret));
    await e.DB.prepare(`UPDATE cards SET disabled = 1 WHERE id = ?1`).bind(serial).run();

    expect((await v.json<{ keeperOffer: boolean }>("/api/session")).keeperOffer).toBe(false);
    expect((await v.api("/api/claim/first", { method: "POST" })).status).toBe(403);
  });
});

/**
 * The private link is the durable way back into card settings.
 *
 * `pond_keeper` lasts an hour — right for the moment after a claim,
 * hopeless as the only key, since after that a keeper could reach their
 * own card only by blowing on it four times, which is the gesture this
 * whole feature exists because nobody knows about.
 */
describe("a keeper's own duck lets them back in", () => {
  const signed = (card: string, secret: Uint8Array, digit = 1) =>
    `?d=${digit}&c=${card}&g=0000&t=${cardToken(secret, card, 0)}`;

  /** Claim a fresh card by session and link the duck that did it. */
  async function keptCard(e: Env, serial: string) {
    const secret = testSecret();
    const v = new Visitor(e);
    const duck = await release(v, {}, signed(serial, secret));
    expect((await v.api("/api/claim/first", { method: "POST" })).status).toBe(200);
    await v.post("/api/keeper", { name: "Sam", lang: "en", editKey: duck.editKey });
    return { v, duck };
  }

  it("reads card settings with the edit key alone, no cookie", async () => {
    const e = await env();
    const { duck } = await keptCard(e, "MYCARD11");

    // A brand new browser: no pond_keeper, nothing but the private link.
    const cold = await handle(
      new Request(`${ORIGIN}/api/keeper?editKey=${duck.editKey}`),
      e,
    );
    expect(cold.status).toBe(200);
    expect(await cold.json()).toMatchObject({ keeper: "Sam" });
  });

  it("saves with the edit key alone", async () => {
    const e = await env();
    const { duck } = await keptCard(e, "MYCARD12");

    const res = await handle(
      new Request(`${ORIGIN}/api/keeper`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Mika", lang: "zh-Hant", editKey: duck.editKey }),
      }),
      e,
    );
    expect(res.status).toBe(200);
    const back = await handle(new Request(`${ORIGIN}/api/keeper?editKey=${duck.editKey}`), e);
    expect(await back.json()).toMatchObject({ keeper: "Mika", lang: "zh-Hant" });
  });

  it("refuses a private link that is not any card's keeper duck", async () => {
    // The premise of the attack: holding SOME duck's private link. It has
    // to be worth nothing here.
    const e = await env();
    await keptCard(e, "MYCARD13");
    const stranger = await release(new Visitor(e));

    const res = await handle(
      new Request(`${ORIGIN}/api/keeper?editKey=${stranger.editKey}`),
      e,
    );
    expect(res.status).toBe(404);
  });

  it("stops working the moment the tenure ends", async () => {
    /*
     * A keeper keeps their duck and loses the card — that is what epochs
     * are for. Four blows from the next owner must shut this door.
     */
    const e = await env();
    const secret = testSecret();
    const serial = "MYCARD14";
    const { duck } = await keptCard(e, serial);
    expect((await handle(new Request(`${ORIGIN}/api/keeper?editKey=${duck.editKey}`), e)).status)
      .toBe(200);

    await new Visitor(e).post("/api/claim", {
      card: serial, counter: 1, token: cardToken(secret, serial, 1),
    });

    expect((await handle(new Request(`${ORIGIN}/api/keeper?editKey=${duck.editKey}`), e)).status)
      .toBe(404);
  });

  it("refuses a malformed key without touching the database", async () => {
    const e = await env();
    await keptCard(e, "MYCARD15");
    expect((await handle(new Request(`${ORIGIN}/api/keeper?editKey=../../etc`), e)).status)
      .toBe(404);
    expect((await handle(new Request(`${ORIGIN}/api/keeper`), e)).status).toBe(404);
  });
});
