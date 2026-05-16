// Bring-up firmware configuration.
//
// BRINGUP_MODE selects which test runs:
//   0 = auto-cycle (tests 1, 2, 3 in a loop with 3 s pauses)
//   1 = walking banks
//   2 = full at low PWM duty
//   3 = mic envelope (VU-meter)
//   4 = I2C scan (terminal — hangs blinking result pattern)
//   5 = sleep / wake (terminal — measure current with multimeter)

#pragma once

#ifndef BRINGUP_MODE
#define BRINGUP_MODE 0
#endif

// Test 1: walking banks
#define WALK_STEP_MS 200

// Test 2: full at low duty
// Average current ~38 mA at 8 % over 24 LEDs; CR2032 will sag but BOD-off
// keeps the MCU running. Crank up only on a bench supply.
#define FULL_PWM_DUTY_PCT 8
#define FULL_PWM_TICK_HZ  1000

// Test 3: mic envelope
#define MIC_SAMPLE_HZ     8000
#define MIC_FRAME_HZ      60
// Per-bank threshold (10-bit ADC units above DC). Tune after first listen.
#define MIC_BANK_STEP     8

// Test 5: sleep / wake
#define SLEEP_PIT_PERIOD_S 4
#define SLEEP_BLINK_MS     50

// Auto-cycle mode: how long to dwell on each sub-test before moving on.
#define AUTO_CYCLE_DWELL_MS 3000
