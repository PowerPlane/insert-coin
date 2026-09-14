/**
 * The flash itself: connect, check the chip, write, verify, set fuses.
 *
 * ══ THE ORDER IS THE SAFETY ══
 * Nothing is written until the chip has said who it is. A wrong chip, a
 * missing coin cell or a loose wire all fail before the first page, and
 * the error copy can honestly say "nothing was written". Once a page has
 * gone in, `touched` is true and the copy changes to "flash it again".
 *
 * Fuses go last, after the flash has verified, so a card that fails part
 * way is at worst a card with old fuses and new code — which still runs.
 *
 * ══ WHAT IS NEVER TOUCHED ══
 * EEPROM (the claim counter), the user row, the lock bits. Page erase and
 * erase-and-write are the only NVM commands used; there is no chip erase.
 * See plan.ts for why.
 *
 * Pure orchestration over the `UpdiLink` interface, so test/flasher-flow
 * runs the whole thing against a fake chip in memory.
 */

import { cardSerial } from "../card/identity.js";
import { planPages, bytesToWrite } from "./plan.js";
import { FUSE_PLAN, SERNUM_LEN, SERNUM_OFFSET, updiPinStaysUpdi, type Target } from "./target.js";

/** What the flow needs from a link. `UpdiApplication` satisfies it. */
export interface UpdiLink {
  init(): Promise<void>;
  readDeviceInfo(): Promise<unknown>;
  enterProgmode(): Promise<boolean>;
  leaveProgmode(): Promise<void>;
  readData(address: number, size: number): Promise<Uint8Array>;
  writeFlashErase(address: number, data: Uint8Array): Promise<void>;
  eraseFlashPage(address: number): Promise<void>;
  writeFuse(address: number, value: number): Promise<void>;
  destroy(): Promise<void>;
}

export type Phase = "connect" | "identify" | "write" | "verify" | "fuses" | "done";

export type FlashEvent =
  | { readonly type: "phase"; readonly phase: Phase }
  | { readonly type: "baud"; readonly baud: number }
  | { readonly type: "chip"; readonly serial: string; readonly deviceId: number }
  | { readonly type: "progress"; readonly phase: "write" | "verify" | "fuses"; readonly done: number; readonly total: number }
  | { readonly type: "log"; readonly text: string };

export type FailCode =
  | "port" // the serial port would not open
  | "no-answer" // no UPDI reply at any baud
  | "locked" // lock bits set; needs a chip erase this page does not do
  | "wrong-chip" // device id is not the target's
  | "write-failed"
  | "verify-failed"
  | "fuse-failed";

export class FlashFailure extends Error {
  constructor(
    readonly code: FailCode,
    readonly phase: Phase,
    /** True once any flash page has been changed. Drives the copy. */
    readonly touched: boolean,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "FlashFailure";
  }
}

export interface FlashResult {
  readonly serial: string;
  readonly deviceId: number;
  readonly baud: number;
  readonly pagesWritten: number;
  readonly pagesErased: number;
  readonly bytes: number;
}

export interface FlashOptions {
  /** Tried in order. megaTinyCore's tuned default first, then the safe one. */
  readonly bauds?: readonly number[];
  /** Bytes per verify read. UPDI repeats up to 256; 128 keeps a margin. */
  readonly verifyChunk?: number;
}

const DEFAULT_BAUDS = [230400, 115200] as const;

/** An error as one line, whatever was thrown. */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function looksLikePortProblem(err: unknown): boolean {
  const m = message(err);
  return /open|InvalidState|NetworkError|already|in use|access denied|writable stream/i.test(m);
}

/**
 * Open a link at each baud in turn until the chip answers a SIB request.
 * A link that did not answer is destroyed before the next is opened, so
 * the port is never held twice.
 */
async function connect(
  open: (baud: number) => Promise<UpdiLink>,
  bauds: readonly number[],
  emit: (e: FlashEvent) => void,
): Promise<{ link: UpdiLink; baud: number }> {
  let last: unknown = null;
  for (const baud of bauds) {
    let link: UpdiLink;
    try {
      link = await open(baud);
    } catch (err) {
      // Nothing was opened, so nothing to release. The port itself is the
      // problem and another baud on it will not help.
      throw new FlashFailure("port", "connect", false, message(err), err);
    }
    // From here the link may hold the port, whatever else goes wrong, so
    // every exit that is not success destroys it first. Otherwise the next
    // baud fails to open with "already open" and the friend is told to
    // close the Arduino IDE when the wire is what is loose.
    try {
      await link.init();
      await link.readDeviceInfo();
      emit({ type: "baud", baud });
      return { link, baud };
    } catch (err) {
      last = err;
      emit({ type: "log", text: `${baud} baud: ${message(err)}` });
      await link.destroy();
      if (looksLikePortProblem(err)) {
        throw new FlashFailure("port", "connect", false, message(err), err);
      }
      // Something answered, and it is a newer AVR family (Dx/Ex). That is a
      // wrong chip, not silence, and another baud will not change it.
      if (/unsupported nvm revision/i.test(message(err))) {
        throw new FlashFailure("wrong-chip", "connect", false, message(err), err);
      }
    }
  }
  throw new FlashFailure("no-answer", "connect", false, message(last), last);
}

