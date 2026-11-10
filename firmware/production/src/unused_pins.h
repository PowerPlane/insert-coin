// Disable the digital input buffer on every pin the PCB doesn't use.
// Critical for sleep current: a floating input buffer can leak
// 1-10 uA per pin, dominating the < 1 uA sleep target.

#pragma once

#include <Arduino.h>

#include "pins.h"

// megaTinyCore exposes getPINnCTRLregister() returning a volatile uint8_t*
// to the PINnCTRL register for the given Arduino pin.
inline void configure_unused_pins() {
    for (uint8_t i = 0; i < NUM_UNUSED_PINS; i++) {
        volatile uint8_t* pinctrl = getPINnCTRLregister(
            digitalPinToPortStruct(UNUSED_PINS[i]),
            digitalPinToBitPosition(UNUSED_PINS[i]));
        if (pinctrl) {
            *pinctrl = PORT_ISC_INPUT_DISABLE_gc;
        }
    }
    // Production never touches I2C -- the ST25DV04K NFC tag is RF-
    // powered for tap-to-URL independent of the MCU. PB0/PB1 have no
    // external pull-ups, so their input buffers would float during the
    // whole show without this.
    PORTB.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // PA0 = UPDI -- owned by hardware, leave alone.
    // PC0 = mic -- input buffer needed for the ADC.
}
