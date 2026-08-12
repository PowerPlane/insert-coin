/**
 * The deletion promise, proved rather than assumed.
 *
 * The contact screen says, in writing, before anyone types an address:
 * "Only David sees this. It is not shown in the pond, and it is deleted when
 * you take your duck out."
 *
 * This file does not test SQLite. It tests that the sentence is true — in
 * the database we control AND in the one we do not. The second half is the
 * point: Turso's HTTP mode may hand out a connection where
 * `PRAGMA foreign_keys` is off, we cannot verify that from here, and a
 * promise that depends on an unverifiable fact is not a promise.
 *
 * So every deletion test below runs twice: once with foreign keys on, once
 * with them deliberately off. The trigger in 0001_init.sql is what makes
 * both pass.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { LibsqlDb, connect } from "../src/db/libsql";
import { statements } from "../src/db/schema";
import type { Db } from "../src/db/types";
import { count, fresh, freshWithoutForeignKeys, makeCard, makeDuck } from "./helpers";

let open: Db | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

/** Both worlds, same assertions. */
const MODES: [string, () => Promise<Db>][] = [
  ["with foreign keys on", fresh],
  ["with foreign keys OFF, as Turso may give us", freshWithoutForeignKeys],
];

for (const [label, make] of MODES) {
  describe(`taking a duck out really does delete everything — ${label}`, () => {
    it("deletes the contact", async () => {
      const db = (open = await make());
      await makeDuck(db, "d1", { contact: "sam@example.com" });
      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, "d1")).toBe(1);

      await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("d1").run();

      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, "d1")).toBe(0);
    });

    it("leaves other people's contacts alone", async () => {
      const db = (open = await make());
      await makeDuck(db, "mine", { contact: "mine@example.com" });
      await makeDuck(db, "theirs", { contact: "theirs@example.com" });

      await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("mine").run();

      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, "mine")).toBe(0);
      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, "theirs")).toBe(1);
    });

    /**
     * The bug this schema was frozen to fix.
     *
     * `sessions.spent_duck` points at the duck a session released, so one
     * session cannot mint two. With no ON DELETE action that reference
     * PINNED the duck: taking it out inside the 30-minute session window
     * raised a foreign key violation and the contact survived — in the most
     * ordinary case there is, releasing a duck and changing your mind.
     *
     * With foreign keys off it "worked", silently. Two environments, two
     * behaviours, one broken promise.
     */
    it("deletes a duck its own session is still holding", async () => {
      const db = (open = await make());
      await makeDuck(db, "d1", { contact: "sam@example.com" });
      await db
        .prepare(
          `INSERT INTO sessions (id, fortune, created, expires, spent_duck)
           VALUES ('s1', 0, 1, 9999999999, 'd1')`,
        )
        .run();

      await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("d1").run();

      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, "d1")).toBe(0);
      // The session survives — it is spent, and unspending it would hand
      // someone a second duck.
      expect(await count(db, `SELECT COUNT(*) AS n FROM sessions WHERE id = 's1'`)).toBe(1);
      expect(
        await count(db, `SELECT COUNT(*) AS n FROM sessions WHERE spent_duck IS NULL`),
      ).toBe(1);
    });

    it("takes the whole trail with it — bumps, fires, says, reports", async () => {
      const db = (open = await make());
      await makeDuck(db, "d1", { contact: "sam@example.com", fortune: 3 });
      await makeDuck(db, "other");

      await db
        .prepare(
          `INSERT INTO bumps (from_duck, to_duck, total, first_at, last_at)
           VALUES ('other', 'd1', 3, 1, 1), ('d1', 'other', 1, 1, 1)`,
        )
        .run();
      await db
        .prepare(
          `INSERT INTO fires (id, duck_id, lit_at, burns_until, out_at, out_by)
           VALUES (1, 'd1', 1, 91, 40, 'v1')`,
        )
        .run();
      await db.prepare(`INSERT INTO says (duck_id, text, created) VALUES ('d1', 'hi', 1)`).run();
      await db
        .prepare(
          `INSERT INTO reports (duck_id, visitor, reason, note, created)
           VALUES ('d1', 'v1', 'spam', 'selling things', 1)`,
        )
        .run();

      await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("d1").run();

      expect(await count(db, `SELECT COUNT(*) AS n FROM contacts`)).toBe(0);
      expect(await count(db, `SELECT COUNT(*) AS n FROM fires`)).toBe(0);
      expect(await count(db, `SELECT COUNT(*) AS n FROM says`)).toBe(0);
      expect(await count(db, `SELECT COUNT(*) AS n FROM reports`)).toBe(0);
      // Both directions of the pair, not just the ones it sent.
      expect(await count(db, `SELECT COUNT(*) AS n FROM bumps`)).toBe(0);
      // And the duck that did the bumping is untouched.
      expect(await count(db, `SELECT COUNT(*) AS n FROM ducks WHERE id = 'other'`)).toBe(1);
    });

    it("releases a keeper's linked duck without ending their tenure", async () => {
      const db = (open = await make());
      const { epoch } = await makeCard(db);
      await makeDuck(db, "d1", { epoch });
      await db
        .prepare(`UPDATE card_epochs SET keeper_duck = 'd1' WHERE id = ?1`)
        .bind(epoch)
        .run();

      await db.prepare(`DELETE FROM ducks WHERE id = 'd1'`).run();

      // The epoch is still there. Deleting your duck is not resigning as a
      // card keeper, and it must never cascade into one.
      expect(await count(db, `SELECT COUNT(*) AS n FROM card_epochs WHERE id = ?1`, epoch)).toBe(1);
      expect(
        await count(db, `SELECT COUNT(*) AS n FROM card_epochs WHERE keeper_duck IS NULL`),
      ).toBe(1);
    });
  });
}

