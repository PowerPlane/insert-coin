/**
 * The two derivations, compared through an artifact neither one authored.
 *
 * ══ THE FAILURE THIS PREVENTS ══
 * A card's serial is computed twice: in C on the ATtiny1616 as it writes
 * its own tag, and in TypeScript here as the flashing script records it and
 * the server verifies its claims. A byte-order or bit-range disagreement
 * between the two would make EVERY card unknown to the server at once —
 * and it would fail silently, because an unknown serial is designed to
 * degrade rather than error. Every duck unattributed, on all hundred cards,
 * and nothing on fire to tell anyone.
 *
 * So this file does not test TypeScript against C. It tests TypeScript
 * against `shared/firmware/card-identity/card-identity.json`, which is
 * GENERATED from the C by `regenerate.sh`. The C is tested against the same
 * file by `test_card_identity.c`. Neither implementation gets to be the
 * reference for the other.
 *
 * Phase 2's done-when — "the `&c=` in the tapped URL matches, character for
 * character, the row the flashing script wrote, on two cards flashed from
 * one binary" — is the bench version of this file.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CROCKFORD,
  SERIAL_KEY,
  cardSerial,
  cardToken,
  counterHex,
  crockford40,
  isSerial,
  siphash24,
  verifyClaim,
} from "../src/card/identity.js";

const SPEC = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "shared", "firmware", "card-identity", "card-identity.json"),
    "utf8",
  ),
) as {
  version: number;
  serial: { serial_key_hex: string; alphabet: string; length: number };
  token: { test_key_hex: string; length: number };
  url: { template: string };
  serials: { note: string; sernum: string; serial: string }[];
  tokens: { serial: string; counter: number; counter_hex: string; token: string }[];
};

const hex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));

describe("the pinned specification", () => {
  it("is the version this code was written against", () => {
    // A bumped version means the spec moved. Read the diff before touching
    // anything here — the point of the file is that it fails loudly.
    expect(SPEC.version).toBe(1);
  });

  it("agrees with this implementation's constants", () => {
    expect(SPEC.serial.alphabet).toBe(CROCKFORD);
    expect(hex(SPEC.serial.serial_key_hex)).toEqual(SERIAL_KEY);
  });
});

describe("SipHash-2-4, against the reference implementation's own vectors", () => {
  // Key 00 01 … 0f, message i = the bytes 00 01 … i-1. The same 64 cases
  // test_card_identity.c runs, sourced from veorq/SipHash rather than
  // reconstructed — a vector remembered wrong proves two things agree about
  // being wrong.
  const REFERENCE: string[] = JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "shared", "firmware", "card-identity", "siphash_reference_vectors.h"),
      "utf8",
    )
      .replace(/[\s\S]*?\{/, "[")
      .replace(/\};[\s\S]*/, "]")
      .replace(/,(\s*])/, "$1"),
  );

  it("has all 64 reference vectors", () => {
    expect(REFERENCE).toHaveLength(64);
  });

  it("matches every one of them", () => {
    const key = new Uint8Array(16).map((_, i) => i);
    const msg = new Uint8Array(64).map((_, i) => i);

    for (let len = 0; len < 64; len++) {
      const h = siphash24(key, msg.subarray(0, len));
      // The reference prints its digest as eight bytes little-endian.
      const le = [...new Array(8)]
        .map((_, i) => Number((h >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0"))
        .join("");
      expect(le, `message length ${len}`).toBe(REFERENCE[len]);
    }
  });
});

describe("the serial, against the vectors the firmware generated", () => {
  it("derives every pinned case identically", () => {
    for (const c of SPEC.serials) {
      expect(cardSerial(hex(c.sernum)), c.note).toBe(c.serial);
    }
  });

  it("gives two chips from one reel unrelated serials", () => {
    // The reason the serial is hashed rather than sliced. These two SERNUMs
    // differ by ONE die coordinate — a fixed 40-bit window would put them
    // next door to each other, or make them equal.
    const [a, b] = SPEC.serials.filter((s) => s.note.startsWith("reel sibling"));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.serial).not.toBe(b!.serial);
    // Not merely different — sharing no leading run, which is what a sliced
    // derivation would have produced.
    expect(a!.serial[0] === b!.serial[0] && a!.serial[1] === b!.serial[1]).toBe(false);
  });

  it("only ever emits characters a person can read back", () => {
    for (const c of SPEC.serials) {
      expect(c.serial).toHaveLength(8);
      expect(c.serial).not.toMatch(/[ILOU]/);
      expect(isSerial(c.serial)).toBe(true);
    }
  });

  it("is most-significant-group first", () => {
    // Get this backwards on one side only and every card is unknown.
    expect(crockford40(1n << 35n)).toBe("10000000");
    expect(crockford40(0n)).toBe("00000000");
    expect(crockford40((1n << 40n) - 1n)).toBe("ZZZZZZZZ");
  });

  it("refuses a SERNUM that is not ten bytes", () => {
    expect(() => cardSerial(new Uint8Array(9))).toThrow(/ten bytes/);
  });
});

