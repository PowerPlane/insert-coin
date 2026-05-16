// business-card-v1 bring-up firmware -- entry point.
//
// Selects one of six test behaviors at compile time via BRINGUP_MODE
// (see config.h). Because each test's run() is [[noreturn]], the
// Arduino framework's loop() is never reached.

#include <Arduino.h>

#include "config.h"
#include "leds.h"
#include "pins.h"
#include "unused_pins.h"

#include "tests/test_full_low_pwm.h"
#include "tests/test_i2c_scan.h"
#include "tests/test_mic_envelope.h"
#include "tests/test_sleep_wake.h"
#include "tests/test_walking_banks.h"

static void setup_common() {
    bank_init();
    configure_unused_pins();
}

#if BRINGUP_MODE == 0
// Auto-cycle through tests 1, 2, 3 with AUTO_CYCLE_DWELL_MS dwell each.
// 4 and 5 are terminal / measurement modes, intentionally skipped here.
[[noreturn]] static void run_auto_cycle() {
    test_mic_envelope::init();
    for (;;) {
        uint32_t deadline;

        deadline = millis() + AUTO_CYCLE_DWELL_MS;
        while ((int32_t)(millis() - deadline) < 0) {
            test_walking_banks::step_once();
        }
        bank_all_off();

        deadline = millis() + AUTO_CYCLE_DWELL_MS;
        while ((int32_t)(millis() - deadline) < 0) {
            test_full_low_pwm::step_once();
        }
        bank_all_off();

        deadline = millis() + AUTO_CYCLE_DWELL_MS;
        while ((int32_t)(millis() - deadline) < 0) {
            test_mic_envelope::step_once();
        }
        bank_all_off();
    }
}
#endif

void setup() {
    setup_common();

#if BRINGUP_MODE == 0
    run_auto_cycle();
#elif BRINGUP_MODE == 1
    test_walking_banks::run();
#elif BRINGUP_MODE == 2
    test_full_low_pwm::run();
#elif BRINGUP_MODE == 3
    test_mic_envelope::run();
#elif BRINGUP_MODE == 4
    test_i2c_scan::run();
#elif BRINGUP_MODE == 5
    test_sleep_wake::run();
#else
#error "BRINGUP_MODE must be 0..5"
#endif
}

void loop() {
    // Unreachable: every run() above is [[noreturn]].
}
