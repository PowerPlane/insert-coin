/**
 * The /flash page and its script are two files that have to agree, and
 * nothing at runtime checks that they do: a missing id is a page that
 * throws on load, in a browser the test suite cannot open.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flashShell } from "../src/worker/flash-shell.js";

const root = join(__dirname, "..");
const html = flashShell();
const script = readFileSync(join(root, "src", "flasher", "main.ts"), "utf8");

describe("the /flash page", () => {
  it("has every element the script asks for by id", () => {
    const wanted = [...script.matchAll(/el<[^>]+>\("([a-z-]+)"\)/g)].map((m) => m[1]!);
    expect(wanted.length).toBeGreaterThan(10);
    for (const id of wanted) {
      expect(html, `#${id} is missing from flash-shell.ts`).toContain(`id="${id}"`);
    }
  });

  it("has a row for every step of the checklist", () => {
    for (const key of ["connect", "chip", "write", "verify", "fuses"]) {
      expect(html).toContain(`data-check="${key}"`);
    }
  });

  it("asks for assets that exist, as a module, in English, unindexed", () => {
    for (const m of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
      expect(existsSync(join(root, "public", m[1]!)), `missing public${m[1]}`).toBe(true);
    }
    expect(html).toContain('<script type="module" src="/flash.js">');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("noindex");
  });

  it("is reached by a rewrite to a function that exists", () => {
    const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    const flash = config.rewrites.find((r) => r.source === "/flash");
    expect(flash?.destination).toBe("/api/flash");
    expect(existsSync(join(root, "api", "flash.ts"))).toBe(true);
  });

  it("ships as a committed bundle, in step with its source", () => {
    const bundle = join(root, "public", "flash.js");
    expect(existsSync(bundle)).toBe(true);
    const js = readFileSync(bundle, "utf8");
    // The strings the friend reads are in the bundle, so the page and the
    // script cannot be from different days.
    expect(js).toContain("Flash the card");
    expect(js).toContain("SYSCFG0"); // the fuse table travelled with it
  });
});
