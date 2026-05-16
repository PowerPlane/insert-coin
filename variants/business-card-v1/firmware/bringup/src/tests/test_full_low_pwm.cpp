#include "test_full_low_pwm.h"

#include <Arduino.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"

namespace test_full_low_pwm {

// Compute in uint32_t: (PERIOD_US * FULL_PWM_DUTY_PCT) overflows a
// uint16_t intermediate above ~65 % duty (e.g. 100 % silently caps at
// ~344 us at the default 1 kHz period). delayMicroseconds() still
// takes a 16-bit argument, so we static_assert the final period fits.
static constexpr uint32_t PERIOD_US_32 = 1000000UL / FULL_PWM_TICK_HZ;
static constexpr uint32_t ON_US_32     =
    (PERIOD_US_32 * (uint32_t)FULL_PWM_DUTY_PCT) / 100UL;
static_assert(PERIOD_US_32 <= 65535UL,
              "PWM period too long for delayMicroseconds() (uint16_t arg)");
static constexpr uint16_t PERIOD_US = (uint16_t)PERIOD_US_32;
static constexpr uint16_t ON_US     = (uint16_t)ON_US_32;
static constexpr uint16_t OFF_US    = PERIOD_US - ON_US;

void step_once() {
    if (ON_US > 0) {
        bank_all_on();
        delayMicroseconds(ON_US);
    }
    if (OFF_US > 0) {
        bank_all_off();
        delayMicroseconds(OFF_US);
    }
}

[[noreturn]] void run() {
    for (;;) {
        step_once();
    }
}

}  // namespace test_full_low_pwm
