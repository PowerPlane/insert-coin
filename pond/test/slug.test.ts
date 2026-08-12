/**
 * Readable duck URLs.
 *
 * The load-bearing property here is that a slug is an ADDRESS, not a KEY.
 * If the readable URL were ever also the edit credential, /d/sam would be
 * guessable and anyone could delete anyone's duck. Several of these tests
 * exist to make that regression loud.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLUG_MAX, SLUG_MIN, SLUG_SPACE, normaliseSlug, randomSlug } from "../src/worker/slug";

describe("randomSlug", () => {
  it("produces a readable two-word name", () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSlug();
      expect(s).toMatch(/^[a-z]+-[a-z]+$/);
      expect(s.length).toBeGreaterThanOrEqual(SLUG_MIN);
      expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    }
  });

  it("survives its own normaliser", () => {
    // A generated name that the validator would then reject is a bug that
    // only shows up in production.
    for (let i = 0; i < 200; i++) {
      const s = randomSlug();
      expect(normaliseSlug(s)).toBe(s);
    }
  });

  it("has enough room that clean two-word names are the norm", () => {
    // Birthday collisions start around sqrt(space); below ~9k the numeric
    // suffix would kick in embarrassingly early.
    expect(SLUG_SPACE).toBeGreaterThan(9000);
  });

  it("is not obviously predictable", () => {
    const seen = new Set(Array.from({ length: 300 }, () => randomSlug()));
    expect(seen.size).toBeGreaterThan(250);
  });
});

describe("normaliseSlug", () => {
  it("tidies what a person actually types", () => {
    expect(normaliseSlug("  Sam's Duck!  ")).toBe("sam-s-duck");
    expect(normaliseSlug("Quiet   Reed")).toBe("quiet-reed");
    expect(normaliseSlug("---hello---")).toBe("hello");
    expect(normaliseSlug("MiKa")).toBe("mika");
  });

  it("keeps a slug URL-safe whatever goes in", () => {
    for (const input of ["🦆🦆🦆duck", "duck/../../etc", "a b?c#d&e", "ダック duck"]) {
      const out = normaliseSlug(input);
      if (out !== null) expect(out).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("rejects anything that would shadow a route", () => {
    for (const r of ["admin", "api", "edit", "settings", "d", "e", "new"]) {
      expect(normaliseSlug(r)).toBeNull();
    }
  });

  it("rejects all-digit names", () => {
    // They read as sequential ids and invite guessing at neighbours.
    expect(normaliseSlug("12345")).toBeNull();
    expect(normaliseSlug("duck-2")).toBe("duck-2");
  });

  it("enforces length at both ends", () => {
    expect(normaliseSlug("ab")).toBeNull();
    expect(normaliseSlug("x".repeat(SLUG_MAX + 1))).toBeNull();
    expect(normaliseSlug("x".repeat(SLUG_MAX))).toHaveLength(SLUG_MAX);
  });

  it("rejects non-strings and empties", () => {
    for (const v of [null, undefined, 42, {}, [], "", "   ", "!!!"]) {
      expect(normaliseSlug(v)).toBeNull();
    }
  });
});

describe("a slug is an address, not a credential", () => {
  const workerDir = join(__dirname, "..", "src", "worker");
  const read = (f: string) => readFileSync(join(workerDir, f), "utf8");

  it("the public slug lookup never selects the edit key", () => {
    const src = read("ducks.ts");
    const fn = src.slice(src.indexOf("export async function duckBySlug"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // Handing the edit key back from a lookup keyed on a guessable name
    // would make every duck editable by anyone.
    expect(body).not.toMatch(/edit_key/);
  });

  it("the public slug lookup hides moderated ducks", () => {
    const src = read("ducks.ts");
    const fn = src.slice(src.indexOf("export async function duckBySlug"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/hidden\s*=\s*0/);
  });

  it("renaming requires the edit key, not the current slug", () => {
    const src = read("ducks.ts");
    const fn = src.slice(src.indexOf("export async function renameDuck"));
    const body = fn.slice(0, fn.indexOf("\nexport"));
    expect(body).toMatch(/WHERE edit_key = /);
  });

  it("the edit key is generated independently of the slug", () => {
    const src = read("release.ts");
    const fn = src.slice(src.indexOf("export async function createDuck"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/const editKey = randomId\(32\)/);
    // If the key were derived from the slug, knowing the URL would yield it.
    expect(body).not.toMatch(/editKey\s*=\s*[^;]*slug/);
  });

  it("the public and private pages live on different paths", () => {
    const routes = readFileSync(join(__dirname, "..", "vercel.json"), "utf8");
    expect(routes).toMatch(/"\/d\/:slug"/); // public, readable, indexable
    expect(routes).toMatch(/"\/e\/:key"/); // private, secret, noindex

    // Only the credential path may be marked noindex; making the public
    // page noindex would mean nobody could ever share a duck.
    const src = read("pages.ts");
    const editPage = src.slice(src.indexOf("export async function editPage"));
    expect(editPage).toMatch(/x-robots-tag/);
    const duckPage = src.slice(
      src.indexOf("export async function duckPage"),
      src.indexOf("export async function editPage"),
    );
    expect(duckPage).not.toMatch(/noindex/);
  });

  it("the private page never server-renders the duck it is for", () => {
    // /e/<key> is a bearer URL. Anything baked into that document is
    // sitting in a browser cache, a screenshot, or a shoulder-surfer's
    // view — so the page ships the key and fetches the rest over the API.
    const src = read("shell.ts");
    const editShell = src.slice(src.indexOf("export function editShell"));
    expect(editShell).toMatch(/noindex: true/);
    // It cannot render what it is never given: the signature takes a key,
    // not a duck. `duckShell` takes one; this must not.
    expect(editShell).toMatch(/editShell\(lang: Language, editKey: string\)/);
    expect(editShell).not.toMatch(/PublicDuck/);
  });
});
