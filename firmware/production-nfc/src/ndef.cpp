#include "ndef.h"

#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "pins.h"

// Internal pull-ups on PB0/PB1 are nominal ~35 kOhm at 3 V. With ~25 pF
// of trace+pin capacitance to U2 that's ~2 us rise time, which is out
// of spec for 100 kHz I2C; 25 kHz SCL gives ~10x margin on the data
// setup window without bothering with external resistors.

void ndef_init() {
    PORTB.PIN0CTRL = PORT_PULLUPEN_bm;  // SCL
    PORTB.PIN1CTRL = PORT_PULLUPEN_bm;  // SDA
    Wire.begin();
    Wire.setClock(NFC_I2C_CLOCK_HZ);
}

void ndef_deinit() {
    Wire.end();
    // Leave PULLUPEN set: lines float to VCC instead of mid-rail, so
    // input Schmitt triggers don't oscillate during the 60 s timed
    // nap. sleep_forever() will hard-disable both pins for the
    // terminal sleep.
}

static bool ndef_write_byte(uint16_t mem_addr, uint8_t value) {
    Wire.beginTransmission(ST25DV_I2C_ADDR_USER);
    Wire.write((uint8_t)(mem_addr >> 8));
    Wire.write((uint8_t)(mem_addr & 0xFF));
    Wire.write(value);
    if (Wire.endTransmission() != 0) return false;
    delay(NDEF_EEPROM_WRITE_MS);
    return true;
}

bool ndef_patch_fortune(uint8_t fortune) {
    if (fortune >= FORTUNE_COUNT) return false;
    const uint8_t digit = (uint8_t)('1' + fortune);
    return ndef_write_byte(NDEF_DIGIT_OFFSET, digit);
}

bool ndef_patch_default() {
    return ndef_write_byte(NDEF_DIGIT_OFFSET, (uint8_t)'0');
}