describe("the claim token, against the vectors the firmware generated", () => {
  const key = hex(SPEC.token.test_key_hex);

  it("derives every pinned case identically", () => {
    for (const t of SPEC.tokens) {
      expect(cardToken(key, t.serial, t.counter), `${t.serial}/${t.counter}`).toBe(t.token);
      expect(counterHex(t.counter)).toBe(t.counter_hex);
    }
  });

  it("verifies a real claim and refuses a forged one", () => {
    const t = SPEC.tokens[0]!;
    expect(verifyClaim(key, t.serial, t.counter, t.token)).toBe(true);

    // One nibble off. 40 bits is small enough that the comparison is
    // constant-time for a reason.
    const forged = t.token.slice(0, -1) + (t.token.at(-1) === "0" ? "1" : "0");
    expect(verifyClaim(key, t.serial, t.counter, forged)).toBe(false);
  });

  it("refuses a claim replayed onto a different counter", () => {
    // The other half of the rule — the server also requires the counter to
    // exceed the highest it has seen. This is the half the token enforces.
    const t = SPEC.tokens.find((x) => x.counter === 0);
    expect(t).toBeDefined();
    expect(verifyClaim(key, t!.serial, 1, t!.token)).toBe(false);
  });

  it("refuses a claim replayed onto a different card", () => {
    const t = SPEC.tokens.find((x) => x.serial === "7F3A9KQZ" && x.counter === 0);
    expect(t).toBeDefined();
    expect(verifyClaim(key, "00000000", 0, t!.token)).toBe(false);
  });

  it("refuses a token signed with the wrong secret", () => {
    const wrong = new Uint8Array(key);
    wrong[7] = (wrong[7] ?? 0) ^ 0x01;
    const t = SPEC.tokens[0]!;
    expect(verifyClaim(wrong, t.serial, t.counter, t.token)).toBe(false);
  });

  it("rejects malformed input rather than throwing at a caller", () => {
    const t = SPEC.tokens[0]!;
    expect(verifyClaim(key, "TOOSHORT1X", t.counter, t.token)).toBe(false);
    expect(verifyClaim(key, t.serial, t.counter, "short")).toBe(false);
    // I, L, O and U are not in the alphabet, so a serial containing one
    // never came off a card.
    expect(isSerial("ILOU1234")).toBe(false);
  });

  it("holds the counter to 16 bits at both ends", () => {
    expect(() => counterHex(-1)).toThrow(/16-bit/);
    expect(() => counterHex(0x10000)).toThrow(/16-bit/);
    expect(counterHex(0xffff)).toBe("ffff");
  });
});

describe("the layout, in the third place it appears", () => {
  /**
   * The URL is described in three files: the NDEF builder that writes it,
   * the firmware config that patches one byte of it, and the spec. The
   * builder derives its offsets from the strings, so those two cannot
   * drift — but `config.h` still carries a literal, because ndef.cpp needs
   * a constant to write to.
   *
   * A wrong constant there patches the wrong byte and the card serves a
   * broken URL for the rest of its life, with nothing to notice it but a
   * tap. So the literal is checked here against the same arithmetic the C
   * does.
   */
  const CONFIG = readFileSync(
    join(
      __dirname, "..", "..", "variants", "business-card-v1",
      "firmware", "production-pond", "src", "config.h",
    ),
    "utf8",
  );

  it("config.h patches the byte the record builder put the digit at", () => {
    const m = CONFIG.match(/NDEF_DIGIT_OFFSET\s*=\s*(0x[0-9A-Fa-f]+)/);
    expect(m, "NDEF_DIGIT_OFFSET not found in config.h").not.toBeNull();

    // Derived the same way ndef_record.h does it: CC + TLV header + record
    // header + the URI prefix byte, then the host text.
    const url = SPEC.url.template;
    const prefix = url.slice("https://".length, url.indexOf("<digit>"));
    const derived = 4 + 2 + 4 + 1 + prefix.length;

    expect(prefix).toBe("ducky.davidyang.work/?d=");
    expect(Number(m![1])).toBe(derived);
    expect(derived).toBe(0x0023);
  });

  it("puts every per-card field after the digit, so one binary fits all cards", () => {
    const url = SPEC.url.template;
    // If a serial ever moved ahead of the digit, the patch target would
    // differ per card and the firmware could no longer be identical.
    expect(url.indexOf("<digit>")).toBeLessThan(url.indexOf("<serial>"));
    expect(url.indexOf("<digit>")).toBeLessThan(url.indexOf("<counter>"));
    expect(url.indexOf("<digit>")).toBeLessThan(url.indexOf("<token>"));
  });
});

