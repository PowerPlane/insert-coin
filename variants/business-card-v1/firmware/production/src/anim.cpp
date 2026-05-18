#include "anim.h"

#include <Arduino.h>

#include "config.h"
#include "flame.h"
#include "leds.h"
#include "pins.h"
#include "pwm.h"
#include "rng.h"
#include "sleepy.h"

void anim_boot_capture() {
    pwm_init();
    // Ease ramp from dark to full -- "the spirit arrives".
    pwm_fade(BANK_DUCKY_FRAME_1, 0, BOOT_PEAK_DUTY,
             BOOT_RAMP_UP_MS, ease_in_out_quad);
    // Quick dip-and-recover -- "capture".
    pwm_fade(BANK_DUCKY_FRAME_1, BOOT_PEAK_DUTY, BOOT_DIP_DUTY,
             BOOT_DIP_DOWN_MS, ease_out_quad);
    pwm_fade(BANK_DUCKY_FRAME_1, BOOT_DIP_DUTY, BOOT_PEAK_DUTY,
             BOOT_DIP_RECOVER_MS, ease_in_quad);
    // Hold so the eye lands on the ducky before the walk starts.
    pwm_hold(BOOT_HOLD_MS);
}

void anim_ducky_walk() {
    // Hard cuts between frames -- stop-motion charm. Bank N is just
    // BANK_DUCKY_FRAME_(N+1); the indices line up.
    for (uint8_t frame = 0; frame < 4; frame++) {
        bank_all_mask((uint16_t)1 << frame);
        delay(WALK_DWELL_MS[frame]);
    }
    bank_all_off();
}

// Helper: mask of which banks light during lottery cycle position `i`.
static uint16_t lottery_mask(uint8_t i) {
    switch (i & 0x3) {
        case 0: return (uint16_t)1 << BANK_GREAT_LUCK;
        case 1: return (uint16_t)1 << BANK_LITTLE_LUCK;
        case 2: return (uint16_t)1 << BANK_UNCERTAIN;
        default:
            return ((uint16_t)1 << BANK_FIRE_ORANGE)
                 | ((uint16_t)1 << BANK_FIRE_RED);
    }
}

uint8_t anim_lottery() {
    bank_all_off();
    for (uint8_t c = 0; c < LOTTERY_CYCLES; c++) {
        uint16_t dwell = LOTTERY_DWELL_MS[c];
        for (uint8_t i = 0; i < 4; i++) {
            bank_all_mask(lottery_mask(i));
            delay(dwell);
        }
    }
    bank_all_off();

    rng_seed_from_mic(RNG_RESEED_SAMPLES);
#if FORCE_FORTUNE >= 0
    uint8_t fortune = (uint8_t)FORCE_FORTUNE & 0x3;
#else
    uint8_t fortune = rng_range(FORTUNE_COUNT);
#endif
    delay(LOTTERY_PAUSE_MS);
    return fortune;
}

// Symmetric outward ripple: origin stays at `peak`, neighbors light with
// triangular envelopes centered on `distance * step_ms`. Wave radiates
// to both ends in lockstep. Repeats `cycles` full passes.
static void ripple_outward(uint8_t origin, uint16_t step_ms,
                           uint8_t peak, uint8_t cycles) {
    const uint8_t far_left  = origin;
    const uint8_t far_right = (uint8_t)(NUM_BANKS - 1 - origin);
    const uint8_t max_dist  = (far_left > far_right) ? far_left : far_right;
    const uint32_t cycle_ms = (uint32_t)step_ms * (max_dist + 2);
    const uint32_t total_ms = cycle_ms * cycles;
    const uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < total_ms) {
        const uint32_t in_cycle = (uint32_t)(millis() - t0) % cycle_ms;
        pwm_set(origin, peak);
        for (uint8_t b = 0; b < NUM_BANKS; b++) {
            if (b == origin) continue;
            const uint8_t d = (b > origin) ? (b - origin) : (origin - b);
            const int32_t center = (int32_t)d * step_ms;
            const int32_t dt = (int32_t)in_cycle - center;
            uint8_t duty = 0;
            if (dt > -(int32_t)step_ms && dt < (int32_t)step_ms) {
                const int32_t abs_dt = (dt < 0) ? -dt : dt;
                duty = (uint8_t)((int32_t)peak * ((int32_t)step_ms - abs_dt)
                                 / step_ms);
            }
            pwm_set(b, duty);
        }
        pwm_tick_once();
    }
}

static void anim_reveal_great() {
    pwm_init();
    // Three confident blinks announce the win.
    for (uint8_t i = 0; i < GREAT_BLINK_COUNT; i++) {
        bank_set(BANK_GREAT_LUCK, true);  delay(BLINK_ON_MS);
        bank_set(BANK_GREAT_LUCK, false); delay(BLINK_OFF_MS);
    }
    // Water-ripple radiates outward from bank 4 to both ends.
    ripple_outward(BANK_GREAT_LUCK, GREAT_RIPPLE_STEP_MS,
                   GREAT_RIPPLE_PEAK, GREAT_RIPPLE_CYCLES);
    // Latched digital high so the long hold runs through PWR_DOWN.
    bank_all_off();
    bank_set(BANK_GREAT_LUCK, true);
    sleep_timed_seconds(GREAT_HOLD_SECONDS);
    bank_set(BANK_GREAT_LUCK, false);
}

