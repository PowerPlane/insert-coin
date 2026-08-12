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

  it("the assets the shell asks for are actually there", () => {
    // `public/` used to be gitignored, from when Wrangler generated it. On
    // Vercel it is the output directory and nothing generates it, so a
    // missing file here is a blank page in production and a clean local run.
    const shell = readFileSync(join(root, "src", "worker", "shell.ts"), "utf8");
    for (const m of shell.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
      const asset = m[1] ?? "";
      expect(existsSync(join(root, "public", asset)), `missing public${asset}`).toBe(true);
    }
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
