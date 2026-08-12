/**
 * `cards.csv` — the list of cards that actually exist.
 *
 * ══ WHY THERE IS A LIST AT ALL ══
 * The obvious design is: a card turns up with `&c=<serial>`, the server has
 * never seen it, so it registers it. Tempting, and wrong on its own. `&c=`
 * is typed text like everything else in the URL, so anyone could conjure
 * cards that never existed. Phantom rows are not dangerous — a card with no
 * ducks does nothing — but they make the Cards tab useless for the one
 * question it has to answer: *is this one of mine?*
 *
 * So the flashing script appends each serial as it goes, and the server
 * only ever accepts serials already in the `cards` table. It costs no extra
 * manual work: the programmer is reading SIGROW anyway.
 *
 * ══ WHY A DUPLICATE IS LOUD ══
 * `cards.id` is a primary key, so two cards with one serial would be
 * indistinguishable — the second card would inherit the first's ducks and
 * its keeper. The derivation makes that about 4 in a billion across a
 * hundred cards, but "unlikely" is not "impossible", and the failure is
 * silent unless someone shouts. This importer shouts.
 */

import type { Env } from "../worker/types.js";
import { cardSerial, isSerial } from "./identity.js";

export interface CardRow {
  serial: string;
  /** The raw SIGROW bytes, kept so a disagreement can be diagnosed later. */
  sernum: string;
  recorded: number;
  label: string;
}

export const CSV_HEADER = "serial,sernum,recorded,label";

export interface ParseResult {
  rows: CardRow[];
  errors: string[];
}

/**
 * Parse and CHECK a cards.csv.
 *
 * Every row is re-derived from its own recorded SERNUM rather than trusted.
 * That is the whole point of keeping the SERNUM column: if the flashing
 * host and the firmware ever disagreed, this is where it surfaces — at
 * import time, on a desk, rather than as a hundred unattributed ducks.
 */
export function parseCardsCsv(text: string): ParseResult {
  const rows: CardRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows, errors };

  let start = 0;
  if (lines[0]?.trim() === CSV_HEADER) start = 1;

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1;
    const parts = (lines[i] ?? "").split(",");
    if (parts.length < 3) {
      errors.push(`line ${lineNo}: expected at least serial,sernum,recorded`);
      continue;
    }

    const serial = (parts[0] ?? "").trim();
    const sernum = (parts[1] ?? "").trim().toLowerCase();
    const recorded = Number((parts[2] ?? "").trim());
    // A label may legitimately contain commas — "the one I gave Sam, at the bar".
    const label = parts.slice(3).join(",").trim();

    if (!isSerial(serial)) {
      errors.push(`line ${lineNo}: '${serial}' is not eight Crockford characters`);
      continue;
    }
    if (!/^[0-9a-f]{20}$/.test(sernum)) {
      errors.push(`line ${lineNo}: SERNUM must be twenty hex characters, got '${sernum}'`);
      continue;
    }
    if (!Number.isFinite(recorded) || recorded <= 0) {
      errors.push(`line ${lineNo}: '${parts[2]}' is not a timestamp`);
      continue;
    }

    // Re-derive. If this disagrees, the flashing host and the firmware are
    // computing different serials and EVERY card is about to be unknown.
    const bytes = new Uint8Array((sernum.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const expected = cardSerial(bytes);
    if (expected !== serial) {
      errors.push(
        `line ${lineNo}: SERNUM ${sernum} derives to ${expected}, not ${serial} — ` +
          `the flashing host and the firmware disagree, STOP and check ` +
          `shared/firmware/card-identity/card-identity.json`,
      );
      continue;
    }

    const first = seen.get(serial);
    if (first !== undefined) {
      errors.push(
        `line ${lineNo}: serial ${serial} already appears on line ${first} — ` +
          `two physical cards would be indistinguishable`,
      );
      continue;
    }
    seen.set(serial, lineNo);

    rows.push({ serial, sernum, recorded, label });
  }

  return { rows, errors };
}

export interface ImportResult {
  inserted: number;
  alreadyKnown: string[];
}

/**
 * Insert the parsed rows.
 *
 * `INSERT OR IGNORE` so re-importing the same file is a no-op rather than
 * an error — the flashing script appends, so the file grows and gets
 * imported repeatedly by design. What is reported is which serials were
 * already there, because a card being re-flashed and a serial collision
 * look identical here and only a person can tell them apart.
 */
export async function importCards(env: Env, rows: CardRow[]): Promise<ImportResult> {
  if (rows.length === 0) return { inserted: 0, alreadyKnown: [] };

  const results = await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO cards (id, label, created) VALUES (?1, ?2, ?3)`,
      ).bind(r.serial, r.label, r.recorded),
    ),
  );

  const alreadyKnown: string[] = [];
  results.forEach((res, i) => {
    if (!res.meta.changes) alreadyKnown.push(rows[i]!.serial);
  });

  return { inserted: rows.length - alreadyKnown.length, alreadyKnown };
}

/** One line, appended by the flashing script. */
export function cardsCsvLine(row: CardRow): string {
  return [row.serial, row.sernum, String(row.recorded), row.label].join(",");
}