describe("the pragma itself", () => {
  it("is on for a local database, and connect() says so", async () => {
    const db = (open = await connect(":memory:"));
    await expect(db.foreignKeysOn()).resolves.toBe(true);
    await expect(db.assertForeignKeys()).resolves.toBeUndefined();
  });

  it("refuses a local connection that is not enforcing them", async () => {
    // Locally, foreign keys being off means the rig is broken, not that a
    // platform declined to keep a per-connection setting.
    const bare = createClient({ url: ":memory:" });
    await bare.execute("PRAGMA foreign_keys = OFF");
    const db = new LibsqlDb(bare);

    await expect(db.foreignKeysOn()).resolves.toBe(false);
    await expect(db.assertForeignKeys()).rejects.toThrow(/foreign_keys is OFF/);
    bare.close();
  });
});

describe("the schema splitter", () => {
  it("keeps a trigger body in one piece", () => {
    const parts = statements(`
      CREATE TABLE a (x INTEGER);
      -- a comment; with a semicolon in it
      CREATE TRIGGER t BEFORE DELETE ON a
      BEGIN
        DELETE FROM b WHERE x = OLD.x;
        DELETE FROM c WHERE x = OLD.x;
      END;
      CREATE INDEX i ON a (x);
    `);

    expect(parts).toHaveLength(3);
    // Cut on the inner semicolons, this would have been three fragments of
    // invalid SQL and the deletion promise would never have been installed.
    expect(parts[1]).toContain("DELETE FROM b");
    expect(parts[1]).toContain("DELETE FROM c");
    expect(parts[1]!.endsWith("END")).toBe(true);
  });
});

describe("meta.changes, which correctness depends on", () => {
  it("reports rows actually changed, not rows matched", async () => {
    const db = (open = await fresh());
    await makeDuck(db, "d1");

    // extinguish() credits a rescue only when its UPDATE really changed a
    // row; renameDuck() tells "taken" from "invalid" the same way. An
    // adapter that always said 1 would break both silently.
    const hit = await db.prepare(`UPDATE ducks SET hidden = 1 WHERE id = ?1`).bind("d1").run();
    expect(hit.meta.changes).toBe(1);

    const miss = await db.prepare(`UPDATE ducks SET hidden = 1 WHERE id = ?1`).bind("nobody").run();
    expect(miss.meta.changes).toBe(0);
  });
});

describe("batch, which closes the half-state windows", () => {
  it("applies every statement", async () => {
    const db = (open = await fresh());
    await makeDuck(db, "d1");
    await makeDuck(db, "d2");

    await db.batch([
      db
        .prepare(
          `INSERT INTO bumps (from_duck, to_duck, total, first_at, last_at)
           VALUES (?1, ?2, 1, 1, 1)`,
        )
        .bind("d2", "d1"),
      db.prepare(`INSERT INTO says (duck_id, text, created) VALUES (?1, 'hi', 1)`).bind("d1"),
    ]);

    expect(await count(db, `SELECT COUNT(*) AS n FROM bumps`)).toBe(1);
    expect(await count(db, `SELECT COUNT(*) AS n FROM says`)).toBe(1);
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const db = (open = await fresh());
    await makeDuck(db, "d1");
    await makeDuck(db, "d2");

    await expect(
      db.batch([
        db
          .prepare(
            `INSERT INTO bumps (from_duck, to_duck, count, first_at, last_at)
             VALUES (?1, ?2, 1, 1, 1)`,
          )
          .bind("d2", "d1"),
        // Same pair again: the primary key rejects it.
        db
          .prepare(
            `INSERT INTO bumps (from_duck, to_duck, count, first_at, last_at)
             VALUES (?1, ?2, 1, 1, 1)`,
          )
          .bind("d2", "d1"),
      ]),
    ).rejects.toThrow();

    // The first insert must not have landed on its own — that is the point.
    expect(await count(db, `SELECT COUNT(*) AS n FROM bumps`)).toBe(0);
  });
});
