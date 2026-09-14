/**
 * The one number two people can read to each other over a call.
 *
 * David runs `shared/tools/build-hex.sh` and it prints the SHA-256 of the
 * file it produced. The page prints the SHA-256 of the file that was
 * dropped on it. If the first eight characters agree, it is the same
 * file, whatever it was renamed to on the way.
 */

import { bytesToHex } from "../card/bytes.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copied into a fresh ArrayBuffer: `digest` wants a BufferSource, and a
  // view over a SharedArrayBuffer (which the type allows) is not one.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return bytesToHex(new Uint8Array(digest));
}

/** `4f9c21ab…` as `4f9c 21ab`, the way it is read out loud. */
export function shortDigest(hex: string): string {
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)}`;
}
