#include "test_sleep_wake.h"

#include <Arduino.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"

namespace test_sleep_wake {

// PIT ticks at 1 Hz; this counts ticks to reach SLEEP_PIT_PERIOD_S.
static volatile uint8_t tick_count = 0;
static volatile bool    wake_event = false;

ISR(RTC_PIT_vect) {
    RTC.PITINTFLAGS = RTC_PI_bm;  // clear flag
    if (++tick_count >= SLEEP_PIT_PERIOD_S) {
        tick_count = 0;
        wake_event = true;
    }
}

static void init_pit_1hz() {
    // Select 32.768 kHz internal ULP oscillator as the RTC clock source.
    while (RTC.STATUS != 0) { /* wait for any pending sync */ }
    RTC.CLKSEL = RTC_CLKSEL_INT32K_gc;
    // 32768 cycles -> 1 second tick.
    RTC.PITCTRLA   = RTC_PERIOD_CYC32768_gc | RTC_PITEN_bm;
    RTC.PITINTCTRL = RTC_PI_bm;
}

// Disable the digital input buffer on every pin that isn't actively
// used as a wake source. Output drivers are unaffected, so the ISR's
// bank-0 pulse still works. Without this, PB0/PB1 (I2C, no external
// pull-ups) and PC0 (mic) float at mid-rail in PWR_DOWN and can
// dominate the < 1 uA budget.
static void disable_all_non_wake_input_buffers() {
    // LED bank pins -- still drivable as outputs with input buffer off.
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        volatile uint8_t* pinctrl = getPINnCTRLregister(
            digitalPinToPortStruct(LED_BANK_PINS[i]),
            digitalPinToBitPosition(LED_BANK_PINS[i]));
        if (pinctrl) *pinctrl = PORT_ISC_INPUT_DISABLE_gc;
    }
    // I2C lines (no external pull-ups -- otherwise float).
    PORTB.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // Mic analog line.
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // PA0 (UPDI) is owned by hardware -- leave it alone.
    // UNUSED_PINS were already handled by configure_unused_pins().
}

[[noreturn]] void run() {
    disable_all_non_wake_input_buffers();

    // megaTinyCore's Arduino init() leaves ADC0 enabled for analogRead().
    // Its bias current can dominate the < 1 uA sleep target -- turn both
    // ADCs off before entering PWR_DOWN. (ADC1 is normally already off in
    // this mode, but disabling it is free insurance.)
    ADC0.CTRLA &= ~ADC_ENABLE_bm;
    ADC1.CTRLA &= ~ADC_ENABLE_bm;

    init_pit_1hz();

    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    sleep_enable();
    sei();

    for (;;) {
        sleep_cpu();
        if (wake_event) {
            wake_event = false;
            bank_all_mask(1u << 0);
            delay(SLEEP_BLINK_MS);
            bank_all_off();
        }
    }
}

}  // namespace test_sleep_wake
