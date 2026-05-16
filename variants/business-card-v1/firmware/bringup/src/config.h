// Bring-up firmware configuration.
//
// BRINGUP_MODE selects which test runs:
//   0 = auto-cycle (tests 1, 2, 3 in a loop with 3 s pauses)
//   1 = walking banks
//   2 = full at low PWM duty
//   3 = mic envelope (VU-meter: which banks light depends on loudness)
//   4 = I2C scan (terminal — hangs blinking result pattern)
//   5 = sleep / wake (terminal — measure current with multimeter)
//   6 = mic brightness (all banks lit; PWM duty driven by loudness)

#pragma once

#ifndef BRINGUP_MODE
#define BRINGUP_MODE 0
#endif

// Test 1: walking banks
#define WALK_STEP_MS 200

// Test 2: full at low duty
// With 10k current-limit resistors the absolute LED current ceiling is
// ~120 uA per LED (2.9 mA all-on), which is CR2032-friendly even at
// 100 %. The original 8 % choice predated knowing the resistor value;
// 100 % is fine and looks substantially brighter.
#define FULL_PWM_DUTY_PCT 100
#define FULL_PWM_TICK_HZ  1000

// Test 3: mic envelope
#define MIC_SAMPLE_HZ     8000
#define MIC_FRAME_HZ      60
// Per-bank threshold (10-bit ADC units above DC). Tune after first listen.
#define MIC_BANK_STEP     8

// Test 5: sleep / wake
#define SLEEP_PIT_PERIOD_S 4
#define SLEEP_BLINK_MS     50

// Test 6: mic-driven brightness
// FULL_AT is the envelope value (10-bit ADC units above DC) that maps
// to 100 % duty. Lower = more sensitive (saturates earlier). FLOOR is
// the minimum duty even at silence -- a small value (~3 %) keeps the
// LEDs faintly lit so the test is visibly running.
#define MIC_BRIGHTNESS_FLOOR        3
#define MIC_BRIGHTNESS_FULL_AT      80
#define MIC_BRIGHTNESS_PWM_STEP_US  10   // 10 us/step × 100 steps = 1 kHz PWM
#define MIC_BRIGHTNESS_FRAME_MS     17   // ~60 Hz envelope updates

// Auto-cycle mode: how long to dwell on each sub-test before moving on.
#define AUTO_CYCLE_DWELL_MS 3000
