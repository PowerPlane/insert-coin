/**
 * A real database, with the real schema, for tests.
 *
 * Every test here runs against libSQL itself rather than a stub, because
 * the things worth testing in this project ARE the database's behaviour:
 * whether a trigger fires, whether a UNIQUE index catches a race, whether
 * `meta.changes` counts rows changed or rows matched. A mock would agree
 * with whatever we assumed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { LibsqlDb, connect } from "../src/db/libsql.js";
import { statements } from "../src/db/schema.js";
import type { Db } from "../src/db/types.js";

const SCHEMA = readFileSync(
  join(__dirname, "..", "schema", "0001_init.sql"),
  "utf8",
);

async function applySchema(db: Db): Promise<void> {
  for (const stmt of statements(SCHEMA)) await db.prepare(stmt).run();
}

/** Fresh in-memory database, foreign keys on, real schema applied. */
export async function fresh(): Promise<Db> {
  const db = await connect(":memory:");
  await applySchema(db);
  return db;
}

/**
 * The same, with foreign keys deliberately OFF.
 *
 * This is what a Turso HTTP connection may hand us and what we cannot
 * verify from here — so instead of assuming, the deletion tests run against
 * it directly. If the promise holds in this database, the pragma stops
 * being something correctness depends on.
 */
export async function freshWithoutForeignKeys(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  const db = new LibsqlDb(client);
  if (await db.foreignKeysOn()) {
    throw new Error("could not turn foreign keys off — this test proves nothing");
  }
  await applySchema(db);
  return db;
}

/** A card with a current keeper, so `via <keeper>` has something to resolve. */
export async function makeCard(
  db: Db,
  opts: { card?: string; epoch?: string; keeper?: string; lang?: string } = {},
): Promise<{ card: string; epoch: string }> {
  const card = opts.card ?? "7F3A9KQZ";
  const epoch = opts.epoch ?? `ep-${card}`;
  await db
    .prepare(`INSERT INTO cards (id, label, created) VALUES (?1, '', 1)`)
    .bind(card)
    .run();
  await db
    .prepare(
      `INSERT INTO card_epochs (id, card_id, keeper_name, lang, counter, claimed)
       VALUES (?1, ?2, ?3, ?4, 1, 1)`,
    )
    .bind(epoch, card, opts.keeper ?? "Sam", opts.lang ?? "en")
    .run();
  return { card, epoch };
}

/**
 * The edit key a duck would really have: 32 characters, alphanumeric.
 *
 * The fixture used to produce `editkey-<id>`, which is twelve characters
 * with a hyphen in it — a shape the real validation rejects. Every code
 * path that looks a duck up BY key therefore failed against the fixture
 * while working fine in production, which is the wrong way round for a
 * test to be wrong.
 */
export function editKeyFor(id: string): string {
  return `editkey${id}`.replace(/[^A-Za-z0-9]/g, "").padEnd(32, "0").slice(0, 32);
}

/** A duck, optionally with the private contact hanging off it. */
export async function makeDuck(
  db: Db,
  id: string,
  opts: { contact?: string; epoch?: string; fortune?: number; card?: string } = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ducks (id, slug, edit_key, card_id, epoch_id, fortune, tint, stickers,
                          paint, name, message, created, updated)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, '[]', '', 'Sam', 'hello', 1, 1)`,
    )
    .bind(
      id,
      `slug-${id}`,
      editKeyFor(id),
      // Which card minted it. Needed since `keeper_duck` may only name a
      // duck the card itself produced — a fixture duck from nowhere is
      // exactly what that constraint refuses.
      opts.card ?? null,
      opts.epoch ?? null,
      opts.fortune ?? 0,
    )
    .run();

  if (opts.contact) {
    await db
      .prepare(
        `INSERT INTO contacts (duck_id, value, scope, epoch_id, created)
         VALUES (?1, ?2, 'keeper_and_david', ?3, 1)`,
      )
      .bind(id, opts.contact, opts.epoch ?? null)
      .run();
  }
}

export async function count(db: Db, sql: string, ...args: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...args).first<{ n: number }>();
  return Number(row?.n ?? -1);
}
