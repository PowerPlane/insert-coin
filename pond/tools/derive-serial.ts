/**
 * Derive a card's serial from its raw SIGROW.SERNUM.
 *
 *   npx tsx tools/derive-serial.ts 4132303735310a140700
 *   → 6ZHJ9J0Q
 *
 * Cards register themselves now, so nothing calls this automatically. It
 * stays as a bench tool: given the ten bytes avrdude reads out of a chip,
 * it says which serial that chip WILL claim — which is how you match a
 * board on the programmer to a row in admin before it has ever been
 * tapped, and how you check the host and the firmware still agree.
 *
 * A file rather than a `tsx -e` one-liner because eval'd code resolves as
 * CommonJS, where a `.js` specifier does not map back to the `.ts` file —
 * which fails at exactly the wrong moment, with a card on the programmer.
 */

import { cardSerial } from "../src/card/identity.js";

const hex = (process.argv[2] ?? "").trim().toLowerCase();

if (!/^[0-9a-f]{20}$/.test(hex)) {
  console.error(`expected twenty hex characters of SIGROW.SERNUM, got '${hex}'`);
  process.exit(1);
}

const bytes = new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
process.stdout.write(cardSerial(bytes));
