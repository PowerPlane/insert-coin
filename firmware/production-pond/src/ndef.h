// ST25DV04K NDEF digit patching over I2C.
//
// The tag is pre-programmed once by a phone tag-writer with
//   https://ducky.davidyang.work/?d=0&c=XXXXXXXX
// and this code rewrites only the single ASCII digit at
// NDEF_DIGIT_OFFSET. The per-card `&c=` suffix sits after the digit, so
// it never moves the patch target.
//
// Unlike the production-nfc copy, every write here retries: an RF field
// wins arbitration on the ST25DV, so a phone already resting on the card
// can NACK the write and leave the PREVIOUS visitor's fortune live.

#pragma once

#include <stddef.h>
#include <stdint.h>

void ndef_init();
void ndef_deinit();

// Write the fortune digit ('1'..'4'). Returns false if every attempt
// NACKed -- the caller should treat that as "the URL is stale", not as
// success.
bool ndef_patch_fortune(uint8_t fortune);

// Restore '0' (no fortune). Same retry behaviour.
bool ndef_patch_default();

// ── Whole-record write, for first-boot provisioning ─────────────────────
//
// The card writes its own record now, instead of a phone tag-writer doing
// it and the MCU patching one byte. 68 bytes at NDEF_EEPROM_WRITE_MS is
// ~408 ms, once, on the first boot that succeeds.
//
// Byte at a time, reusing the same retry wrapper the digit patch uses,
// because that path is already proved against the ST25DV's RF-wins-
// arbitration behaviour. Page writes would be several times faster and are
// worth doing AFTER two cards work, not before.
bool ndef_write_record(const uint8_t *record, size_t len);

// Write `len` bytes at `addr`, using the same retry wrapper as everything
// else here. Arming rewrites two short spans in place — the claim counter
// and its token — rather than the whole record, because that happens with
// a person waiting rather than once on a bench: fourteen bytes is ~84 ms
// against ~408 ms.
//
// Returns false on the first byte that will not take, leaving the record
// half-written. The caller must treat that as "not armed" and not tell
// anyone it worked.
bool ndef_write_span(uint16_t addr, const uint8_t *data, size_t len);

// Read `len` bytes back from the start of user memory, so the write can be
// compared against what was meant. This is the difference between a card
// that verified and a card that believes it did.
bool ndef_read_record(uint8_t *out, size_t len);
