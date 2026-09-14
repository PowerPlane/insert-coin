/**
 * The whole flash against a chip made of arrays.
 *
 * The fake is strict where the real chip is: pages must be aligned, reads
 * must land in a memory it has, EEPROM records every write so the test can
 * prove there were none.
 */

import { describe, expect, it } from "vitest";
import { cardSerial } from "../src/card/identity.js";
import { FlashFailure, flashCard, type FlashEvent, type UpdiLink } from "../src/flasher/flasher.js";
import { ATTINY1616, FUSE_PLAN } from "../src/flasher/target.js";

const T = ATTINY1616;
const SERNUM = new Uint8Array([0x1e, 0x93, 0x21, 0x04, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa]);

interface FakeOptions {
  answersAt?: number[]; // bauds the chip replies at; default all
  deviceId?: number;
  locked?: boolean;
  corruptAfterWrite?: number; // flash offset to flip after the write phase
  fuseStuck?: number; // fuse offset that ignores writes
  failPageAt?: number; // flash address whose write throws
  portBusy?: boolean;
  initThrowsAt?: number[]; // bauds where init() (the UPDI break) fails
  leaveThrows?: boolean;
  newerFamily?: boolean; // answers the SIB as an AVR Dx (NVM P:2)
  readDiesInVerify?: boolean; // the link drops once verification starts
}

class FakeChip {
  flash = new Uint8Array(T.flash.size);
  eeprom = new Uint8Array(256).fill(0xaa);
  eepromWrites = 0;
  fuses = new Uint8Array(11).fill(0);
  opened: number[] = [];
  destroyed = 0;
  progmode = false;
  /** Pages still to write; 0 once the write phase has finished. */
  progmodeWrites = T.flash.size / T.flash.pageSize;

  constructor(readonly opts: FakeOptions = {}) {
    // Old firmware in every page, so an untouched page is detectable.
    for (let i = 0; i < this.flash.length; i++) this.flash[i] = (i * 7) & 0xff;
    this.fuses.set([0x00, 0x00, 0x02, 0x00, 0x00, 0xf6, 0x07, 0x00, 0x00, 0x00, 0xc5]);
  }

  link(baud: number): UpdiLink {
    const chip = this;
    if (chip.opts.portBusy) throw new Error("Failed to open serial port.");
    chip.opened.push(baud);
    const answers = chip.opts.answersAt ?? [baud];
    const id = chip.opts.deviceId ?? T.deviceId;
    return {
      async init() {
        if (chip.opts.initThrowsAt?.includes(baud)) throw new Error("UPDI initialisation failed");
      },
      async readDeviceInfo() {
        if (!answers.includes(baud)) throw new Error("Failed to read device info.");
        if (chip.opts.newerFamily) throw new Error("Unsupported NVM revision P:2");
        return { family: "tinyAVR", NVM: "0" };
      },
      async enterProgmode() {
        if (chip.opts.locked) throw new Error("Failed to enter NVM programming mode: device is locked");
        chip.progmode = true;
        return true;
      },
      async leaveProgmode() {
        chip.progmode = false;
        if (chip.opts.leaveThrows) throw new Error("No echo received for UPDI command");
      },
      async readData(address, size) {
        if (address >= T.sigrowAddress && address + size <= T.sigrowAddress + 0x40) {
          const sigrow = new Uint8Array(0x40);
          sigrow.set([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff], 0);
          sigrow.set(SERNUM, 3);
          return sigrow.slice(address - T.sigrowAddress, address - T.sigrowAddress + size);
        }
        if (address >= T.flash.base && address + size <= T.flash.base + T.flash.size) {
          if (chip.opts.readDiesInVerify && !chip.progmodeWrites) throw new Error("Read timeout");
          const off = address - T.flash.base;
          return chip.flash.slice(off, off + size);
        }
        if (address >= T.fuses && address + size <= T.fuses + 11) {
          return chip.fuses.slice(address - T.fuses, address - T.fuses + size);
        }
        throw new Error(`fake: read outside any memory 0x${address.toString(16)}`);
      },
      async writeFlashErase(address, data) {
        if (!chip.progmode) throw new Error("fake: not in programming mode");
        const off = address - T.flash.base;
        if (off % T.flash.pageSize !== 0 || data.length !== T.flash.pageSize) throw new Error("fake: unaligned page");
        if (chip.opts.failPageAt === address) throw new Error("NVM error");
        chip.flash.set(data, off);
        chip.progmodeWrites--;
      },
      async eraseFlashPage(address) {
        if (!chip.progmode) throw new Error("fake: not in programming mode");
        const off = address - T.flash.base;
        if (off % T.flash.pageSize !== 0) throw new Error("fake: unaligned page");
        chip.flash.fill(0xff, off, off + T.flash.pageSize);
        chip.progmodeWrites--;
        if (chip.opts.corruptAfterWrite !== undefined && off === T.flash.size - T.flash.pageSize) {
          const at = chip.opts.corruptAfterWrite;
          chip.flash[at] = (chip.flash[at] ?? 0) ^ 0x01;
        }
      },
      async writeFuse(address, value) {
        const off = address - T.fuses;
        if (off < 0 || off > 10) throw new Error("fake: not a fuse");
        if (chip.opts.fuseStuck === off) return;
        chip.fuses[off] = value;
      },
      async destroy() {
        chip.destroyed++;
      },
    };
  }
}

