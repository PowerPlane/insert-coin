/**
 * Bytes as lowercase hex. Shared by the session HMAC and the flasher's
 * file digest so the two cannot drift into different spellings.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
