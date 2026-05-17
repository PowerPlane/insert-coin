#include "pwm.h"

#include <Arduino.h>

#include "leds.h"

static uint8_t s_duty[NUM_BANKS];

void pwm_init() {
    for (uint8_t i = 0; i < NUM_BANKS; i++) s_duty[i] = 0;
    bank_all_off();
}

void pwm_set(uint8_t bank, uint8_t duty) {
    if (bank >= NUM_BANKS) return;
    if (duty > PWM_LEVELS) duty = PWM_LEVELS;
    s_duty[bank] = duty;
}

void pwm_set_all(uint8_t duty) {
    if (duty > PWM_LEVELS) duty = PWM_LEVELS;
    for (uint8_t i = 0; i < NUM_BANKS; i++) s_duty[i] = duty;
}

void pwm_all_off() {
    pwm_set_all(0);
    bank_all_off();
}

uint8_t pwm_get(uint8_t bank) {
    return (bank < NUM_BANKS) ? s_duty[bank] : 0;
}

void pwm_tick_once() {
    for (uint8_t phase = 0; phase < PWM_LEVELS; phase++) {
        uint16_t mask = 0;
        for (uint8_t i = 0; i < NUM_BANKS; i++) {
            if (s_duty[i] > phase) mask |= (1u << i);
        }
        bank_all_mask(mask);
        delayMicroseconds(PWM_STEP_US);
    }
}

void pwm_hold(uint32_t ms) {
    uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < ms) {
        pwm_tick_once();
    }
}

// Linear-interpolate a -> b given an eased position p in [0, total].
static inline uint8_t lerp_eased(uint8_t a, uint8_t b,
                                 uint16_t p, uint16_t total) {
    int32_t span = (int32_t)b - (int32_t)a;
    int32_t v = (int32_t)a + (span * (int32_t)p) / (int32_t)total;
    if (v < 0) v = 0;
    if (v > PWM_LEVELS) v = PWM_LEVELS;
    return (uint8_t)v;
}

void pwm_fade(uint8_t bank, uint8_t from, uint8_t to,
              uint16_t ms, EaseFn ease) {
    if (ms == 0) { pwm_set(bank, to); return; }
    uint32_t t0 = millis();
    for (;;) {
        uint32_t elapsed = millis() - t0;
        if (elapsed >= ms) break;
        uint16_t e = ease((uint16_t)elapsed, ms);
        pwm_set(bank, lerp_eased(from, to, e, ms));
        pwm_tick_once();
    }
    pwm_set(bank, to);
}

void pwm_fade2(uint8_t bank_a, uint8_t a_from, uint8_t a_to,
               uint8_t bank_b, uint8_t b_from, uint8_t b_to,
               uint16_t ms, EaseFn ease) {
    if (ms == 0) {
        pwm_set(bank_a, a_to);
        pwm_set(bank_b, b_to);
        return;
    }
    uint32_t t0 = millis();
    for (;;) {
        uint32_t elapsed = millis() - t0;
        if (elapsed >= ms) break;
        uint16_t e = ease((uint16_t)elapsed, ms);
        pwm_set(bank_a, lerp_eased(a_from, a_to, e, ms));
        pwm_set(bank_b, lerp_eased(b_from, b_to, e, ms));
        pwm_tick_once();
    }
    pwm_set(bank_a, a_to);
    pwm_set(bank_b, b_to);
}
