#include "anim.h"

#include "claim.h"

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
    //
    // `claim_watch_delay` rather than `delay`: the show IS the claim
    // window, so every frame boundary is a chance for a blow to land. It
    // returns true once four have, and then there is nothing worth
    // finishing — the card is going to card setup, not to a fortune.
    for (uint8_t frame = 0; frame < 4; frame++) {
        bank_all_mask((uint16_t)1 << frame);
        if (claim_watch_delay(WALK_DWELL_MS[frame])) break;
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
    for (uint8_t c = 0; c < LOTTERY_CYCLES && !claim_watch_done(); c++) {
        uint16_t dwell = LOTTERY_DWELL_MS[c];
        for (uint8_t i = 0; i < 4; i++) {
            bank_all_mask(lottery_mask(i));
            if (claim_watch_delay(dwell)) break;
        }
    }
    bank_all_off();

    /*
     * A claimed card is not having a turn, so it does not draw one. The
     * caller checks `claim_watch_done()` and never reads this value, but
     * returning early also skips the reseed — which spends ADC samples
     * nobody is going to use.
     */
    if (claim_watch_done()) return 0;

    rng_seed_from_mic(RNG_RESEED_SAMPLES);
#if FORCE_FORTUNE >= 0
    uint8_t fortune = (uint8_t)FORCE_FORTUNE & 0x3;
#else
    uint8_t fortune = rng_range(FORTUNE_COUNT);
#endif
    delay(LOTTERY_PAUSE_MS);
    return fortune;
}

// Triangular wave-front: peaks at t == center, falls linearly to zero
// over |dt| == half_width. Shared by both ripple animations.
static inline uint8_t triangle_envelope(int32_t t, int32_t center,
                                        int32_t half_width, uint8_t peak) {
    const int32_t dt = t - center;
    if (dt <= -half_width || dt >= half_width) return 0;
    const int32_t abs_dt = (dt < 0) ? -dt : dt;
    return (uint8_t)((int32_t)peak * (half_width - abs_dt) / half_width);
}

// Symmetric outward ripple: origin stays at `peak`; the wave-front
// radiates to both ends in lockstep. Repeats `cycles` full passes.
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
            pwm_set(b, triangle_envelope((int32_t)in_cycle,
                                         (int32_t)d * step_ms,
                                         step_ms, peak));
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
    // Asymmetric strobing pulse: slow ease-in to peak (anticipation),
    // snap ease-out to a dim floor (the "strobe hit"), brief dim hold,
    // repeat. ease_in_quad on the rise + ease_out_quad on the fall
    // reinforce the slow-up / fast-down asymmetry beyond just duration.
    pwm_init();
    pwm_set(BANK_LITTLE_LUCK, LITTLE_PULSE_LOW);

    const uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < LITTLE_PULSE_ACTIVE_MS) {
        pwm_fade(BANK_LITTLE_LUCK, LITTLE_PULSE_LOW, LITTLE_PULSE_HIGH,
                 LITTLE_PULSE_RISE_MS, ease_in_quad);
        pwm_fade(BANK_LITTLE_LUCK, LITTLE_PULSE_HIGH, LITTLE_PULSE_LOW,
                 LITTLE_PULSE_FALL_MS, ease_out_quad);
        pwm_hold(LITTLE_PULSE_DIM_MS);
    }
    // Settle smoothly to full so the digital-high handoff is seamless.
    pwm_fade(BANK_LITTLE_LUCK, LITTLE_PULSE_LOW, 100,
             LITTLE_PULSE_SETTLE_MS, ease_out_quad);
    pwm_all_off();
    // Latched digital-high for the sleep-through hold -- chip drops to
    // <10 uA while bank 5 stays lit (same trick as great-luck).
    bank_set(BANK_LITTLE_LUCK, true);
    sleep_timed_seconds(LITTLE_HOLD_SECONDS);
    bank_set(BANK_LITTLE_LUCK, false);
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