describe("real cards, from the bench", () => {
  /**
   * The only vectors in this file that did not come from our own code.
   *
   * Each SERNUM was read off a physical ATtiny1616 with avrdude; each
   * serial is what that card actually wrote into its own tag and what a
   * phone actually read back. Everything else here proves the two
   * implementations agree with EACH OTHER. These prove they agree with
   * silicon.
   *
   *   card 1  /?d=1&c=0YBSVSVN&g=0000&t=5d29221795
   *   card 2  /?d=2&c=G5JNY9HG&g=0000&t=764c1cde6a
   *
   * Two, not one, because a derivation that is wrong CONSISTENTLY would
   * still make a single card match itself.
   *
   * If either ever fails, the derivation moved under a card that already
   * exists in the world, and that card's ducks become unattributed.
   */
  const CARDS = [
    { sernum: "3054304c493268721626", serial: "0YBSVSVN" },
    { sernum: "3054304c493247482406", serial: "G5JNY9HG" },
  ];

  it("derives what each real chip put in its own tag", () => {
    for (const c of CARDS) {
      const bytes = new Uint8Array((c.sernum.match(/../g) ?? []).map((b) => parseInt(b, 16)));
      expect(cardSerial(bytes), c.sernum).toBe(c.serial);
      expect(isSerial(c.serial)).toBe(true);
    }
  });

  it("gives two chips from one reel unrelated serials, in reality and not just in theory", () => {
    // These two came off the same reel: their SERNUMs share the first SIX
    // bytes (30 54 30 4c 49 32) and differ only in the last four. A
    // derivation that sliced a fixed window out of them could easily have
    // collided — and 60% of the bytes being identical across the batch is
    // precisely the entropy problem the hash exists to solve.
    expect(CARDS[0]!.sernum.slice(0, 12)).toBe(CARDS[1]!.sernum.slice(0, 12));
    expect(CARDS[0]!.serial).not.toBe(CARDS[1]!.serial);
    expect(CARDS[0]!.serial[0]).not.toBe(CARDS[1]!.serial[0]);
  });

  it("shows why the low bytes could not be trusted as a serial", () => {
    // 30 54 30 4c 49 32 — ASCII-ish lot characters filling the high bytes
    // on both cards, which is exactly the pattern that made "the low 40
    // bits" the wrong derivation. The synthetic vectors guessed this
    // shape; the real chips confirm it.
    for (const c of CARDS) expect(c.sernum.startsWith("3054304c4932")).toBe(true);

    // And card 2's last byte is 0x06 — below 0x10. avrdude prints that as
    // `0x6`, unpadded, which broke record-card.sh's parser on the second
    // card it ever saw. 48% of cards have at least one such byte.
    expect(CARDS[1]!.sernum.endsWith("06")).toBe(true);
  });
});

/**
 * Test serials have to be serials.
 *
 * ══ THE TRAP THAT KEEPS SPRINGING ══
 * Card serials are Crockford base32, which EXCLUDES I, L, O and U — they
 * are the characters people misread as 1, 1, 0 and V. A test serial
 * containing one is rejected on shape before any signature is checked, so
 * the card never registers and the test goes on to assert something about
 * a card that does not exist.
 *
 * Sometimes that fails loudly. Sometimes it PASSES, because the thing
 * being asserted was "this is refused" and it was refused for the wrong
 * reason entirely. Both have happened here, five separate times, across
 * three sittings.
 *
 * So the fixtures are checked rather than remembered. This reads the
 * route tests looking for eight-character upper-case literals — the shape
 * of a serial — and fails on any that could never be one.
 */
import { readFileSync as readSuite } from "node:fs";
import { join as joinSuite } from "node:path";

describe("the serials in the tests", () => {
  it("are all things a real card could be called", () => {
    const src = readSuite(joinSuite(__dirname, "routes.test.ts"), "utf8");
    /*
     * Quoted or interpolated, eight characters, upper-case alphanumeric.
     * Narrow on purpose: it is looking for the serial shape, not for
     * every capitalised string in the file.
     */
    const looksLikeSerial = /["'`]([A-Z0-9]{8})["'`]/g;
    const bad: string[] = [];
    for (const m of src.matchAll(looksLikeSerial)) {
      const serial = m[1]!;
      // A run of digits is a hex token or a counter, not a serial.
      if (/^\d+$/.test(serial)) continue;
      if (/[ILOU]/.test(serial)) bad.push(serial);
    }
    expect(bad, `Crockford base32 excludes I, L, O and U: ${bad.join(", ")}`).toEqual([]);
  });
});
