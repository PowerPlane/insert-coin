/**
 * Turning an image into page operations. Pure, so it is tested without a
 * chip.
 *
 * ══ WHY EVERY PAGE, AND WHY NO CHIP ERASE ══
 * The obvious flow is "chip erase, then write the used pages". Chip erase
 * on a tinyAVR also wipes EEPROM unless the EESAVE fuse is already set,
 * and on a card whose fuses were never written it is not — so one reflash
 * would zero the claim counter that provision.h promises survives.
 *
 * Page operations never touch EEPROM, whatever the fuses say. So the
 * flasher visits every flash page: pages with content get an
 * erase-and-write in one NVM command; pages that are all 0xFF (the erased
 * state) get a plain erase, which clears whatever older firmware left
 * there without sending 64 bytes of nothing down the wire.
 */

import type { Target } from "./target.js";

export type PageOp =
  | { readonly kind: "write"; readonly address: number; readonly data: Uint8Array }
  | { readonly kind: "erase"; readonly address: number };

export function planPages(image: Uint8Array, target: Target): PageOp[] {
  const { base, size, pageSize } = target.flash;
  if (image.length !== size) {
    throw new Error(`Image is ${image.length} bytes, flash is ${size}`);
  }
  const ops: PageOp[] = [];
  for (let offset = 0; offset < size; offset += pageSize) {
    const page = image.subarray(offset, offset + pageSize);
    const blank = page.every((b) => b === 0xff);
    const address = base + offset;
    ops.push(blank ? { kind: "erase", address } : { kind: "write", address, data: page });
  }
  return ops;
}

/** How many bytes of real content the plan carries, for the progress copy. */
export function bytesToWrite(ops: readonly PageOp[]): number {
  return ops.reduce((n, op) => (op.kind === "write" ? n + op.data.length : n), 0);
}
