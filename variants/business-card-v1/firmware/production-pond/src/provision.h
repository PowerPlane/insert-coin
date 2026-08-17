// Giving the card its identity, once, on the first boot that succeeds.
//
// ══ THIS IS A STATE MACHINE, NOT A SCRIPT ══
//
//   UNPROVISIONED ──write record──► WRITTEN ──readback ok──► PROVISIONED
//         ▲                            │
//         └────────── mismatch ────────┘
//
// The failure this shape exists for: a low battery or a bad solder joint on
// the I2C lines and the record is never written, so the card ships blank
// and nobody finds out until somebody taps it and gets nothing.
//
// So the flag is only set after the record has been read BACK off the tag
// and compared byte for byte. A card that fails verification stays
// unprovisioned and tries again on the next power-up, which costs nothing
// because the coin cell is pulled between shows anyway.
//
// And the flag is a versioned magic plus a CRC rather than one byte: a
// single byte can be corrupted mid-write into something that happens to
// look provisioned, stranding a card with a half-written record and no way
// to notice. See card_provision_t in shared/firmware/card-identity/.

#pragma once

#include <stdbool.h>
#include <stdint.h>

// Where the provisioning record lives in the MCU's own EEPROM. Address 0
// is fine — nothing else in this firmware uses EEPROM, and
// `board_hardware.eesave = yes` means a reflash does not erase it, so a
// card keeps its claim counter across firmware updates.
constexpr uint16_t PROVISION_EEPROM_ADDR = 0;

// Read the flag, and write the record if it is missing or untrustworthy.
//
// Returns true if the card is provisioned when this returns — either
// because it already was, or because the write verified just now.
//
// Safe to call on every boot. It costs one EEPROM read when the card is
// already done, which is the case for every boot after the first.
bool provision_ensure();

// True once provision_ensure() has confirmed an identity this boot.
bool provision_ok();

// The card's serial, as eight characters plus a NUL. Empty until
// provision_ensure() has run and succeeded.
const char *provision_serial();

// ── The claim counter ───────────────────────────────────────────────────
//
// The number in `&g=`. It only ever goes up, and it only goes up when the
// four-blow gesture succeeds — which is the whole reason a claim proves
// possession. The server accepts a claim strictly ABOVE the highest it has
// seen for this card, so a URL read over somebody's shoulder is already
// spent by the time they try it.
//
// Kept in the same sealed EEPROM record as the provisioning flag, so a
// reflash does not reset it (`board_hardware.eesave = yes`) and a partial
// write fails closed rather than rolling the card back to a counter the
// server has already retired.

// The counter as it currently stands. 0 on an unprovisioned card, which is
// the value the server never accepts.
uint16_t provision_counter();

// Advance the counter and persist it. Returns the NEW value, or 0 if the
// card is not provisioned or the record could not be written — 0 is not a
// claimable counter, so a failure cannot arm anything.
uint16_t provision_bump_counter();
