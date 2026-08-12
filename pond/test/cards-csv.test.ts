/**
 * Importing the list of cards that actually exist.
 *
 * The server only accepts serials it already knows, so this file is the
 * gate between "a card was flashed" and "the pond will attribute its
 * ducks". Two things have to be loud here, because both are silent
 * everywhere else: a duplicate serial, and a serial that does not match the
 * SERNUM it was supposedly derived from.
 */

import { afterEach, describe, expect, it } from "vitest";
import { CSV_HEADER, cardsCsvLine, importCards, parseCardsCsv } from "../src/card/cards-csv.js";
import { cardSerial } from "../src/card/identity.js";
import type { Db } from "../src/db/types.js";
import type { Env } from "../src/worker/types.js";
import { count, fresh } from "./helpers.js";

let open: Db | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

async function env(): Promise<Env> {
  const db = (open = await fresh());
  return { DB: db, SESSION_SECRET: "t", ADMIN_PASSWORD: "t" };
}

const bytes = (hex: string) =>
  new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** A row the flashing script would really have written. */
function realRow(sernum: string, label = ""): string {
  return cardsCsvLine({
    serial: cardSerial(bytes(sernum)),
    sernum,
    recorded: 1786500000,
    label,
  });
}

const SERNUM_A = "4132303735310a140700";
const SERNUM_B = "4132303735310a140800";

describe("parsing cards.csv", () => {
  it("accepts what the flashing script writes", () => {
    const csv = [CSV_HEADER, realRow(SERNUM_A, "the one I gave Sam")].join("\n");
    const { rows, errors } = parseCardsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.serial).toBe(cardSerial(bytes(SERNUM_A)));
    expect(rows[0]!.label).toBe("the one I gave Sam");
  });

  it("works with or without the header line", () => {
    expect(parseCardsCsv(realRow(SERNUM_A)).rows).toHaveLength(1);
    expect(parseCardsCsv([CSV_HEADER, realRow(SERNUM_A)].join("\n")).rows).toHaveLength(1);
  });

  it("keeps a label that contains commas", () => {
    const { rows } = parseCardsCsv(realRow(SERNUM_A, "the one I gave Sam, at the bar"));
    expect(rows[0]!.label).toBe("the one I gave Sam, at the bar");
  });

  /**
   * The loudest failure in the file.
   *
   * If the flashing host and the firmware ever derive different serials,
   * every card is unknown to the server at once and nothing errors. This is
   * the only place that disagreement can be caught before a hundred cards
   * are in people's pockets — so it is caught per row, at import time.
   */
  it("refuses a serial that does not match its own SERNUM", () => {
    const wrong = cardsCsvLine({
      serial: "ZZZZZZZZ",
      sernum: SERNUM_A,
      recorded: 1786500000,
      label: "",
    });
    const { rows, errors } = parseCardsCsv(wrong);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/derives to/);
    expect(errors[0]).toMatch(/card-identity\.json/);
  });

  it("refuses a duplicate serial and names the line it first appeared on", () => {
    const { rows, errors } = parseCardsCsv([realRow(SERNUM_A), realRow(SERNUM_A)].join("\n"));
    // The first one is kept; the second is refused rather than overwriting.
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/already appears on line 1/);
    expect(errors[0]).toMatch(/indistinguishable/);
  });

  it("lets two genuinely different cards through", () => {
    const { rows, errors } = parseCardsCsv([realRow(SERNUM_A), realRow(SERNUM_B)].join("\n"));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.serial).not.toBe(rows[1]!.serial);
  });

  it("refuses malformed rows one at a time, and keeps the good ones", () => {
    const csv = [
      realRow(SERNUM_A),
      "NOTASERIAL,4132303735310a140700,1786500000,",
      "7F3A9KQZ,nothex,1786500000,",
      "7F3A9KQZ,4132303735310a140700,notanumber,",
      "onlyonefield",
      realRow(SERNUM_B),
    ].join("\n");
    const { rows, errors } = parseCardsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(4);
    expect(errors.some((e) => /Crockford/.test(e))).toBe(true);
    expect(errors.some((e) => /twenty hex/.test(e))).toBe(true);
    expect(errors.some((e) => /timestamp/.test(e))).toBe(true);
  });

  it("is fine with an empty file", () => {
    expect(parseCardsCsv("")).toEqual({ rows: [], errors: [] });
    expect(parseCardsCsv(CSV_HEADER)).toEqual({ rows: [], errors: [] });
  });
});

describe("importing into the cards table", () => {
  it("inserts what it parsed", async () => {
    const e = await env();
    const { rows } = parseCardsCsv([realRow(SERNUM_A), realRow(SERNUM_B)].join("\n"));
    const result = await importCards(e, rows);

    expect(result.inserted).toBe(2);
    expect(result.alreadyKnown).toEqual([]);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards`)).toBe(2);
  });

  it("is idempotent, because the file is appended to and re-imported", async () => {
    const e = await env();
    const { rows } = parseCardsCsv(realRow(SERNUM_A));
    await importCards(e, rows);
    const again = await importCards(e, rows);

    expect(again.inserted).toBe(0);
    expect(again.alreadyKnown).toEqual([cardSerial(bytes(SERNUM_A))]);
    expect(await count(e.DB, `SELECT COUNT(*) AS n FROM cards`)).toBe(1);
  });

  it("never overwrites a card that already has a keeper", async () => {
    const e = await env();
    const serial = cardSerial(bytes(SERNUM_A));
    await importCards(e, parseCardsCsv(realRow(SERNUM_A, "original")).rows);
    await e.DB.prepare(`UPDATE cards SET disabled = 1 WHERE id = ?1`).bind(serial).run();

    // Re-importing the same serial with a different label must not resurrect
    // a card that was switched off, or rename one somebody is keeping.
    await importCards(e, parseCardsCsv(realRow(SERNUM_A, "changed")).rows);

    const row = await e.DB.prepare(`SELECT label, disabled FROM cards WHERE id = ?1`)
      .bind(serial)
      .first<{ label: string; disabled: number }>();
    expect(row?.label).toBe("original");
    expect(row?.disabled).toBe(1);
  });

  it("does nothing at all with nothing to do", async () => {
    const e = await env();
    expect(await importCards(e, [])).toEqual({ inserted: 0, alreadyKnown: [] });
  });
});
