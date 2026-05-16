#include "test_i2c_scan.h"

#include <Arduino.h>
#include <Wire.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"

namespace test_i2c_scan {

static bool scan_for_st25dv() {
    // PCB has no external pull-ups -- enable internal pull-ups on the
    // default TWI pins (PB0 = SCL, PB1 = SDA).
    PORTB.PIN0CTRL |= PORT_PULLUPEN_bm;
    PORTB.PIN1CTRL |= PORT_PULLUPEN_bm;

    Wire.usePullups();  // belt-and-suspenders on megaTinyCore
    Wire.begin();

    bool found_st25 = false;
    for (uint8_t addr = 0x08; addr <= 0x77; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            if (addr == ST25DV_I2C_ADDR_USER) found_st25 = true;
        }
    }
    return found_st25;
}

[[noreturn]] static void blink_forever(uint8_t bank, uint16_t period_ms) {
    uint16_t half = period_ms / 2;
    for (;;) {
        bank_all_mask(1u << bank);
        delay(half);
        bank_all_off();
        delay(half);
    }
}

[[noreturn]] void run() {
    bool ok = scan_for_st25dv();
    if (ok) {
        blink_forever(/*bank=*/0, /*period_ms=*/500);  // 2 Hz
    } else {
        blink_forever(/*bank=*/8, /*period_ms=*/200);  // 5 Hz
    }
}

}  // namespace test_i2c_scan
