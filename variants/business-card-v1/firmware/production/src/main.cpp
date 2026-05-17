// business-card-v1 production firmware -- entry point.
//
// One forward pass per coin insertion:
//   1. boot capture     -- bank 0 ramps in, dips, holds
//   2. ducky walk       -- banks 0->3 stop-motion
//   3. lottery + reveal -- banks 4..8, picked from hardware-seeded RNG
//   4. sleep forever    -- coin pull is the only restart
//
// Setup() runs the whole show, then sleep_forever() never returns.
// loop() is unreachable.

#include <Arduino.h>

#include "anim.h"
#include "config.h"
#include "leds.h"
#include "mic.h"
#include "pwm.h"
#include "rng.h"
#include "sleepy.h"
#include "unused_pins.h"

void setup() {
    bank_init();
    pwm_init();
    configure_unused_pins();
    mic_init();

    // Seed before the show -- the ADC noise during quiet boot is plenty.
    // A second harvest happens at the lottery so live ambient sound also
    // colors the outcome.
    rng_seed_from_mic(RNG_SEED_SAMPLES);

    anim_boot_capture();
    delay(POST_BOOT_PAUSE_MS);
    anim_ducky_walk();
    delay(POST_WALK_PAUSE_MS);

    uint8_t fortune = anim_lottery();
    anim_run_reveal(fortune);

    sleep_forever();
}

void loop() {
    // Unreachable: sleep_forever() is [[noreturn]].
}
