// 9-bank software PWM, 0..100 % per bank, ~1 kHz refresh.
//
// One tick = one full PWM period (~1.5 ms wall-clock). Eased fade and
// hold helpers use millis() so durations are honored regardless of how
// long an individual tick actually takes.

#pragma once

#include <stdint.h>
#include "pins.h"

constexpr uint8_t PWM_LEVELS = 100;   // duty range 0..100 inclusive
constexpr uint8_t PWM_STEP_US = 10;   // per-phase delay; 100 * 10us = 1ms

// Easing function shape: returns the eased position in [0, total], given
// linear elapsed time t (also in [0, total]). Integer math, no floats.
using EaseFn = uint16_t (*)(uint16_t t, uint16_t total);

inline uint16_t ease_linear(uint16_t t, uint16_t /*total*/) {
    return t;
}
inline uint16_t ease_in_quad(uint16_t t, uint16_t total) {
    if (total == 0) return 0;
    return (uint16_t)((uint32_t)t * t / total);
}
inline uint16_t ease_out_quad(uint16_t t, uint16_t total) {
    if (total == 0) return 0;
    uint32_t r = total - t;
    return (uint16_t)(total - r * r / total);
}
inline uint16_t ease_in_out_quad(uint16_t t, uint16_t total) {
    if (total == 0) return 0;
    uint16_t half = total / 2;
    if (t < half) {
        return (uint16_t)((uint32_t)2 * t * t / total);
    }
    uint32_t r = total - t;
    return (uint16_t)(total - (uint32_t)2 * r * r / total);
}

void pwm_init();
void pwm_set(uint8_t bank, uint8_t duty);
void pwm_set_all(uint8_t duty);
void pwm_all_off();
uint8_t pwm_get(uint8_t bank);

// One PWM period at the current duty[] state.
void pwm_tick_once();

// Hold the current duty[] for `ms` milliseconds.
void pwm_hold(uint32_t ms);

// Fade one bank's duty from -> to over `ms` ms, easing `ease`.
void pwm_fade(uint8_t bank, uint8_t from, uint8_t to,
              uint16_t ms, EaseFn ease);

// Fade two banks simultaneously (used for the fire flare-up / fade-out).
void pwm_fade2(uint8_t bank_a, uint8_t a_from, uint8_t a_to,
               uint8_t bank_b, uint8_t b_from, uint8_t b_to,
               uint16_t ms, EaseFn ease);
