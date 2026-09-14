/**
 * The parser is the first thing a dropped file meets, so it is the place
 * where "the friend picked the wrong file" turns into a sentence instead
 * of a half-written card.
 */

import { describe, expect, it } from "vitest";
import { HexError, parseIntelHex } from "../src/flasher/hex.js";

const FLASH = 0x4000;

/** Build one Intel HEX record with a correct checksum. */
function rec(type: number, address: number, bytes: number[]): string {
  const fields = [bytes.length, (address >> 8) & 0xff, address & 0xff, type, ...bytes];
  const sum = fields.reduce((a, b) => a + b, 0);
  const check = (-sum) & 0xff;
  return ":" + [...fields, check].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}
const EOF = rec(1, 0, []);

describe("parseIntelHex", () => {
  it("fills the image, remembers the extent, pads with 0xFF", () => {
    const text = [rec(0, 0x0000, [1, 2, 3, 4]), rec(0, 0x0100, [9]), EOF].join("\n");
    const { image, used, records } = parseIntelHex(text, FLASH);
    expect(image.length).toBe(FLASH);
    expect([...image.subarray(0, 5)]).toEqual([1, 2, 3, 4, 0xff]);
    expect(image[0x100]).toBe(9);
    expect(image[0x101]).toBe(0xff);
    expect(used).toBe(0x101);
    expect(records).toBe(2);
  });

  it("tolerates CRLF, blank lines and trailing whitespace", () => {
    const text = rec(0, 0, [7]) + "  \r\n\r\n" + EOF + "\r\n";
    expect(parseIntelHex(text, FLASH).image[0]).toBe(7);
  });

  it("rejects a bad checksum as a damaged file", () => {
    const bad = rec(0, 0, [1, 2]).slice(0, -2) + "00";
    expect(() => parseIntelHex([bad, EOF].join("\n"), FLASH)).toThrow(/checksum/);
  });

  it("rejects a file cut short", () => {
    expect(() => parseIntelHex(rec(0, 0, [1]), FLASH)).toThrow(/cut short/);
  });

  it("rejects a file with nothing in it", () => {
    expect(() => parseIntelHex(EOF, FLASH)).toThrow(/no data/);
    expect(() => parseIntelHex("", FLASH)).toThrow(HexError);
  });

  it("rejects data past the end of flash, which is what an EEPROM section looks like", () => {
    // avr-objcopy puts .eeprom at 0x810000: a type 04 record of 0x0081.
    const eep = [rec(4, 0, [0x00, 0x81]), rec(0, 0, [1, 2]), EOF].join("\n");
    expect(() => parseIntelHex(eep, FLASH)).toThrow(/past the end of flash/);
    const big = [rec(0, FLASH - 1, [1, 2]), EOF].join("\n");
    expect(() => parseIntelHex(big, FLASH)).toThrow(/past the end/);
  });

  it("applies extended linear and segment addresses that stay in range", () => {
    const seg = [rec(2, 0, [0x00, 0x10]), rec(0, 0x0004, [5]), EOF].join("\n"); // 0x1000 << 4 = 0x100
    expect(parseIntelHex(seg, FLASH).image[0x104]).toBe(5);
    const lin = [rec(4, 0, [0x00, 0x00]), rec(0, 0x0200, [6]), EOF].join("\n");
    expect(parseIntelHex(lin, FLASH).image[0x200]).toBe(6);
  });

  it("rejects an extended linear address of 0x8000 or more instead of dropping the data", () => {
    // `0x8000 << 16` is negative in JavaScript; a negative typed-array index
    // is a silent no-op, so this used to parse as an all-0xFF image.
    const text = [rec(4, 0, [0x80, 0x00]), rec(0, 0, [1, 2]), EOF].join("\n");
    expect(() => parseIntelHex(text, FLASH)).toThrow(/past the end of flash/);
  });

  it("rejects two records that disagree about a byte", () => {
    const text = [rec(0, 0, [1]), rec(0, 0, [2]), EOF].join("\n");
    expect(() => parseIntelHex(text, FLASH)).toThrow(/rewrites/);
  });

  it("rejects garbage, and says which line", () => {
    const text = [rec(0, 0, [1]), "hello", EOF].join("\n");
    try {
      parseIntelHex(text, FLASH);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HexError);
      expect((err as HexError).line).toBe(2);
    }
  });

  it("rejects a length byte that lies", () => {
    const lie = ":03" + rec(0, 0, [1, 2]).slice(3);
    expect(() => parseIntelHex([lie, EOF].join("\n"), FLASH)).toThrow(/says 3 bytes/);
  });

  it("stops at end-of-file and refuses anything after it", () => {
    const text = [rec(0, 0, [1]), EOF, rec(0, 4, [2])].join("\n");
    expect(() => parseIntelHex(text, FLASH)).toThrow(/after the end-of-file/);
  });
});
