/**
 * The host half of a card's identity.
 *
 * ══ THIS IS A SECOND IMPLEMENTATION, ON PURPOSE AND UNDER PROTEST ══
 * `shared/firmware/card-identity/card_identity.c` derives these same values
 * on the ATtiny1616 as it writes its own tag. This file derives them again,
 * in TypeScript, because the flashing script has to record the serial and
 * the server has to verify the claim, and neither can run AVR C.
 *
 * Two implementations of one derivation is the single most dangerous thing
 * in Phase 2. If they disagree by one bit of ordering, EVERY card is unknown
 * to the server at once — and it fails silently, because an unknown serial
 * is designed to degrade rather than error. The visitor still gets their
 * fortune; the duck is simply unattributed, on all hundred cards, forever.
 *
 * So neither side is tested against the other. Both are tested against
 * `shared/firmware/card-identity/card-identity.json`, which is GENERATED
 * from the C and consumed by `test/card-identity.test.ts`. Change the spec
 * and this file goes red until it is brought back into step — which is the
 * entire reason the file exists.
 */

/** 64-bit arithmetic, so BigInt rather than number. */
const MASK64 = (1n << 64n) - 1n;
const MASK40 = (1n << 40n) - 1n;

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function load64le(bytes: Uint8Array, offset: number): bigint {
  let out = 0n;
  for (let i = 7; i >= 0; i--) out = (out << 8n) | BigInt(bytes[offset + i] ?? 0);
  return out;
}

/**
 * SipHash-2-4.
 *
 * Verified against the reference implementation's own 64-message vector
 * set, the same ones `test_card_identity.c` uses — so the two ports are
 * each checked against the standard before they are checked against each
 * other's framing.
 */
export function siphash24(key: Uint8Array, msg: Uint8Array): bigint {
  const k0 = load64le(key, 0);
  const k1 = load64le(key, 8);

  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;

  const round = (): void => {
    v0 = (v0 + v1) & MASK64;
    v1 = rotl(v1, 13n);
    v1 ^= v0;
    v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK64;
    v3 = rotl(v3, 16n);
    v3 ^= v2;
    v0 = (v0 + v3) & MASK64;
    v3 = rotl(v3, 21n);
    v3 ^= v0;
    v2 = (v2 + v1) & MASK64;
    v1 = rotl(v1, 17n);
    v1 ^= v2;
    v2 = rotl(v2, 32n);
  };

  const left = msg.length & 7;
  const end = msg.length - left;

  for (let i = 0; i < end; i += 8) {
    const m = load64le(msg, i);
    v3 ^= m;
    round();
    round();
    v0 ^= m;
  }

  // The length rides in the top byte of the final block; without it, two
  // messages differing only in trailing zeros would collide.
  let b = (BigInt(msg.length) << 56n) & MASK64;
  for (let i = 0; i < left; i++) b |= BigInt(msg[end + i] ?? 0) << BigInt(8 * i);

  v3 ^= b;
  round();
  round();
  v0 ^= b;

  v2 ^= 0xffn;
  round();
  round();
  round();
  round();

  return (v0 ^ v1 ^ v2 ^ v3) & MASK64;
}

/**
 * Domain separation, and PUBLIC — printing it costs nothing. It exists so
 * the serial derivation and the claim token can never produce related
 * values. Sixteen bytes: "ducky.serial.v1" and a NUL.
 */
export const SERIAL_KEY = new Uint8Array([
  ...new TextEncoder().encode("ducky.serial.v1"),
  0x00,
]);

/** No I, L, O or U — a serial gets read off a screen and typed by a person. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SERIAL_LEN = 8;
export const TOKEN_LEN = 10;
export const COUNTER_LEN = 4;

/** Most significant group first. Eight groups of five bits is exactly forty. */
export function crockford40(value: bigint): string {
  let out = "";
  for (let i = 0; i < SERIAL_LEN; i++) {
    const shift = BigInt(5 * (SERIAL_LEN - 1 - i));
    out += CROCKFORD[Number((value >> shift) & 0x1fn)];
  }
  return out;
}

/**
 * The card's serial, from all ten bytes of SIGROW.SERNUM.
 *
 * All ten, not a slice: a hundred cards from one reel share a lot number,
 * so any fixed 40-bit window is partly constant across the batch and the
 * "4 in a billion" collision estimate would not have been true of it. The
 * `reel sibling` vectors in the spec file are two chips one die coordinate
 * apart, and their serials are unrelated.
 */
export function cardSerial(sernum: Uint8Array): string {
  if (sernum.length !== 10) throw new Error("SERNUM is ten bytes");
  return crockford40(siphash24(SERIAL_KEY, sernum) & MASK40);
}

/** Four lowercase hex characters — the `&g=` in the tag URL. */
export function counterHex(counter: number): string {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff) {
    throw new Error("the claim counter is 16-bit");
  }
  return counter.toString(16).padStart(COUNTER_LEN, "0");
}

/**
 * The claim token.
 *
 * The message is pinned exactly — the eight ASCII serial characters, then
 * the counter as two bytes LITTLE-ENDIAN, ten bytes with no separator and
 * no NUL — because it is precisely the sort of detail two implementations
 * would each guess differently and never find out.
 */
export function cardToken(secret: Uint8Array, serial: string, counter: number): string {
  if (secret.length !== 16) throw new Error("the firmware secret is 16 bytes");
  if (serial.length !== SERIAL_LEN) throw new Error("a serial is eight characters");
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff) {
    throw new Error("the claim counter is 16-bit");
  }

  const msg = new Uint8Array(SERIAL_LEN + 2);
  for (let i = 0; i < SERIAL_LEN; i++) msg[i] = serial.charCodeAt(i);
  msg[SERIAL_LEN] = counter & 0xff;
  msg[SERIAL_LEN + 1] = (counter >> 8) & 0xff;

  const t = siphash24(secret, msg) & MASK40;
  return t.toString(16).padStart(TOKEN_LEN, "0");
}

/** A serial as it may appear in a URL or a CSV. Shape only — not existence. */
export function isSerial(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === SERIAL_LEN &&
    [...value].every((c) => CROCKFORD.includes(c))
  );
}

/**
 * Verify a claim.
 *
 * Constant-time on the token comparison, because a fast reject leaks which
 * prefix was right and the token is only 40 bits — a byte-at-a-time oracle
 * would make it forgeable in a few thousand requests.
 *
 * The counter check is the caller's job: a claim is accepted only when the
 * token verifies AND the counter exceeds the highest seen for that card.
 * Both, never either.
 */
export function verifyClaim(
  secret: Uint8Array,
  serial: string,
  counter: number,
  token: string,
): boolean {
  if (!isSerial(serial)) return false;
  if (typeof token !== "string" || token.length !== TOKEN_LEN) return false;
  const expected = cardToken(secret, serial, counter);
  let diff = 0;
  for (let i = 0; i < TOKEN_LEN; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
