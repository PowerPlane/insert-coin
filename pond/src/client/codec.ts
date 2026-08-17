/**
 * The paint layer's wire format.
 *
 * A duck's decoration is a 24×24 overlay on top of the base sprite. The base
 * sprite is CODE, not data — `fortune` picks one of four shapes that ship
 * with the site — so the only thing stored per duck is what the person
 * actually painted.
 *
 *   24 × 24            = 576 cells
 *   4 bits per cell    = 16 values (0 = unpainted, 1–15 = palette index)
 *   576 / 2            = 288 bytes
 *   base64             = 384 characters
 *
 * Two cells per byte, high nibble first, row-major. Deliberately boring:
 * no compression, no versioning games, no vendor types. Moving this to a
 * machine under a desk should be a dump and a hostname change.
 */

export const GRID = 24;
export const CELLS = GRID * GRID;
export const PACKED_BYTES = CELLS / 2; // 288
export const MAX_PALETTE = 15;

/** Pack a 576-cell nibble array into base64. Empty paint encodes as "". */
export function encodePaint(cells: Uint8Array): string {
  if (cells.length !== CELLS) throw new RangeError(`paint must be ${CELLS} cells`);

  // An untouched layer is the common case — store nothing rather than 384
  // characters of zeroes.
  let any = false;
  for (let i = 0; i < CELLS; i++) {
    if (cells[i]) {
      any = true;
      break;
    }
  }
  if (!any) return "";

  const bytes = new Uint8Array(PACKED_BYTES);
  for (let i = 0; i < PACKED_BYTES; i++) {
    const hi = (cells[i * 2] ?? 0) & 0x0f;
    const lo = (cells[i * 2 + 1] ?? 0) & 0x0f;
    bytes[i] = (hi << 4) | lo;
  }

  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Unpack base64 back into cells.
 *
 * Tolerant on purpose: a corrupt or truncated blob yields an empty layer
 * rather than throwing, because one bad row must not take the whole pond
 * down for everyone looking at it.
 */
export function decodePaint(b64: string | null | undefined): Uint8Array {
  const cells = new Uint8Array(CELLS);
  if (!b64) return cells;

  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return cells;
  }
  if (bin.length !== PACKED_BYTES) return cells;

  for (let i = 0; i < PACKED_BYTES; i++) {
    const byte = bin.charCodeAt(i);
    cells[i * 2] = (byte >> 4) & 0x0f;
    cells[i * 2 + 1] = byte & 0x0f;
  }
  return cells;
}

/** Clamp any value a UI might produce into the storable range. */
export function clampPaintValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n < 0 ? 0 : n > MAX_PALETTE ? MAX_PALETTE : n;
}
