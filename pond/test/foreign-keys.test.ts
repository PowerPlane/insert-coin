/**
 * The deletion promise, proved rather than assumed.
 *
 * The contact screen says, in writing, before anyone types an address:
 * "Only David sees this. It is not shown in the pond, and it is deleted when
 * you take your duck out." That sentence is true only because
 * `contacts.duck_id ... ON DELETE CASCADE` fires — and Turso ships with
 * foreign keys OFF, in which case the cascade silently does nothing.
 *
 * So this file does not test SQLite. It tests that our adapter leaves the
 * database in a state where that promise holds, and that it refuses to run
 * in a state where it does not.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { LibsqlDb, connect } from "../src/db/libsql";
import type { Db } from "../src/db/types";

const SCHEMA = readFileSync(join(__dirname, "..", "schema", "0001_init.sql"), "utf8");

/** Fresh in-memory database with the real schema applied. */
async function fresh(): Promise<Db> {
  const db = await connect(":memory:");
  // Strip line comments BEFORE splitting: the schema's comments explain the
  // NDEF layout and contain semicolons and `&c=`, which a naive split turns
  // into fragments of invalid SQL.
  const sql = SCHEMA.split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  for (const stmt of sql.split(";")) {
    const s = stmt.trim();
    if (s) await db.prepare(s).run();
  }
  return db;
}

let open: Db | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

async function makeDuckWithContact(db: Db, id: string) {
  await db
    .prepare(
      `INSERT INTO ducks (id, slug, edit_key, fortune, tint, stickers, paint,
                          name, message, created, updated)
       VALUES (?1, ?2, ?3, 0, 0, '[]', '', 'Sam', 'hello', 1, 1)`,
    )
    .bind(id, `slug-${id}`, `key-${id}`)
    .run();
  await db
    .prepare(`INSERT INTO contacts (duck_id, value, created) VALUES (?1, ?2, 1)`)
    .bind(id, "sam@example.com")
    .run();
}

async function contactCount(db: Db, id: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`)
    .bind(id)
    .first<{ n: number }>();
  return Number(r?.n ?? -1);
}

describe("taking a duck out really does delete the contact", () => {
  it("cascades, so the promise on the contact screen is true", async () => {
    const db = (open = await fresh());
    await makeDuckWithContact(db, "d1");
    expect(await contactCount(db, "d1")).toBe(1);

    await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("d1").run();

    // If foreign keys were off this would still be 1, with no error anywhere.
    expect(await contactCount(db, "d1")).toBe(0);
  });

  it("leaves other people's contacts alone", async () => {
    const db = (open = await fresh());
    await makeDuckWithContact(db, "mine");
    await makeDuckWithContact(db, "theirs");

    await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind("mine").run();

    expect(await contactCount(db, "mine")).toBe(0);
    expect(await contactCount(db, "theirs")).toBe(1);
  });
});

describe("the adapter refuses to run without foreign keys", () => {
  it("throws rather than serving with the cascade quietly disabled", async () => {
    // A connection that never got the pragma — what a pool reset, an HTTP-mode
    // quirk, or a future Turso default change would leave us holding.
    const bare = createClient({ url: ":memory:" });
    await bare.execute("PRAGMA foreign_keys = OFF");
    const db = new LibsqlDb(bare);

    await expect(db.assertForeignKeys()).rejects.toThrow(/foreign_keys is OFF/);
    bare.close();
  });

  it("connect() asserts on the way in, so a bad connection never escapes", async () => {
    const db = (open = await connect(":memory:"));
    await expect(db.assertForeignKeys()).resolves.toBeUndefined();
  });
});

describe("meta.changes, which correctness depends on", () => {
  it("reports rows actually changed, not rows matched", async () => {
    const db = (open = await fresh());
    await makeDuckWithContact(db, "d1");

    // extinguish() credits a rescue only when its UPDATE really changed a
    // row; renameDuck() tells "taken" from "invalid" the same way. An
    // adapter that always said 1 would break both silently.
    const hit = await db
      .prepare(`UPDATE ducks SET hidden = 1 WHERE id = ?1`)
      .bind("d1")
      .run();
    expect(hit.meta.changes).toBe(1);

    const miss = await db
      .prepare(`UPDATE ducks SET hidden = 1 WHERE id = ?1`)
      .bind("nobody")
      .run();
    expect(miss.meta.changes).toBe(0);
  });
});

describe("batch, which closes the half-state windows", () => {
  it("applies every statement", async () => {
    const db = (open = await fresh());
    await makeDuckWithContact(db, "d1");

    await db.batch([
      db.prepare(`UPDATE ducks SET wave_count = wave_count + 1 WHERE id = ?1`).bind("d1"),
      db.prepare(`UPDATE ducks SET rescue_count = rescue_count + 1 WHERE id = ?1`).bind("d1"),
    ]);

    const r = await db
      .prepare(`SELECT wave_count AS w, rescue_count AS r FROM ducks WHERE id = ?1`)
      .bind("d1")
      .first<{ w: number; r: number }>();
    expect(Number(r?.w)).toBe(1);
    expect(Number(r?.r)).toBe(1);
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const db = (open = await fresh());
    await makeDuckWithContact(db, "d1");

    await expect(
      db.batch([
        db.prepare(`UPDATE ducks SET wave_count = wave_count + 1 WHERE id = ?1`).bind("d1"),
        db.prepare(`INSERT INTO contacts (duck_id, value, created) VALUES (?1, 'x', 1)`).bind("ghost"),
      ]),
    ).rejects.toThrow();

    // The bump must not have landed on its own — that is the whole point.
    const r = await db
      .prepare(`SELECT wave_count AS w FROM ducks WHERE id = ?1`)
      .bind("d1")
      .first<{ w: number }>();
    expect(Number(r?.w)).toBe(0);
  });
});
