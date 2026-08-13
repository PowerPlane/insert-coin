/**
 * Things that are only wrong once deployed.
 *
 * ══ WHY THIS FILE EXISTS ══
 * The first production deploy of Phase 1b returned 500 on every route:
 *
 *   Cannot find module '/var/task/src/worker/env'
 *   imported from /var/task/api/shell.js
 *
 * Vercel transpiles each TypeScript file separately — it does not bundle —
 * and with `"type": "module"` Node's ESM loader treats an import specifier
 * as a literal path. `from "./env"` resolves to a file that does not exist.
 *
 * The 89 tests that were green at the time could not have caught it: Vitest
 * loads through Vite, which resolves extensionless imports the way a bundler
 * does. **The test environment was more forgiving than production**, which is
 * the one direction a test environment must never differ.
 *
 * So this file asserts the shape the platform requires, using nothing but
 * the file system. Everything here is a rule that is invisible locally and
 * fatal in production.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function tsFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".vercel") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsFiles(full, found);
    else if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("the shape Node's ESM loader requires", () => {
  it("every relative import carries a file extension", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(join(root, "src")).concat(
      tsFiles(join(root, "api")),
      tsFiles(join(root, "tools")),
    )) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\s+["'](\.\.?\/[^"']*)["']/g)) {
        const spec = m[1] ?? "";
        if (!/\.(js|json|css)$/.test(spec)) {
          offenders.push(`${file.slice(root.length + 1)} → ${spec}`);
        }
      }
    }

    // `./env` becomes `/var/task/src/worker/env`, which is not a file, and
    // the function exits 1 before it can serve anything. Write `./env.js`
    // even though the file on disk is `env.ts` — TypeScript resolves the
    // substitution, and the emitted JavaScript is what actually runs.
    expect(offenders).toEqual([]);
  });
});

describe("the shape Vercel's CDN requires", () => {
  it("there is no public/index.html", () => {
    // Load-bearing absence. The CDN answers a static file BEFORE any
    // function is invoked, so an index.html here would mean `/` could never
    // exchange a tap for a session — and that exchange gets exactly one
    // chance, 300 seconds after a coin goes in. Every duck would die on the
    // submit button, and nothing would look broken until someone tried.
    expect(existsSync(join(root, "public", "index.html"))).toBe(false);
  });

  it("every asset the page asks for is actually there", () => {
    // `public/` used to be gitignored, from when Wrangler generated it. On
    // Vercel it is the output directory and nothing generates it, so a
    // missing file here is a blank page in production and a clean local run.
    //
    // Follows CSS @import as well as the shell's own tags: the typefaces
    // are reached that way, and a stylesheet that 404s costs the whole
    // visual identity while every test still passes.
    const wanted = new Set<string>();

    const shell = readFileSync(join(root, "src", "worker", "shell.ts"), "utf8");
    for (const m of shell.matchAll(/(?:href|src)="(\/[^"]+)"/g)) wanted.add(m[1]!);

    for (const asset of [...wanted]) {
      if (!asset.endsWith(".css")) continue;
      const css = readFileSync(join(root, "public", asset), "utf8");
      for (const m of css.matchAll(/@import\s+url\("([^"]+)"\)/g)) wanted.add(m[1]!);
    }

    for (const asset of wanted) {
      expect(existsSync(join(root, "public", asset)), `missing public${asset}`).toBe(true);
    }
  });

  it("/api/* is rewritten, because filename routing only matched one segment", () => {
    // `api/[...path].ts` deployed fine and then served exactly one path
    // segment: /api/pond worked, /api/duck/by-slug/<slug> returned Vercel's
    // own NOT_FOUND without ever invoking our code. Zero-config /api does
    // not expand a catch-all across segments.
    //
    // Deleting this rewrite silently un-deploys half the API — every route
    // with a slash in it — while the tests stay green, so it is asserted
    // here rather than trusted to a comment.
    const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      rewrites?: { source: string; destination: string }[];
    };
    const api = (config.rewrites ?? []).find((r) => r.source.startsWith("/api/"));
    expect(api, "no /api/* rewrite — multi-segment routes will 404").toBeDefined();
    expect(api?.destination).toContain("__path=");
  });

  it("every route in vercel.json points at a function that exists", () => {
    const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      rewrites?: { destination: string }[];
      crons?: { path: string }[];
    };

    const targets = [
      ...(config.rewrites ?? []).map((r) => r.destination),
      ...(config.crons ?? []).map((c) => c.path),
    ];

    for (const target of targets) {
      // Strip the query string a rewrite uses to pass what it matched.
      const path = (target.split("?")[0] ?? "").replace(/^\/api\//, "");
      expect(existsSync(join(root, "api", `${path}.ts`)), `no api/${path}.ts`).toBe(true);
    }
  });
});

describe("the committed bundle is in step with its source", () => {
  /**
   * `public/app.js` is generated by tools/build-client.mjs and COMMITTED,
   * because nothing builds at deploy time. That trade buys a build-free
   * deploy and costs exactly one risk: someone edits `src/client/` and
   * forgets to rebuild, so the deployed client is older than the code that
   * was reviewed — and every local test passes while the site runs
   * something else.
   *
   * The same trade card-identity.json makes, checked the same way: rebuild
   * and compare. esbuild does this in tens of milliseconds.
   */
  it("rebuilding produces byte-identical output", () => {
    const bundle = join(root, "public", "main.js");
    const before = readFileSync(bundle);

    execFileSync("node", ["tools/build-client.mjs"], { cwd: root, stdio: "pipe" });
    const after = readFileSync(bundle);

    expect(
      after.equals(before),
      "public/app.js is stale — run `npm run build:client` and commit the result",
    ).toBe(true);
  });

  it("the shell asks for the bundle it actually builds", () => {
    const shell = readFileSync(join(root, "src", "worker", "shell.ts"), "utf8");
    expect(shell).toContain('/main.js');
    // type="module" matters: the bundle is ESM, and a classic script tag
    // would fail on the first `import` with nothing but a console error.
    expect(shell).toContain('type="module"');
  });

  it("has no `build` script, which Vercel would run at deploy", () => {
    // `vercel link` reported: Build Command: `npm run vercel-build` or
    // `npm run build`. Zero-config RUNS a script called `build`, which
    // would quietly reintroduce a deploy-time build — the exact thing the
    // no-build-step invariant exists to prevent. It is `build:client`.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(Object.keys(pkg.scripts)).not.toContain("build");
    expect(Object.keys(pkg.scripts)).not.toContain("vercel-build");
    expect(pkg.scripts["build:client"]).toBeDefined();
  });
});

describe("no function file shadows an API path", () => {
  /**
   * A file in `api/` beats the `/api/:path*` rewrite. `api/admin.ts` served
   * the pondkeeper's HTML at `/api/admin`, so the admin API — password gate
   * and all — answered 200 with a login page to anyone who asked for it.
   *
   * Any file whose name matches a path the router handles is the same bug,
   * so the rule is checked rather than remembered.
   */
  it("no api/<name>.ts collides with a route the router owns", () => {
    const router = readFileSync(join(root, "src", "worker", "index.ts"), "utf8");
    const owned = new Set(
      [...router.matchAll(/path(?:\s*===|\.startsWith\()\s*"\/api\/([a-z-]+)/g)].map((m) => m[1]!),
    );

    const files = readdirSync(join(root, "api"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""));

    for (const f of files) {
      expect(owned.has(f), `api/${f}.ts shadows the router's /api/${f}`).toBe(false);
    }
  });
});
