import { describe, expect, it } from "vitest";
import { bytesToWrite, planPages } from "../src/flasher/plan.js";
import { ATTINY1616 } from "../src/flasher/target.js";

const { base, size, pageSize } = ATTINY1616.flash;

describe("planPages", () => {
  it("visits every page: content gets erase-and-write, blank pages a plain erase", () => {
    const image = new Uint8Array(size).fill(0xff);
    image[0] = 0x12; // page 0
    image[pageSize * 3 + 5] = 0x34; // page 3
    const ops = planPages(image, ATTINY1616);
    expect(ops.length).toBe(size / pageSize);
    expect(ops[0]).toMatchObject({ kind: "write", address: base });
    expect(ops[1]).toMatchObject({ kind: "erase", address: base + pageSize });
    expect(ops[3]).toMatchObject({ kind: "write", address: base + pageSize * 3 });
    expect(ops.filter((o) => o.kind === "write").length).toBe(2);
    expect(bytesToWrite(ops)).toBe(pageSize * 2);
  });

  it("writes pages exactly as the image has them, 0xFF padding included", () => {
    const image = new Uint8Array(size).fill(0xff);
    image[7] = 1;
    const op = planPages(image, ATTINY1616)[0]!;
    expect(op.kind).toBe("write");
    if (op.kind === "write") {
      expect(op.data.length).toBe(pageSize);
      expect(op.data[7]).toBe(1);
      expect(op.data[8]).toBe(0xff);
    }
  });

  it("refuses an image that is not exactly the flash size", () => {
    expect(() => planPages(new Uint8Array(10), ATTINY1616)).toThrow(/flash is/);
  });
});