function image(): Uint8Array {
  const img = new Uint8Array(T.flash.size).fill(0xff);
  for (let i = 0; i < 3000; i++) img[i] = (i * 13 + 1) & 0xff;
  img[0x2000] = 0x42;
  return img;
}

async function run(chip: FakeChip, opts = {}) {
  const events: FlashEvent[] = [];
  const result = await flashCard((b) => Promise.resolve(chip.link(b)), image(), T, (e) => events.push(e), opts);
  return { events, result };
}

async function fails(chip: FakeChip): Promise<{ failure: FlashFailure; events: FlashEvent[] }> {
  const events: FlashEvent[] = [];
  try {
    await flashCard((b) => Promise.resolve(chip.link(b)), image(), T, (e) => events.push(e));
  } catch (err) {
    if (err instanceof FlashFailure) return { failure: err, events };
    throw err;
  }
  throw new Error("expected a FlashFailure");
}

describe("flashCard", () => {
  it("writes the image, verifies it, sets the fuses, and leaves EEPROM alone", async () => {
    const chip = new FakeChip();
    const { events, result } = await run(chip);

    expect([...chip.flash]).toEqual([...image()]);
    expect(chip.eepromWrites).toBe(0);
    expect([...chip.eeprom]).toEqual(new Array(256).fill(0xaa));
    for (const f of FUSE_PLAN) expect(chip.fuses[f.offset]).toBe(f.value);
    expect(chip.fuses[10]).toBe(0xc5); // lock bits untouched
    expect(chip.progmode).toBe(false);
    expect(chip.destroyed).toBe(1);

    expect(result.serial).toBe(cardSerial(SERNUM));
    expect(result.deviceId).toBe(T.deviceId);
    expect(result.baud).toBe(230400);
    expect(result.pagesWritten + result.pagesErased).toBe(T.flash.size / T.flash.pageSize);
    expect(result.pagesWritten).toBe(Math.ceil(3000 / 64) + 1);

    const phases = events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase);
    expect(phases).toEqual(["connect", "identify", "write", "verify", "fuses", "done"]);
    const chipEvent = events.find((e) => e.type === "chip");
    expect(chipEvent).toMatchObject({ serial: cardSerial(SERNUM) });
    const last = events.filter((e) => e.type === "progress" && e.phase === "write").at(-1);
    expect(last).toMatchObject({ done: 256, total: 256 });
  });

  it("falls back to 115200 when 230400 gets no answer, and gives the port back in between", async () => {
    const chip = new FakeChip({ answersAt: [115200] });
    const { result } = await run(chip);
    expect(chip.opened).toEqual([230400, 115200]);
    expect(result.baud).toBe(115200);
    expect(chip.destroyed).toBe(2);
  });

  it("releases a link whose init() failed before trying the next baud", async () => {
    // The real stack fails in init() (the break and datalink check), not in
    // readDeviceInfo(). A leaked port makes the second open fail with
    // "already open", which used to be reported as a busy port.
    const chip = new FakeChip({ initThrowsAt: [230400] });
    const { result } = await run(chip);
    expect(result.baud).toBe(115200);
    expect(chip.destroyed).toBe(2);
  });

  it("treats a failure while leaving programming mode as a log line, not a failure", async () => {
    const chip = new FakeChip({ leaveThrows: true });
    const { events, result } = await run(chip);
    expect(result.serial).toBe(cardSerial(SERNUM));
    expect([...chip.flash]).toEqual([...image()]);
    expect(events.some((e) => e.type === "log" && /power cycle/.test(e.text))).toBe(true);
  });

  it("gives up with no-answer when no baud works, touching nothing", async () => {
    const chip = new FakeChip({ answersAt: [] });
    const { failure } = await fails(chip);
    expect(failure.code).toBe("no-answer");
    expect(failure.touched).toBe(false);
    expect(chip.flash[0]).toBe(0);
  });

  it("refuses a chip that is not an ATtiny1616 before writing anything", async () => {
    const chip = new FakeChip({ deviceId: 0x1e9422 });
    const { failure } = await fails(chip);
    expect(failure.code).toBe("wrong-chip");
    expect(failure.touched).toBe(false);
    expect(failure.message).toContain("0x1e9422");
    expect(chip.flash[1]).toBe(7);
    expect(chip.fuses[5]).toBe(0xf6);
    expect(chip.progmode).toBe(false);
  });

  it("reports a newer AVR family as the wrong chip, not as silence, and stops at the first baud", async () => {
    const chip = new FakeChip({ newerFamily: true });
    const { failure } = await fails(chip);
    expect(failure.code).toBe("wrong-chip");
    expect(failure.touched).toBe(false);
    expect(chip.opened).toEqual([230400]);
    expect(chip.destroyed).toBe(1);
  });

  it("names a link error by the phase it interrupted, so verify is not called half-written", async () => {
    const chip = new FakeChip({ readDiesInVerify: true });
    const { failure } = await fails(chip);
    expect(failure.phase).toBe("verify");
    expect(failure.code).toBe("verify-failed");
    expect([...chip.flash]).toEqual([...image()]);
  });

  it("reports a locked chip as locked, not as a wiring problem", async () => {
    const { failure } = await fails(new FakeChip({ locked: true }));
    expect(failure.code).toBe("locked");
    expect(failure.touched).toBe(false);
  });

  it("names the port when the port will not open", async () => {
    const { failure } = await fails(new FakeChip({ portBusy: true }));
    expect(failure.code).toBe("port");
  });

  it("reports a page that would not write, and says the card was touched", async () => {
    const { failure } = await fails(new FakeChip({ failPageAt: T.flash.base + 64 }));
    expect(failure.code).toBe("write-failed");
    expect(failure.touched).toBe(true);
    expect(failure.message).toContain("0x8040");
  });

  it("catches a byte that reads back wrong, with its address", async () => {
    const { failure } = await fails(new FakeChip({ corruptAfterWrite: 0x123 }));
    expect(failure.code).toBe("verify-failed");
    expect(failure.phase).toBe("verify");
    expect(failure.message).toContain("0x123");
  });

  it("catches a fuse that did not take, after the code is already on", async () => {
    const chip = new FakeChip({ fuseStuck: 5 });
    const { failure } = await fails(chip);
    expect(failure.code).toBe("fuse-failed");
    expect(failure.message).toContain("SYSCFG0");
    expect([...chip.flash]).toEqual([...image()]);
  });

  it("passes a reserved bit that reads back differently from what was written", async () => {
    const chip = new FakeChip();
    const real = chip.link.bind(chip);
    chip.link = (baud) => {
      const l = real(baud);
      const writeFuse = l.writeFuse;
      l.writeFuse = async (address, value) => {
        // The chip keeps reserved bits 5:4 of SYSCFG0 high, as 0xF6 has them.
        await writeFuse(address, address - T.fuses === 5 ? value | 0x30 : value);
      };
      return l;
    };
    await expect(run(chip)).resolves.toBeTruthy();
  });
});
