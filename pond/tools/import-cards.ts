/**
 * Import cards.csv into the `cards` table.
 *
 *   TURSO_URL=... TURSO_TOKEN=... npm run cards:import -- ../cards.csv
 *
 * Safe to run repeatedly: the flashing script appends as it goes, so this
 * is meant to be run again after every batch. Already-known serials are
 * reported, not treated as failures.
 *
 * It refuses to import ANYTHING if any row fails to check. A cards.csv with
 * a bad row is evidence that something upstream is wrong — most seriously,
 * that the flashing host and the firmware are deriving different serials —
 * and importing the good half of that file would bury the signal.
 */

import { readFileSync } from "node:fs";
import { connect } from "../src/db/libsql.js";
import { importCards, parseCardsCsv } from "../src/card/cards-csv.js";
import type { Env } from "../src/worker/types.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run cards:import -- <cards.csv>");
  process.exit(1);
}

const url = process.env.TURSO_URL;
if (!url) {
  console.error("TURSO_URL is not set. See docs/pond/HOSTING.md § 4.");
  process.exit(1);
}

const { rows, errors } = parseCardsCsv(readFileSync(path, "utf8"));

if (errors.length) {
  console.error(`\n${errors.length} problem(s) in ${path}:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error("\nNothing imported. Fix the file, or the firmware, first.\n");
  process.exit(1);
}

if (rows.length === 0) {
  console.log(`${path} has no cards in it.`);
  process.exit(0);
}

const db = await connect(url, process.env.TURSO_TOKEN);
const env: Env = { DB: db, SESSION_SECRET: "", ADMIN_PASSWORD: "" };

const result = await importCards(env, rows);
console.log(`\n${rows.length} card(s) in ${path}`);
console.log(`  ${result.inserted} new`);
if (result.alreadyKnown.length) {
  console.log(`  ${result.alreadyKnown.length} already known: ${result.alreadyKnown.join(", ")}`);
}
console.log();

db.close();
