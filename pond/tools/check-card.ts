/**
 * Check a tapped card's URL. Paste what the phone shows.
 *
 *   npm run cards:check -- "https://ducky.davidyang.work/?d=1&c=0YBSVSVN&g=0000&t=5d29221795"
 *
 * This is step 3 of PROVISIONING.md's per-card ritual, made mechanical. It
 * answers, without a programmer and without unwrapping anything:
 *
 *   * is the serial well-formed,
 *   * and — the one that cannot be seen by eye — was it flashed with the
 *     REAL signing key, or with the all-zero placeholder from
 *     secrets.h.example?
 *
 * That last question matters more than it looks. `eesave = yes` preserves
 * EEPROM across a reflash, so a card provisioned with the placeholder keeps
 * its forgeable token FOREVER: the firmware sees a valid provisioning flag
 * and skips straight past. Re-flashing does not fix it. Only erasing EEPROM
 * does, and by then the card may be in somebody's wallet.
 *
 * Set CARD_SECRET to check against the real key as well.
 */

import { isSerial, verifyClaim } from "../src/card/identity.js";

const input = process.argv[2];
if (!input) {
  console.error('usage: npm run cards:check -- "<the URL the phone showed>"');
  process.exit(1);
}

let url: URL;
try {
  url = new URL(input.trim());
} catch {
  console.error(`Not a URL: ${input}`);
  process.exit(1);
}

const serial = url.searchParams.get("c") ?? "";
const counterHex = url.searchParams.get("g") ?? "";
const token = url.searchParams.get("t") ?? "";
const digit = url.searchParams.get("d") ?? "";

let bad = 0;
const say = (ok: boolean, text: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${text}`);
  if (!ok) bad++;
};

console.log(`\n${url.host}${url.pathname}`);
console.log(`  d=${digit}  c=${serial}  g=${counterHex}  t=${token}\n`);

say(isSerial(serial), `serial ${serial || "(missing)"} is eight Crockford characters`);
say(/^[0-9a-f]{4}$/.test(counterHex), `counter ${counterHex || "(missing)"} is four hex characters`);
say(/^[0-9a-f]{10}$/.test(token), `token ${token || "(missing)"} is ten hex characters`);
say(/^[0-4]$/.test(digit), `fortune digit ${digit || "(missing)"} is 0-4`);

if (bad === 0) {
  const counter = parseInt(counterHex, 16);

  // ── the placeholder check ───────────────────────────────────────────
  // A card flashed before secrets.h was filled in signs with sixteen zero
  // bytes, and its claims are forgeable by anyone who reads the repo.
  const placeholder = verifyClaim(new Uint8Array(16), serial, counter, token);
  say(!placeholder, placeholder
    ? "SIGNED WITH THE ALL-ZERO PLACEHOLDER KEY — this card's claims are forgeable"
    : "not signed with the placeholder key");

  if (placeholder) {
    console.log(`
  Re-flashing will NOT fix it: eesave preserves the provisioning flag, so
  the firmware sees a provisioned card and skips the write. Erase EEPROM
  first, then reflash:

    avrdude -c serialupdi -p t1616 -P <port> -e
`);
  }

  const secret = process.env.CARD_SECRET;
  if (secret && /^[0-9a-fA-F]{32}$/.test(secret)) {
    const key = new Uint8Array((secret.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    say(verifyClaim(key, serial, counter, token), "token verifies against CARD_SECRET");
  } else {
    console.log("  --    set CARD_SECRET to also verify against the real key");
  }
}

console.log(bad === 0 ? "\nThis card is healthy.\n" : `\n${bad} problem(s).\n`);
process.exit(bad === 0 ? 0 : 1);
