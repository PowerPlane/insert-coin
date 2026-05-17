#include "sleepy.h"

#include <Arduino.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>

#include "leds.h"
#include "pins.h"

static void disable_all_input_buffers() {
    // LED bank pins -- still drivable as outputs with input buffer off.
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        volatile uint8_t* pinctrl = getPINnCTRLregister(
            digitalPinToPortStruct(LED_BANK_PINS[i]),
            digitalPinToBitPosition(LED_BANK_PINS[i]));
        if (pinctrl) *pinctrl = PORT_ISC_INPUT_DISABLE_gc;
    }
    // I2C (no external pull-ups -- would float in PWR_DOWN).
    PORTB.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // Mic analog line.
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // PA0 is UPDI -- leave alone.
}

[[noreturn]] void sleep_forever() {
    bank_all_off();
    // megaTinyCore's Arduino init leaves ADC0 enabled for analogRead();
    // its bias would dominate the < 1 uA sleep target.
    ADC0.CTRLA &= ~ADC_ENABLE_bm;
    ADC1.CTRLA &= ~ADC_ENABLE_bm;
    disable_all_input_buffers();

    cli();  // no wake source -- we want to stay asleep forever
    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    sleep_enable();
    for (;;) sleep_cpu();
}
