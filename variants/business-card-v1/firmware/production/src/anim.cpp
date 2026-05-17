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

// Static hold uses the 1 Hz RTC PIT; non-multiple-of-1000 hold durations
// would silently round down.
static_assert(REVEAL_HOLD_MS % 1000 == 0,
              "REVEAL_HOLD_MS must be a whole number of seconds");

static void blink_then_hold(uint8_t bank, uint8_t count) {
    for (uint8_t i = 0; i < count; i++) {
        bank_set(bank, true);
        delay(BLINK_ON_MS);
        bank_set(bank, false);
        delay(BLINK_OFF_MS);
    }
    bank_set(bank, true);
    // GPIO output latches through SLEEP_MODE_PWR_DOWN so the bank stays
    // lit while the CPU drops to <10 uA.
    sleep_timed_seconds(REVEAL_HOLD_MS / 1000);
    bank_set(bank, false);
}

static void anim_reveal_great()  { blink_then_hold(BANK_GREAT_LUCK,  GREAT_BLINK_COUNT); }
static void anim_reveal_little() { blink_then_hold(BANK_LITTLE_LUCK, LITTLE_BLINK_COUNT); }

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

static void anim_reveal_fire() {
    pwm_init();
    uint8_t result = flame_run_until_blow(FIRE_TIMEOUT_MS);
    uint8_t orange_now = flame_current_orange();
    uint8_t red_now    = flame_current_red();

    if (result == FLAME_RESULT_BLOWN) {
        // Flare-up then a fast die -- "you blew it out".
        pwm_fade2(BANK_FIRE_ORANGE, orange_now, 100,
                  BANK_FIRE_RED,    red_now,    100,
                  FLARE_UP_MS, ease_out_quad);
        pwm_fade2(BANK_FIRE_ORANGE, 100, 0,
                  BANK_FIRE_RED,    100, 0,
                  FLARE_FADE_MS, ease_in_quad);
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
