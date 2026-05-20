// One-byte NDEF patch over I2C to the ST25DV04K NFC tag.
//
// The tag is pre-programmed once via a phone NFC-writer app with the
// placeholder URL "https://davidyang.work/?d=0". The MCU's only NDEF
// job is to overwrite the trailing ASCII digit so the next phone scan
// picks up a fortune-coded URL ("?d=1".."?d=4"), then later reset it
// back to "?d=0" (no ducky) after NDEF_EXPIRY_SECONDS.
//
// One I2C transaction = 4 bytes on the wire + ~5 ms EEPROM wait. No
// external pull-ups on PB0/PB1 -- the implementation enables the AVR's
// internal pull-ups and slows SCL to ~25 kHz to keep rise time
// comfortable on the 1-2 cm trace.
//
// All public functions are best-effort: failures (NACK from the tag,
// concurrent RF session) return false and the caller continues. A
// failed patch leaves the previous URL byte intact -- worst case the
// website shows the wrong (or no) ducky for this round.

#pragma once

#include <stdint.h>

// Configure pins for I2C and start TWI at NFC_I2C_CLOCK_HZ.
void ndef_init();

// Release TWI and leave the pins in a low-leak state for the next sleep.
void ndef_deinit();

// fortune is 0..3 (FORTUNE_GREAT..FORTUNE_BAD); writes ASCII '1'..'4'.
// Returns true if the I2C ACK + EEPROM write window completed cleanly.
bool ndef_patch_fortune(uint8_t fortune);

// Resets the digit to ASCII '0', i.e. the "no ducky" default URL.
bool ndef_patch_default();
