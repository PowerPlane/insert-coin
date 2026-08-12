/**
 * Apply `schema/0001_init.sql` to whatever `TURSO_URL` points at.
 *
 * Uses the same splitter the tests do, rather than a shell pipeline, so the
 * trigger bodies survive. `sqlite3 < schema.sql` would work too; a `split
 * on semicolon` would quietly install a broken deletion promise, which is
 * why this exists as code with a test rather than as a one-liner.
 *
 *   TURSO_URL=file:local.db npm run db:apply
 */

import { readFileSync } from "node:fs";
import { connect } from "../src/db/libsql.js";
import { statements } from "../src/db/schema.js";

const url = process.env.TURSO_URL;
if (!url) {
  console.error("TURSO_URL is not set. See docs/pond/HOSTING.md § 4.");
  process.exit(1);
}

const sql = readFileSync(new URL("../schema/0001_init.sql", import.meta.url), "utf8");
const db = await connect(url, process.env.TURSO_TOKEN);

let applied = 0;
for (const stmt of statements(sql)) {
  try {
    await db.prepare(stmt).run();
    applied++;
  } catch (err) {
    const first = stmt.split("\n")[0] ?? stmt.slice(0, 60);
    console.error(`\nfailed on: ${first}\n${String(err)}`);
    db.close();
    process.exit(1);
  }
}

console.log(`applied ${applied} statements to ${url.replace(/\?.*$/, "")}`);
db.close();