static void anim_reveal_little() {
    // Bounded random walk biased toward HIGH: subtle "neon flicker" that
    // mostly sits at peak, occasionally dips, never goes dark.
    pwm_init();
    uint8_t current = LITTLE_HICCUP_HIGH;
    uint8_t target  = current;
    pwm_set(BANK_LITTLE_LUCK, current);

    const uint32_t t0 = millis();
    uint32_t next_target_ms = t0 + LITTLE_HICCUP_STEP_MS;
    while ((uint32_t)(millis() - t0) < LITTLE_HICCUP_TOTAL_MS) {
        const uint32_t now = millis();
        if ((int32_t)(now - next_target_ms) >= 0) {
            // delta in [-5..+10] -- asymmetric range pulls the running
            // mean toward HIGH so "mostly bright, occasionally dips" holds.
            const int8_t delta = (int8_t)(rng_next() & 0xF) - 5;
            int16_t nt = (int16_t)target + delta;
            if (nt < LITTLE_HICCUP_LOW)  nt = LITTLE_HICCUP_LOW;
            if (nt > LITTLE_HICCUP_HIGH) nt = LITTLE_HICCUP_HIGH;
            target = (uint8_t)nt;
            next_target_ms += LITTLE_HICCUP_STEP_MS;
        }
        // One unit per PWM tick (~1.5 ms) -> ~27 units per step; easily
        // tracks the random walk and reads as fluid, not stepped.
        if      (current < target) current++;
        else if (current > target) current--;
        pwm_set(BANK_LITTLE_LUCK, current);
        pwm_tick_once();
    }
    pwm_all_off();
    bank_all_off();
}

static void anim_reveal_uncertain() {
    pwm_init();
    pwm_fade(BANK_UNCERTAIN, 0, BREATHE_HIGH_DUTY,
             BREATHE_RAMP_MS, ease_in_out_quad);
    // Breathing for the remainder of the 15 s budget.
    const uint32_t budget = (UNCERTAIN_TOTAL_MS > BREATHE_RAMP_MS)
                          ? (UNCERTAIN_TOTAL_MS - BREATHE_RAMP_MS) : 0;
    const uint16_t half = BREATHE_PERIOD_MS / 2;
    uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) + BREATHE_PERIOD_MS <= budget) {
        pwm_fade(BANK_UNCERTAIN, BREATHE_HIGH_DUTY, BREATHE_LOW_DUTY,
                 half, ease_in_out_quad);
        pwm_fade(BANK_UNCERTAIN, BREATHE_LOW_DUTY, BREATHE_HIGH_DUTY,
                 half, ease_in_out_quad);
    }
    // Fade gently to off so it doesn't snap.
    pwm_fade(BANK_UNCERTAIN, BREATHE_HIGH_DUTY, 0,
             half, ease_in_out_quad);
    pwm_all_off();
    bank_all_off();
}

// Air ripple after a successful blow: wave starts at the fire (banks 7+8
// share distance 0) and travels one bank per step toward bank 0, each
// bank lit with the same triangular envelope as the great-luck ripple.
static void ripple_blow(uint16_t step_ms) {
    const uint8_t fire_anchor = BANK_FIRE_ORANGE;  // bank 7 = inner fire
    const uint8_t max_dist    = fire_anchor;       // 7 - 0
    const uint32_t total_ms   = (uint32_t)(max_dist + 1) * step_ms;
    const uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < total_ms) {
        const uint32_t t = (uint32_t)(millis() - t0);
        for (uint8_t b = 0; b < NUM_BANKS; b++) {
            // Banks 7 and 8 share the source; banks 0..6 are progressively
            // farther from the fire so the wave-front moves toward bank 0.
            const uint8_t dist = (b >= fire_anchor) ? 0 : (uint8_t)(fire_anchor - b);
            const int32_t center = (int32_t)dist * step_ms;
            const int32_t dt = (int32_t)t - center;
            uint8_t duty = 0;
            if (dt > -(int32_t)step_ms && dt < (int32_t)step_ms) {
                const int32_t abs_dt = (dt < 0) ? -dt : dt;
                duty = (uint8_t)(100 * ((int32_t)step_ms - abs_dt) / step_ms);
            }
            pwm_set(b, duty);
        }
        pwm_tick_once();
    }
}

static void anim_reveal_fire() {
    pwm_init();
    uint8_t result = flame_run_until_blow(FIRE_TIMEOUT_MS);
    uint8_t orange_now = flame_current_orange();
    uint8_t red_now    = flame_current_red();

    if (result == FLAME_RESULT_BLOWN) {
        // Snap the fire up to peak first -- the blow "feeds" the flame
        // for one moment before the air-ripple sweeps it (and the rest
        // of the card) outward.
        pwm_fade2(BANK_FIRE_ORANGE, orange_now, 100,
                  BANK_FIRE_RED,    red_now,    100,
                  FLARE_UP_MS, ease_out_quad);
        ripple_blow(BLOW_RIPPLE_STEP_MS);
    } else {
        // Timeout: nobody blew. Slower, sadder fade.
        pwm_fade2(BANK_FIRE_ORANGE, orange_now, 0,
                  BANK_FIRE_RED,    red_now,    0,
                  FIRE_TIMEOUT_FADE_MS, ease_in_out_quad);
    }
    pwm_all_off();
    bank_all_off();
}

void anim_run_reveal(uint8_t fortune) {
    switch (fortune) {
        case FORTUNE_GREAT:     anim_reveal_great();     break;
        case FORTUNE_LITTLE:    anim_reveal_little();    break;
        case FORTUNE_UNCERTAIN: anim_reveal_uncertain(); break;
        default:                anim_reveal_fire();      break;
    }
}
