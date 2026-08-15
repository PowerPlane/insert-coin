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

  it("the public read touches only the tables a visitor may see", () => {
    // Every query in the module, not just listPond: the shared column list
    // lives outside any one function, and a leak added to a helper would
    // otherwise slip past a test that only looked at the pond.
    const tables = [...read("ducks.ts").matchAll(/\bFROM\s+(\w+)/gi)]
      .map((m) => (m[1] ?? "").toLowerCase())
      .filter(Boolean);
    expect(new Set(tables)).toEqual(
      new Set([
        "ducks",
        "bumps", // how many bumps, and from whom — public by design
        "fires", // is it burning, was it rescued
        "says", // is it speaking
        "card_epochs", // the keeper's NAME. Never the card id.
      ]),
    );
  });

  it("only one module may write to contacts, and it is neither the read nor the router", () => {
    const writers = [
      "index.ts",
      "ducks.ts",
      "release.ts",
      "contact.ts",
      "social.ts",
      "session.ts",
      "pages.ts",
    ].filter((f) => /INSERT\s+INTO\s+contacts/i.test(read(f)));
    expect(writers).toEqual(["release.ts"]);
  });

  it("nothing reads a contact back out", () => {
    // Writing one is a feature. Reading one is Phase 4, behind a password,
    // in a module that does not exist yet — so today the correct number of
    // SELECTs against this table anywhere in the worker is zero.
    for (const f of [
      "index.ts", "ducks.ts", "release.ts", "contact.ts",
      "social.ts", "session.ts", "pages.ts",
    ]) {
      /*
       * `FROM contacts` stands in for "a read", and it is a good proxy in
       * every statement but one: withdrawal DELETEs FROM contacts and
       * reads nothing at all. So that exact statement is removed before
       * the check — by its whole form, so a SELECT cannot shelter behind
       * it — and the rule then applies unchanged to everything else.
       *
       * This is narrower than the test it replaces, not looser: before,
       * any appearance of those two words failed, including ones that
       * read nothing; now a read is what fails.
       */
      const reads = read(f).replace(/DELETE\s+FROM\s+contacts\b/gi, "");
      expect(reads, `${f} reads a contact back out`).not.toMatch(/\bFROM\s+contacts\b/i);
    }
  });

  it("the keeper is shown by name, and the card serial is never selected", () => {
    const src = read("ducks.ts");
    // `card_id` is the serial printed on the tag and half of what a card
    // claim is keyed on. The public read resolves the epoch instead.
    expect(src).not.toMatch(/\bd\.card_id\b/i);
    expect(src).toMatch(/keeper_name/);
  });

  /*
   * ══ WITHDRAWAL IS A DELETE AND NOTHING ELSE ══
   * `contact.ts` exists so a person can take back a phone number without
   * destroying the duck it came with. The temptation, the moment that
   * screen exists, is to also show them what they left — which would put
   * a SELECT against this table into the worker for the first time, and
   * hand a contact value to whoever holds a private link.
   *
   * So the shape of that module is pinned here, not just its behaviour.
   */
  it("withdrawing a contact only ever deletes", () => {
    const code = read("contact.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/DELETE\s+FROM\s+contacts/i);
    // Not one SELECT of a contact's own columns, and nothing that could
    // grow into one. The delete itself is taken out first: it names the
    // table without reading it, and it is the entire point of the file.
    const rest = code.replace(/DELETE\s+FROM\s+contacts\b/gi, "");
    expect(rest).not.toMatch(/\bFROM\s+contacts\b/i);
    expect(rest).not.toMatch(/SELECT[\s\S]{0,200}?\bcontacts\b/i);
    // `value` is the column holding the phone number. It has no business
    // being named by the only module allowed near this table.
    expect(code).not.toMatch(/\bvalue\b/i);
    expect(code).not.toMatch(/\bINSERT\b/i);
    expect(code).not.toMatch(/\bUPDATE\b/i);
  });

  it("the router offers no way to ASK whether a contact exists", () => {
    /*
     * The answer is only ever a consequence of withdrawing. A GET here
     * would turn a leaked private link into a probe for "did this person
     * leave their number", which is a smaller leak than the value itself
     * and still one nobody agreed to.
     */
    const src = read("index.ts");
    const block = src.slice(src.indexOf('/contact"'));
    const upToNextRoute = block.slice(0, block.indexOf("── the owner's own duck"));
    expect(upToNextRoute).toMatch(/req\.method\s*!==\s*"DELETE"/);
    expect(upToNextRoute).not.toMatch(/"GET"/);
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
    const whole = types.slice(types.indexOf("export interface PublicDuck"));
    /*
     * FIELDS, not prose. The first version scanned the interface source
     * whole, and a doc comment that used the word "phone" while explaining
     * clock skew failed it — a privacy test crying wolf over an English
     * sentence, which is how a real one comes to be ignored.
     *
     * The rule it means to enforce is about what is SENT, so comments are
     * stripped before the check.
     */
    const iface = whole
      .slice(0, whole.indexOf("\n}") + 2)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const banned of ["contact", "email", "phone", "handle", "editKey", "edit_key", "cardId", "card_id"]) {
      expect(iface.toLowerCase(), `PublicDuck names "${banned}"`).not.toContain(banned.toLowerCase());
    }
    // And the strip did not eat the interface itself.
    expect(iface).toMatch(/\bslug\b/);
    expect(iface).toMatch(/\bfortune\b/);
  });
});
