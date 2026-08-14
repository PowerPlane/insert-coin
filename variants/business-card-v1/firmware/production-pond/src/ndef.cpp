#include "ndef.h"

#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "pins.h"

// Internal pull-ups on PB0/PB1 are nominal ~35 kOhm at 3 V. With ~25 pF
// of trace+pin capacitance to U2 that's ~2 us rise time, out of spec for
// 100 kHz I2C; 25 kHz SCL gives ~10x margin on the data setup window
// without needing external resistors.

void ndef_init() {
    PORTB.PIN0CTRL = PORT_PULLUPEN_bm;  // SCL
    PORTB.PIN1CTRL = PORT_PULLUPEN_bm;  // SDA
    Wire.begin();
    Wire.setClock(NFC_I2C_CLOCK_HZ);
}

void ndef_deinit() {
    Wire.end();
    // Leave PULLUPEN set: lines float to VCC instead of mid-rail, so
    // input Schmitt triggers don't oscillate during the timed nap.
    // sleep_forever() hard-disables both pins for terminal sleep.
}

// One attempt. Returns true only on a fully acknowledged transfer.
static bool ndef_try_write(uint16_t mem_addr, uint8_t value) {
    Wire.beginTransmission(ST25DV_I2C_ADDR_USER);
    Wire.write((uint8_t)(mem_addr >> 8));
    Wire.write((uint8_t)(mem_addr & 0xFF));
    Wire.write(value);
    if (Wire.endTransmission() != 0) return false;
    delay(NDEF_EEPROM_WRITE_MS);
    return true;
}

// Retry wrapper.
//
// The ST25DV arbitrates RF against I2C and RF wins. A visitor who rests
// their phone on the card before the reveal finishes can therefore make
// this write fail -- and because the previous digit stays in EEPROM,
// they would be shown the PREVIOUS person's fortune and could claim a
// duck that isn't theirs. Retrying costs a few bytes of flash and a few
// milliseconds, and closes that entirely for the common case.
static bool ndef_write_byte(uint16_t mem_addr, uint8_t value) {
    for (uint8_t attempt = 0; attempt < NDEF_WRITE_ATTEMPTS; attempt++) {
        if (ndef_try_write(mem_addr, value)) return true;
        delay(NDEF_RETRY_GAP_MS);
    }
    return false;
}

bool ndef_patch_fortune(uint8_t fortune) {
    if (fortune >= FORTUNE_COUNT) return false;
    const uint8_t digit = (uint8_t)('1' + fortune);
    return ndef_write_byte(NDEF_DIGIT_OFFSET, digit);
}

bool ndef_patch_default() {
    return ndef_write_byte(NDEF_DIGIT_OFFSET, (uint8_t)'0');
}

bool ndef_write_record(const uint8_t *record, size_t len) {
    // One byte at a time through the retry wrapper. Slower than a page
    // write and much harder to get subtly wrong: this is the code path
    // already proved against a phone resting on the antenna.
    for (size_t i = 0; i < len; i++) {
        if (!ndef_write_byte(static_cast<uint16_t>(i), record[i])) return false;
    }
    return true;
}

bool ndef_write_span(uint16_t addr, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        if (!ndef_write_byte(static_cast<uint16_t>(addr + i), data[i])) return false;
    }
    return true;
}

bool ndef_read_record(uint8_t *out, size_t len) {
    // Read in chunks: Wire's buffer is smaller than the record, and asking
    // for more than it holds silently truncates.
    constexpr uint8_t CHUNK = 16;
    for (size_t at = 0; at < len; at += CHUNK) {
        const uint8_t want = static_cast<uint8_t>((len - at) < CHUNK ? (len - at) : CHUNK);

        Wire.beginTransmission(ST25DV_I2C_ADDR_USER);
        Wire.write(static_cast<uint8_t>(at >> 8));
        Wire.write(static_cast<uint8_t>(at & 0xFF));
        // No stop: the read that follows re-addresses without releasing.
        if (Wire.endTransmission(false) != 0) return false;

        if (Wire.requestFrom(static_cast<uint8_t>(ST25DV_I2C_ADDR_USER), want) != want) {
            return false;
        }
        for (uint8_t i = 0; i < want; i++) {
            if (!Wire.available()) return false;
            out[at + i] = static_cast<uint8_t>(Wire.read());
        }
    }
    return true;
}
