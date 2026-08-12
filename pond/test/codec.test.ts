import { describe, expect, it } from "vitest";
import {
  CELLS,
  PACKED_BYTES,
  clampPaintValue,
  decodePaint,
  encodePaint,
} from "../src/client/codec";

// atob/btoa exist in Workers and browsers; give Node the same surface.
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
  globalThis.atob = (s: string) => Buffer.from(s, "base64").toString("binary");
}

const filled = (fn: (i: number) => number) => {
  const c = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) c[i] = fn(i) & 0x0f;
  return c;
};

describe("paint codec", () => {
  it("round-trips every nibble value", () => {
    const cells = filled((i) => i % 16);
    expect(decodePaint(encodePaint(cells))).toEqual(cells);
  });

  it("encodes an untouched layer as empty, not 384 zeroes", () => {
    expect(encodePaint(new Uint8Array(CELLS))).toBe("");
  });

  it("stays within the size the schema allows", () => {
    // ducks.paint has CHECK (length(paint) <= 512); this is the real budget.
    const worst = encodePaint(filled(() => 15));
    expect(worst.length).toBe(Math.ceil(PACKED_BYTES / 3) * 4);
    expect(worst.length).toBeLessThanOrEqual(512);
  });

  it("survives corrupt input instead of throwing", () => {
    // One malformed row must not take the pond down for everyone else.
    for (const bad of ["", "!!!!", "AAA", "x".repeat(1000), null, undefined]) {
      expect(decodePaint(bad as string)).toEqual(new Uint8Array(CELLS));
    }
  });

  it("rejects a wrong-length cell array rather than writing a short blob", () => {
    expect(() => encodePaint(new Uint8Array(10))).toThrow(RangeError);
  });

  it("clamps anything a UI could hand it", () => {
    expect(clampPaintValue(-3)).toBe(0);
    expect(clampPaintValue(99)).toBe(15);
    expect(clampPaintValue(NaN)).toBe(0);
    expect(clampPaintValue(7.9)).toBe(7);
  });
});
