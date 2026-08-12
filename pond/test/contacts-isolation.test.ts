/**
 * The privacy claim, enforced.
 *
 * People leave phone numbers and email addresses on this site on the
 * understanding that only David sees them. That promise is worth exactly as
 * much as the code that enforces it, so it is enforced two ways:
 *
 *  1. Structurally — the public read module does not name the `contacts`
 *     table, so leaking one requires writing new code rather than
 *     forgetting a filter.
 *  2. Behaviourally — the pond response is inspected for anything that
 *     looks like contact data.
 *
 * If a future change makes this fail, the right fix is almost never to
 * loosen the test.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workerDir = join(__dirname, "..", "src", "worker");
const read = (f: string) => readFileSync(join(workerDir, f), "utf8");

describe("contacts are structurally isolated", () => {
  it("the public duck module never names the contacts table", () => {
    const src = read("ducks.ts");
    // Comments explain the rule, so strip them before checking for real use.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bcontacts\b/i);
  });

  it("the pond query selects only from ducks and its own derived tables", () => {
    const src = read("ducks.ts");
    const listPond = src.slice(src.indexOf("export async function listPond"));
    const tables = [...listPond.matchAll(/\bFROM\s+(\w+)/gi)]
      .map((m) => (m[1] ?? "").toLowerCase())
      .filter(Boolean);
    // fires and says are public state (is it burning, is it speaking).
    expect(new Set(tables)).toEqual(new Set(["ducks", "fires", "says"]));
  });

  it("only one module may write to contacts, and it is not the pond read", () => {
    const writers = ["index.ts", "ducks.ts", "social.ts", "session.ts"].filter((f) =>
      /INSERT\s+INTO\s+contacts/i.test(read(f)),
    );
    expect(writers).toEqual(["index.ts"]);
  });

  it("deleting a duck cascades to its contact", () => {
    const schema = readFileSync(
      join(__dirname, "..", "schema", "0001_init.sql"),
      "utf8",
    );
    const contacts = schema.slice(schema.indexOf("CREATE TABLE contacts"));
    // Without the cascade, "take my duck out" would orphan the contact row
    // — the exact thing the screen promises not to do.
    expect(contacts).toMatch(/REFERENCES\s+ducks\(id\)\s+ON\s+DELETE\s+CASCADE/i);
  });
});

describe("the public duck shape carries no private fields", () => {
  it("PublicDuck has no contact-ish key", () => {
    const types = readFileSync(join(workerDir, "types.ts"), "utf8");
    const iface = types.slice(types.indexOf("export interface PublicDuck"));
    for (const banned of ["contact", "email", "phone", "handle", "editKey", "edit_key", "cardId", "card_id"]) {
      expect(iface.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});
