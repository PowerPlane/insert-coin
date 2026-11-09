#include "sleepy.h"

#include <Arduino.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>

#include "leds.h"
#include "pins.h"

static volatile uint8_t s_pit_ticks_remaining = 0;

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
    // I2C lines are already disabled by configure_unused_pins(), but
    // belt-and-suspenders.
    PORTB.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTB.PIN1CTRL = PORT_ISC_INPUT_DISABLE_gc;
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;
    // PA0 is UPDI -- leave alone.
}

void sleep_timed_seconds(uint8_t seconds) {
    if (seconds == 0) return;

    while (RTC.STATUS != 0) { /* wait for any pending sync */ }
    RTC.CLKSEL     = RTC_CLKSEL_INT32K_gc;
    RTC.PITCTRLA   = RTC_PERIOD_CYC32768_gc | RTC_PITEN_bm;  // 1 Hz
    RTC.PITINTCTRL = RTC_PI_bm;

    s_pit_ticks_remaining = seconds;

    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    sleep_enable();
    sei();
    while (s_pit_ticks_remaining > 0) sleep_cpu();
    sleep_disable();

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
