#pragma once

// Idle in SLEEP_MODE_PWR_DOWN; wake via RTC PIT every SLEEP_PIT_PERIOD_S
// seconds to pulse bank 0 for SLEEP_BLINK_MS. Operator measures the
// coin-cell current with a multimeter in series; target < 1 uA between
// pulses.
//
// The PIT runs from the 32.768 kHz ULP oscillator and stays alive in
// power-down sleep -- no watchdog or external wake needed.

namespace test_sleep_wake {

[[noreturn]] void run();

}  // namespace test_sleep_wake
