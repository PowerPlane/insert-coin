/**
 * Everything the flasher knows about the chip on the card.
 *
 * One chip, on purpose. The ATtiny1616 is what business-card-v1 carries,
 * and a flasher that could be pointed at other parts would need the same
 * checks in more places. If a v2 board changes MCU, add a second target
 * here and make the page choose — do not loosen this one.
 *
 * Addresses come from the ATtiny1616 datasheet (DS40002204, memory map
 * and NVMCTRL chapters) and match `devices.ts` in WebUPDI and the
 * `attiny1616` entry in pymcuprog.
 */

export interface Target {
  readonly name: string;
  /** The three SIGROW.DEVICEID bytes as one number, big-endian. */
  readonly deviceId: number;
  /** SIGROW base. DEVICEID0..2 at +0, SERNUM0..9 at +3. */
  readonly sigrowAddress: number;
  readonly flash: { readonly base: number; readonly size: number; readonly pageSize: number };
  /** FUSE base. Fuse bytes are written one at a time through NVMCTRL. */
  readonly fuses: number;
  /*
   * Named as the vendored stack names them (`UpdiDevice` in
   * serialupdi/nvm.ts), so a Target is handed to `UpdiApplication` as is.
   * A differently named field would not be a type error there — it would
   * be NVM commands written to address 0.
   */
  readonly nvmctrlAddress: number;
  readonly syscfgAddress: number;
}

export const ATTINY1616: Target = {
  name: "ATtiny1616",
  deviceId: 0x1e9421,
  sigrowAddress: 0x1100,
  flash: { base: 0x8000, size: 0x4000, pageSize: 64 },
  fuses: 0x1280,
  nvmctrlAddress: 0x1000,
  syscfgAddress: 0x0f00,
};

/** SIGROW.SERNUM is ten bytes at SIGROW + 3. */
export const SERNUM_OFFSET = 3;
export const SERNUM_LEN = 10;

/**
 * One fuse byte to write, and how to check it afterwards.
 *
 * `verifyMask` exists because a few fuse bytes carry reserved bits, and a
 * reserved bit that reads back differently from what was written is not a
 * failed flash. Everything the firmware depends on is inside the mask.
 */
export interface FuseSpec {
  readonly offset: number;
  readonly name: string;
  readonly value: number;
  readonly verifyMask: number;
  /** One line, in plain words, for the log and the docs. */
  readonly why: string;
}

/**
 * ══ THIS TABLE IS platformio.ini, BYTE FOR BYTE ══
 *
 * PlatformIO's `pio run -t fuses` computes these from the `board_*` lines
 * in variants/business-card-v1/firmware/platformio.ini through
 * platform-atmelmegaavr's builder/fuses.py. The web flasher writes the
 * same bytes so a card flashed by a friend is indistinguishable from one
 * flashed at David's bench.
 *
 *   board_build.f_cpu     = 10000000L   → OSCCFG  0x02 (20 MHz base, /2 in code)
 *   board_hardware.bod    = disabled    → BODCFG  0x00
 *   board_hardware.eesave = yes         → SYSCFG0 bit 0 = 1
 *   board_hardware.uart   = no_bootloader → BOOTEND 0x00, APPEND 0x00
 *   (updipin default)     = updi        → SYSCFG0 bits 3:2 = 01
 *
 * test/flasher-target.test.ts reads platformio.ini and recomputes this
 * table with the same rules, so the two cannot drift apart silently.
 *
 * Not written, on purpose:
 *   - LOCKBIT (offset 10). PlatformIO writes 0xC5 (unlocked), which is
 *     what a chip already is. A write that can only ever be a no-op or a
 *     mistake is left out.
 *   - Offsets 3 and 9 are reserved.
 */
export const FUSE_PLAN: readonly FuseSpec[] = [
  { offset: 0, name: "WDTCFG", value: 0x00, verifyMask: 0xff, why: "watchdog off" },
  { offset: 1, name: "BODCFG", value: 0x00, verifyMask: 0xff, why: "brown-out detector off, the coin cell fades instead of reset-looping" },
  { offset: 2, name: "OSCCFG", value: 0x02, verifyMask: 0x83, why: "20 MHz oscillator; the firmware divides it to 10 MHz" },
  { offset: 4, name: "TCD0CFG", value: 0x00, verifyMask: 0xff, why: "TCD0 defaults, the LED PWM sets it up in code" },
  // Bits 7:6 CRCSRC = 11 (no CRC), bits 3:2 RSTPINCFG = 01 (pin stays UPDI),
  // bit 0 EESAVE = 1 (EEPROM survives reflash, so the claim counter does).
  // Bits 5:4 and 1 are reserved and left out of the check.
  { offset: 5, name: "SYSCFG0", value: 0xc5, verifyMask: 0xcd, why: "keep EEPROM on reflash, keep the UPDI pin as UPDI" },
  { offset: 6, name: "SYSCFG1", value: 0x06, verifyMask: 0x07, why: "32 ms start-up time" },
  { offset: 7, name: "APPEND", value: 0x00, verifyMask: 0xff, why: "no application data section" },
  { offset: 8, name: "BOOTEND", value: 0x00, verifyMask: 0xff, why: "no bootloader, the whole flash is the application" },
];

/**
 * ══ THE ONE FUSE THAT CAN BRICK A CARD ══
 * SYSCFG0 bits 3:2 choose what the UPDI pin is. 01 keeps it UPDI; 00 makes
 * it a GPIO and 10 a reset pin, and either needs a 12 V pulse to undo.
 * Asserted here as well as in the test, so a future edit to the table
 * cannot reach the chip without tripping this.
 */
export function updiPinStaysUpdi(plan: readonly FuseSpec[] = FUSE_PLAN): boolean {
  const syscfg0 = plan.find((f) => f.offset === 5);
  return syscfg0 !== undefined && (syscfg0.value & 0x0c) === 0x04;
}