// Air ripple after a successful blow: wave starts at the fire (banks
// 7+8 share distance 0) and travels toward bank 0. Arrival times are
// quadratic in distance -- the wave whooshes past the inner banks and
// decelerates into bank 0, matching how a real puff of air loses
// momentum as it spreads. Total duration is preserved at
// (max_dist + 1) * step_ms so the scene still ends in ~640 ms.
static void ripple_blow(uint16_t step_ms) {
    const uint8_t  fire_anchor   = BANK_FIRE_ORANGE;        // bank 7
    const uint8_t  max_dist      = fire_anchor;             // 7 - 0
    const uint32_t max_center_ms = (uint32_t)max_dist * step_ms;
    const uint32_t max_dist_sq   = (uint32_t)max_dist * max_dist;
    const uint32_t total_ms      = max_center_ms + step_ms; // tail fade-out
    const uint32_t t0 = millis();
    while ((uint32_t)(millis() - t0) < total_ms) {
        const int32_t t = (int32_t)(millis() - t0);
        for (uint8_t b = 0; b < NUM_BANKS; b++) {
            const uint8_t dist =
                (b >= fire_anchor) ? 0 : (uint8_t)(fire_anchor - b);
            // Quadratic arrival -- center = max_center * (dist/max_dist)^2.
            // dist=0 peaks at t=0; dist=max_dist peaks at t=max_center.
            const int32_t center = (int32_t)(
                (max_center_ms * dist * dist) / max_dist_sq);
            pwm_set(b, triangle_envelope(t, center, step_ms, 100));
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

/*
 * ══ BACKWARDS, BECAUSE NOTHING ELSE IS ══
 * The duck walks left to right, the lottery climbs, the reveals bloom
 * outward. Every motion this card makes goes forwards, so one sweep the
 * other way — from the fire banks down to the first ducky frame — is the
 * one thing that cannot read as part of the game.
 *
 * Once, not repeated. It is a door closing behind you, not a status light.
 */
void anim_setup_enter() {
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        const uint8_t bank = (uint8_t)(NUM_BANKS - 1 - i);
        bank_all_mask((uint16_t)1u << bank);
        delay(SETUP_SWEEP_STEP_MS);
    }
    bank_all_off();
    delay(SETUP_SWEEP_HOLD_MS);
}

/*
 * The way out, forwards. Entering runs backwards because nothing else on
 * this card does; leaving runs the normal direction again, which is the
 * card saying it is an ordinary card once more.
 */
void anim_setup_leave() {
    for (uint8_t bank = 0; bank < NUM_BANKS; bank++) {
        bank_all_mask((uint16_t)1u << bank);
        delay(SETUP_SWEEP_STEP_MS);
    }
    bank_all_off();
    delay(SETUP_SWEEP_HOLD_MS);
}

/*
 * ══ FAILURE IS NOT A SLOWER SUCCESS ══
 * A keeper standing there has to know their card did NOT take the claim
 * before they walk off and tap it — an unarmed card opens a duck screen,
 * and finding that out on the phone is finding it out too late.
 *
 * So this is not the entry sweep in another direction, which would make
 * the two a matter of noticing which way the light moved. It is a hard
 * fast blink of everything at once: no sweep, no sequence, nothing that
 * resembles the vocabulary of the show.
 */
void anim_claim_failed() {
    for (uint8_t i = 0; i < CLAIM_FAILED_BLINKS; i++) {
        bank_all_on();
        delay(CLAIM_FAILED_MS);
        bank_all_off();
        delay(CLAIM_FAILED_MS);
    }
}

void anim_run_reveal(uint8_t fortune) {
    switch (fortune) {
        case FORTUNE_GREAT:     anim_reveal_great();     break;
        case FORTUNE_LITTLE:    anim_reveal_little();    break;
        case FORTUNE_UNCERTAIN: anim_reveal_uncertain(); break;
        default:                anim_reveal_fire();      break;
    }
}
