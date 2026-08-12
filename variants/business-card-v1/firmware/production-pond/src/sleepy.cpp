#include "sleepy.h"

#include <Arduino.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>

#include "leds.h"
#include "pins.h"

// 16-bit so the pond variant's 300 s live-URL window fits. The ISR writes
// it and the main context reads it, so every main-context access is inside
// a cli()/sei() pair -- on an 8-bit core a 16-bit load is two instructions
// and can tear across the decrement, which would read a false zero and end
// the sleep early.
static volatile uint16_t s_pit_ticks_remaining = 0;

ISR(RTC_PIT_vect) {
    RTC.PITINTFLAGS = RTC_PI_bm;
    if (s_pit_ticks_remaining > 0) s_pit_ticks_remaining--;
}

static void disable_all_input_buffers() {
    // LED bank pins -- still drivable as outputs with input buffer off.
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        volatile uint8_t* pinctrl = getPINnCTRLregister(
            digitalPinToPortStruct(LED_BANK_PINS[i]),
            digitalPinToBitPosition(LED_BANK_PINS[i]));
        if (pinctrl) *pinctrl = PORT_ISC_INPUT_DISABLE_gc;
    }
    // I2C lines: ndef_deinit() leaves PULLUPEN set. Hard-disable here so
    // terminal sleep pays for neither the pullup current nor a floating
    // Schmitt input.
    PORTB.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // PA0 is UPDI -- leave alone.
}

void sleep_timed_seconds(sleep_seconds_t seconds) {
    if (seconds == 0) return;

    while (RTC.STATUS != 0) { /* wait for any pending sync */ }
    RTC.CLKSEL     = RTC_CLKSEL_INT32K_gc;
    RTC.PITCTRLA   = RTC_PERIOD_CYC32768_gc | RTC_PITEN_bm;  // 1 Hz
    RTC.PITINTCTRL = RTC_PI_bm;

    cli();
    s_pit_ticks_remaining = seconds;
    sei();

    set_sleep_mode(SLEEP_MODE_PWR_DOWN);

    // Classic AVR race-free sleep: test the flag with interrupts off, then
    // sei() immediately before sleep_cpu(). The instruction after sei() is
    // guaranteed to execute before any pending interrupt, so the PIT can't
    // fire in the window between the test and the sleep and leave us
    // asleep for a whole extra second (or, at the last tick, forever).
    for (;;) {
        cli();
        if (s_pit_ticks_remaining == 0) {
            sei();
            break;
        }
        sleep_enable();
        sei();
        sleep_cpu();
        sleep_disable();
    }

    // Stop the PIT so it doesn't fire during a later sleep_forever().
    RTC.PITINTCTRL = 0;
    RTC.PITCTRLA   = 0;
}

[[noreturn]] void sleep_forever() {
    bank_all_off();
    // megaTinyCore's Arduino init() leaves ADC0 enabled for analogRead();
    // its bias current would dominate the < 1 uA sleep target.
    ADC0.CTRLA &= ~ADC_ENABLE_bm;
    ADC1.CTRLA &= ~ADC_ENABLE_bm;
    disable_all_input_buffers();

    cli();  // no wake source desired -- stay asleep until coin pull
    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    sleep_enable();
    for (;;) sleep_cpu();
}
