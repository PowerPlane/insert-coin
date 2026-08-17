/**
 * Apply every migration in `schema/` to whatever `TURSO_URL` points at.
 *
 * Runs them in filename order and records each one, so re-running is a
 * no-op and a new file is picked up automatically. There is no down
 * migration: this is a pond, and the recovery for a bad one at this scale
 * is a new database.
 *
 * Uses the same splitter the tests do rather than a shell pipeline, because
 * a trigger body is `BEGIN … ; … ; END` and a naive split on semicolons
 * installs a broken deletion promise that looks fine until somebody asks to
 * be removed.
 *
 *   TURSO_URL=file:local.db npm run db:apply
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../src/db/libsql.js";
import { statements } from "../src/db/schema.js";
import { explainConnectionFailure } from "../src/worker/env.js";

const url = process.env.TURSO_URL;
if (!url) {
  console.error("TURSO_URL is not set. See docs/pond/HOSTING.md § 4.");
  process.exit(1);
}

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let db;
try {
  db = await connect(url, process.env.TURSO_TOKEN);
} catch (err) {
  console.error(`\n${explainConnectionFailure(url, err)}`);
  process.exit(1);
}

// The ledger of what has run. Created by hand, because it is the one table
// no migration can be responsible for creating.
await db
  .prepare(
    `CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)`,
  )
  .run();

const { results } = await db.prepare(`SELECT name FROM migrations`).all<{ name: string }>();
const done = new Set(results.map((r) => r.name));

/*
 * Baseline an existing database.
 *
 * The production pond was created by running 0001 directly, before this
 * ledger existed — so it has the whole schema and an empty `migrations`
 * table, and a naive runner tries to CREATE TABLE cards again and dies on
 * the first statement.
 *
 * If the schema is already here, 0001 is what put it here. Record that and
 * carry on with the rest. Every migration runner grows this step the first
 * time it meets a database that predates it.
 */
if (done.size === 0) {
  const existing = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ducks'`)
    .first<{ name: string }>();
  if (existing) {
    const baseline = files[0]!;
    await db
      .prepare(`INSERT INTO migrations (name, applied) VALUES (?1, ?2)`)
      .bind(baseline, Math.floor(Date.now() / 1000))
      .run();
    done.add(baseline);
    console.log(`  base  ${baseline}  (already applied before this ledger existed)`);
  }
}

for (const file of files) {
  if (done.has(file)) {
    console.log(`  skip  ${file}`);
    continue;
  }

  let applied = 0;
  for (const stmt of statements(readFileSync(join(schemaDir, file), "utf8"))) {
    try {
      await db.prepare(stmt).run();
      applied++;
    } catch (err) {
      console.error(`\n${file} failed on:\n  ${stmt.split("\n")[0]}\n\n${String(err)}\n`);
      db.close();
      process.exit(1);
    }
  }

  await db
    .prepare(`INSERT INTO migrations (name, applied) VALUES (?1, ?2)`)
    .bind(file, Math.floor(Date.now() / 1000))
    .run();
  console.log(`  ok    ${file}  (${applied} statements)`);
}

console.log(`\n${files.length} migration(s) accounted for.\n`);
db.close();
