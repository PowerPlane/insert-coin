/**
 * Prove the deletion promise against a REAL database.
 *
 * ══ WHY THIS SCRIPT EXISTS ══
 * Phase 1a ended with one honest gap: the adapter was verified against
 * libSQL in memory, and whether `PRAGMA foreign_keys` survives Turso's HTTP
 * mode on a remote primary could not be answered without a real database.
 *
 * The schema no longer depends on that answer — `ducks_before_delete` does
 * the deleting, and triggers fire either way. But "no longer depends on it"
 * is a claim, and this is the ten-second script that checks the claim where
 * it actually matters, on the deployed database, rather than in a test that
 * shares our assumptions.
 *
 * It writes only rows prefixed `verify-`, and deletes them again. Safe to
 * run against production, which is the only place it proves anything.
 *
 *   TURSO_URL=... TURSO_TOKEN=... npm run db:verify
 */

import { connect } from "../src/db/libsql.js";
import type { Db } from "../src/db/types.js";

const url = process.env.TURSO_URL;
if (!url) {
  console.error("TURSO_URL is not set. See docs/pond/HOSTING.md § 4.");
  process.exit(1);
}

const stamp = Date.now().toString(36);
const duckId = `verify-${stamp}`.slice(0, 16);
const sessionId = `verify-s-${stamp}`;

let failures = 0;
function check(label: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function count(db: Db, sql: string, ...args: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...args).first<{ n: number }>();
  return Number(row?.n ?? -1);
}

let db;
try {
  db = await connect(url, process.env.TURSO_TOKEN);
} catch (err) {
  const { explainConnectionFailure } = await import("../src/worker/env.js");
  console.error(`\n${explainConnectionFailure(url, err)}`);
  process.exit(1);
}

try {
  // Reported, not asserted. This is the fact Phase 1a could not check; now
  // it is information rather than a gate, because the trigger below is what
  // the promise rests on.
  const fks = await db.foreignKeysOn();
  console.log(`\nforeign_keys on this connection: ${fks ? "ON" : "OFF"}`);
  console.log(fks ? "" : "  (fine — the trigger is what keeps the promise)\n");

  await db
    .prepare(
      `INSERT INTO ducks (id, slug, edit_key, fortune, tint, stickers, paint,
                          name, message, created, updated, hidden)
       VALUES (?1, ?2, ?3, 0, 0, '[]', '', 'verify', '', ?4, ?4, 1)`,
    )
    .bind(duckId, `verify-${stamp}`, `verifykey${stamp}${"0".repeat(16)}`, Math.floor(Date.now() / 1000))
    .run();

  await db
    .prepare(
      `INSERT INTO contacts (duck_id, value, scope, created)
       VALUES (?1, 'verify@example.invalid', 'keeper_and_david', ?2)`,
    )
    .bind(duckId, Math.floor(Date.now() / 1000))
    .run();

  // The reference that used to pin the duck and break the whole thing.
  await db
    .prepare(
      `INSERT INTO sessions (id, fortune, created, expires, spent_duck)
       VALUES (?1, 0, ?2, ?3, ?4)`,
    )
    .bind(sessionId, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 1800, duckId)
    .run();

  check("set up a duck with a contact and a live session", true);

  const deleted = await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind(duckId).run();
  check("the duck deletes at all", deleted.meta.changes === 1, `changes=${deleted.meta.changes}`);

  const contacts = await count(db, `SELECT COUNT(*) AS n FROM contacts WHERE duck_id = ?1`, duckId);
  check("THE CONTACT IS GONE", contacts === 0, `${contacts} row(s) left`);

  const pinned = await count(
    db,
    `SELECT COUNT(*) AS n FROM sessions WHERE id = ?1 AND spent_duck IS NOT NULL`,
    sessionId,
  );
  check("the session released its reference", pinned === 0);
} catch (err) {
  check("no errors", false, String(err));
} finally {
  await db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(sessionId).run().catch(() => {});
  await db.prepare(`DELETE FROM ducks WHERE id = ?1`).bind(duckId).run().catch(() => {});
}

console.log(
  failures === 0
    ? "\nThe deletion promise holds on this database.\n"
    : `\n${failures} check(s) failed. Do not hand out a card until this passes.\n`,
);
db.close();
process.exit(failures === 0 ? 0 : 1);
