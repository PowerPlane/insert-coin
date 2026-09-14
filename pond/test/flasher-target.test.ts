/**
 * The fuse table is platformio.ini in another language. This recomputes it
 * from the ini with the rules platform-atmelmegaavr's builder/fuses.py
 * uses for megaTinyCore, so an edit to either side shows up here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTINY1616, FUSE_PLAN, updiPinStaysUpdi } from "../src/flasher/target.js";

const ini = readFileSync(
  join(__dirname, "..", "..", "variants", "business-card-v1", "firmware", "platformio.ini"),
  "utf8",
);

/** The `[env]` section that every environment inherits. */
function envValue(key: string): string {
  const section = ini.split(/^\[env\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const m = section.match(new RegExp(`^\\s*${key.replace(".", "\\.")}\\s*=\\s*([^;\\n]+)`, "m"));
  if (!m?.[1]) throw new Error(`${key} not in [env]`);
  return m[1].trim().toLowerCase();
}

/** fuses.py, the megatinycore branches, in TypeScript. */
function expectedFuses(): Record<number, number> {
  const fCpu = envValue("board_build.f_cpu");
  const bod = envValue("board_hardware.bod");
  const eesave = envValue("board_hardware.eesave");
  const uart = envValue("board_hardware.uart");
  const bodcfg = { "4.3v": 0xf4, "2.6v": 0x54, "1.8v": 0x14, disabled: 0x00 }[bod];
  if (bodcfg === undefined) throw new Error(`unknown bod ${bod}`);
  const osccfg = ["20000000l", "10000000l", "5000000l"].includes(fCpu) ? 0x02 : 0x01;
  const syscfg0 = 0xc0 | (1 << 2) | (eesave === "yes" ? 1 : 0); // updipin default "updi"
  const bootend = uart === "no_bootloader" ? 0x00 : 0x02;
  return { 0: 0x00, 1: bodcfg, 2: osccfg, 4: 0x00, 5: syscfg0, 6: 0x06, 7: 0x00, 8: bootend };
}

describe("FUSE_PLAN", () => {
  it("is what `pio run -t fuses` would write from platformio.ini", () => {
    const expected = expectedFuses();
    const actual = Object.fromEntries(FUSE_PLAN.map((f) => [f.offset, f.value]));
    expect(actual).toEqual(expected);
  });

  it("keeps the UPDI pin as UPDI, so a card can always be flashed again", () => {
    expect(updiPinStaysUpdi()).toBe(true);
    expect(updiPinStaysUpdi([{ offset: 5, name: "SYSCFG0", value: 0xc1, verifyMask: 0xff, why: "gpio" }])).toBe(false);
  });

  it("keeps EEPROM across a reflash, which the claim counter depends on", () => {
    const syscfg0 = FUSE_PLAN.find((f) => f.offset === 5)!;
    expect(syscfg0.value & 0x01).toBe(1);
    expect(syscfg0.verifyMask & 0x01).toBe(1);
  });

  it("never writes lock bits or reserved fuse bytes", () => {
    const offsets = FUSE_PLAN.map((f) => f.offset);
    expect(offsets).not.toContain(10);
    expect(offsets).not.toContain(3);
    expect(offsets).not.toContain(9);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it("checks every bit it writes that the firmware depends on", () => {
    for (const f of FUSE_PLAN) {
      // A mask that hides a written 1 would let a silent failure through.
      expect((f.value & f.verifyMask) === f.value || f.name === "SYSCFG0").toBe(true);
    }
  });
});

describe("ATTINY1616", () => {
  it("matches the datasheet's memory map", () => {
    expect(ATTINY1616.deviceId).toBe(0x1e9421);
    expect(ATTINY1616.flash).toEqual({ base: 0x8000, size: 16384, pageSize: 64 });
    expect(ATTINY1616.fuses).toBe(0x1280);
    expect(ATTINY1616.sigrowAddress).toBe(0x1100);
    expect(ATTINY1616.nvmctrlAddress).toBe(0x1000);
  });
});
