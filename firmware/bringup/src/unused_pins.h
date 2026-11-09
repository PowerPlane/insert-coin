// Disable the digital input buffer on every pin the PCB doesn't use.
// Critical for the sleep / wake test: a floating input buffer can leak
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
    // PA0 is owned by UPDI hardware; leave it alone.
    // PC0 (mic) is left alone — its input buffer is needed for the ADC.
}
