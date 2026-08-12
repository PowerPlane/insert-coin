// ST25DV04K NDEF digit patching over I2C.
//
// The tag is pre-programmed once by a phone tag-writer with
//   https://davidyang.work/p?d=0&c=XXXXXX
// and this code rewrites only the single ASCII digit at
// NDEF_DIGIT_OFFSET. The per-card `&c=` suffix sits after the digit, so
// it never moves the patch target.
//
// Unlike the production-nfc copy, every write here retries: an RF field
// wins arbitration on the ST25DV, so a phone already resting on the card
// can NACK the write and leave the PREVIOUS visitor's fortune live.

#pragma once

#include <stdint.h>

void ndef_init();
void ndef_deinit();

// Write the fortune digit ('1'..'4'). Returns false if every attempt
// NACKed -- the caller should treat that as "the URL is stale", not as
// success.
bool ndef_patch_fortune(uint8_t fortune);

// Restore '0' (no fortune). Same retry behaviour.
bool ndef_patch_default();