export async function flashCard(
  open: (baud: number) => Promise<UpdiLink>,
  image: Uint8Array,
  target: Target,
  emit: (e: FlashEvent) => void,
  options: FlashOptions = {},
): Promise<FlashResult> {
  const bauds = options.bauds ?? DEFAULT_BAUDS;
  const verifyChunk = options.verifyChunk ?? 128;

  // Planned before the port is touched: a bad image fails with nothing open.
  const ops = planPages(image, target);
  // The runtime half of the brick guard in target.ts. A plain Error, not a
  // FlashFailure: this is a mistake in the code, not something at the bench.
  if (!updiPinStaysUpdi()) {
    throw new Error("FUSE_PLAN would stop the UPDI pin being UPDI. Refusing to flash.");
  }

  emit({ type: "phase", phase: "connect" });
  const { link, baud } = await connect(open, bauds, emit);

  let phase: Phase = "identify";
  let touched = false;
  try {
    emit({ type: "phase", phase });
    try {
      await link.enterProgmode();
    } catch (err) {
      const code: FailCode = /locked/i.test(message(err)) ? "locked" : "no-answer";
      throw new FlashFailure(code, phase, false, message(err), err);
    }

    const id = await link.readData(target.sigrowAddress, 3);
    const deviceId = ((id[0] ?? 0) << 16) | ((id[1] ?? 0) << 8) | (id[2] ?? 0);
    if (deviceId !== target.deviceId) {
      throw new FlashFailure(
        "wrong-chip",
        phase,
        false,
        `Device id 0x${deviceId.toString(16).padStart(6, "0")} is not ${target.name}`,
      );
    }
    const sernum = await link.readData(target.sigrowAddress + SERNUM_OFFSET, SERNUM_LEN);
    const serial = cardSerial(sernum);
    emit({ type: "chip", serial, deviceId });

    phase = "write";
    emit({ type: "phase", phase });
    let pagesWritten = 0;
    let pagesErased = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      touched = true;
      try {
        if (op.kind === "write") {
          await link.writeFlashErase(op.address, op.data);
          pagesWritten++;
        } else {
          await link.eraseFlashPage(op.address);
          pagesErased++;
        }
      } catch (err) {
        throw new FlashFailure(
          "write-failed",
          phase,
          touched,
          `Page at 0x${op.address.toString(16)}: ${message(err)}`,
          err,
        );
      }
      emit({ type: "progress", phase, done: i + 1, total: ops.length });
    }

    phase = "verify";
    emit({ type: "phase", phase });
    const { base, size } = target.flash;
    const chunks = Math.ceil(size / verifyChunk);
    for (let c = 0; c < chunks; c++) {
      const offset = c * verifyChunk;
      const len = Math.min(verifyChunk, size - offset);
      const back = await link.readData(base + offset, len);
      for (let k = 0; k < len; k++) {
        if (back[k] !== image[offset + k]) {
          const addr = offset + k;
          throw new FlashFailure(
            "verify-failed",
            phase,
            touched,
            `Address 0x${addr.toString(16)}: wrote 0x${(image[addr] ?? 0).toString(16)}, read 0x${(back[k] ?? 0).toString(16)}`,
          );
        }
      }
      emit({ type: "progress", phase, done: c + 1, total: chunks });
    }

    phase = "fuses";
    emit({ type: "phase", phase });
    for (let i = 0; i < FUSE_PLAN.length; i++) {
      const fuse = FUSE_PLAN[i]!;
      try {
        await link.writeFuse(target.fuses + fuse.offset, fuse.value);
      } catch (err) {
        throw new FlashFailure("fuse-failed", phase, touched, `${fuse.name}: ${message(err)}`, err);
      }
      emit({ type: "progress", phase, done: i + 1, total: FUSE_PLAN.length });
    }
    const span = Math.max(...FUSE_PLAN.map((f) => f.offset)) + 1;
    const fusesBack = await link.readData(target.fuses, span);
    for (const fuse of FUSE_PLAN) {
      const got = fusesBack[fuse.offset] ?? 0;
      if ((got & fuse.verifyMask) !== (fuse.value & fuse.verifyMask)) {
        throw new FlashFailure(
          "fuse-failed",
          phase,
          touched,
          `${fuse.name}: wrote 0x${fuse.value.toString(16)}, read 0x${got.toString(16)}`,
        );
      }
    }

    phase = "done";
    emit({ type: "phase", phase });
    // Leaving programming mode resets the chip, and it boots the new code.
    // If that last exchange fails the card is still fully written and
    // verified, and boots on its next power cycle — so it is a log line,
    // not a failure.
    try {
      await link.leaveProgmode();
    } catch (err) {
      emit({ type: "log", text: `Leaving programming mode: ${message(err)}. The card boots on its next power cycle.` });
    }
    return { serial, deviceId, baud, pagesWritten, pagesErased, bytes: bytesToWrite(ops) };
  } catch (err) {
    // Best effort: let the chip out of programming mode so it can run
    // whatever it has, then give the port back.
    try {
      await link.leaveProgmode();
    } catch {
      /* the link may already be gone */
    }
    if (err instanceof FlashFailure) throw err;
    // A link error (a read timeout, a lost echo) is named by the phase it
    // interrupted, so the copy matches what is actually on the card: a
    // wire slipping during verify is not a half-written card.
    const code: FailCode =
      phase === "write" ? "write-failed"
      : phase === "verify" ? "verify-failed"
      : phase === "fuses" ? "fuse-failed"
      : "no-answer";
    throw new FlashFailure(code, phase, touched, message(err), err);
  } finally {
    await link.destroy();
  }
}
