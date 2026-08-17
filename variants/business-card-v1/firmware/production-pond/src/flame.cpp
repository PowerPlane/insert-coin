#include "flame.h"

#include <Arduino.h>

#include "config.h"
#include "mic.h"
#include "pins.h"
#include "pwm.h"
#include "rng.h"

namespace {

struct Stream {
    uint8_t cur;
    uint8_t target;
};

Stream s_orange;
Stream s_red;
uint32_t s_last_frame_ms = 0;

// Biased rejection sampling: ~50 % of picks hit FLAME_CEIL_DUTY, the
// rest distribute across the lower 12 of 16 levels with the bottom 4
// almost never chosen. Up to 4 retries to skip the deep-dim zone.
uint8_t pick_target() {
    uint8_t raw = 0;
    for (uint8_t attempts = 0; attempts < 4; attempts++) {
        raw = (uint8_t)(rng_next() & 0x1F);
        if ((raw & 0x0C) != 0) break;
    }
    if (raw >= 16) return FLAME_CEIL_DUTY;
    constexpr uint8_t span = FLAME_CEIL_DUTY - FLAME_FLOOR_DUTY;
    // raw in [0..15] -> linearly fill [FLOOR .. CEIL-1].
    return (uint8_t)(FLAME_FLOOR_DUTY + ((uint16_t)raw * (span - 1) + 7) / 15);
}

void approach(Stream& s) {
    if (s.cur < s.target) {
        uint8_t step = FLAME_INTERP_STEP;
        s.cur = (s.cur + step >= s.target) ? s.target : (uint8_t)(s.cur + step);
    } else if (s.cur > s.target) {
        uint8_t step = FLAME_INTERP_STEP;
        s.cur = (s.cur <= s.target + step) ? s.target : (uint8_t)(s.cur - step);
    }
    if (s.cur < FLAME_FLOOR_DUTY) s.cur = FLAME_FLOOR_DUTY;
}

}  // namespace

void flame_init() {
    s_orange.cur = s_orange.target = FLAME_CEIL_DUTY;
    s_red.cur    = s_red.target    = FLAME_CEIL_DUTY;
    s_last_frame_ms = millis();
    pwm_set(BANK_FIRE_ORANGE, s_orange.cur);
    pwm_set(BANK_FIRE_RED,    s_red.cur);
}

void flame_tick(uint32_t now_ms) {
    if ((uint32_t)(now_ms - s_last_frame_ms) >= FLAME_FRAME_MS) {
        s_last_frame_ms = now_ms;
        s_orange.target = pick_target();
        // Gust: mirror orange to red. Else red rolls independently.
        if ((uint8_t)(rng_next() & 0xFF) < FLAME_GUST_CHANCE) {
            s_red.target = s_orange.target;
        } else {
            s_red.target = pick_target();
        }
    }
    approach(s_orange);
    approach(s_red);
    pwm_set(BANK_FIRE_ORANGE, s_orange.cur);
    pwm_set(BANK_FIRE_RED,    s_red.cur);
}

uint8_t flame_current_orange() { return s_orange.cur; }
uint8_t flame_current_red()    { return s_red.cur; }

static void mic_phase_hook() {
    (void)mic_pump_sample();
}

uint8_t flame_run_until_blow(uint32_t timeout_ms) {
    mic_blow_reset();
    flame_init();
    uint32_t t0 = millis();
    for (;;) {
        uint32_t now = millis();
        if ((uint32_t)(now - t0) >= timeout_ms) {
            return FLAME_RESULT_TIMEOUT;
        }
        flame_tick(now);
        // Phase hook drains the ADC at PWM frequency; the ADC's natural
        // ~21 us/sample at PRESC/16 lines up with every other phase, so
        // we pick samples up as fast as they're produced.
        pwm_tick_once_with_hook(mic_phase_hook);
        if (mic_blow_detected()) {
            return FLAME_RESULT_BLOWN;
        }
    }
}
