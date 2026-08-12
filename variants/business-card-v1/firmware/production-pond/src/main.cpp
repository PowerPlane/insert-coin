// business-card-v1 production-pond firmware -- entry point.
//
// Same show as production-nfc, pointed at the pond instead of the plain
// site, with three changes that only matter once a web app is treating
// the tag as a ticket rather than as decoration:
//
//   1. boot capture      -- bank 0 ramps in, dips, holds
//   2. ducky walk        -- banks 0->3 stop-motion
//   3. lottery           -- pick fortune from hardware-seeded RNG
//   4. NDEF patch        -- I2C-write fortune digit ('1'..'4') so the next
//                           tap lands on https://davidyang.work/p?d=N&c=...
//                           Retried on NACK (see ndef.cpp). Happens before
//                           the reveal, so taps during the LED show already
//                           see the new URL.
//   5. reveal            -- banks 4..8 per fortune
//   6. 300 s timed sleep -- the URL stays live long enough for someone to
//                           finish watching, talk about it, and then tap
//   7. NDEF reset        -- restore '0' so a later tap gets the read-only
//                           pond rather than a stale fortune
//   8. sleep forever     -- coin pull is the only restart
//
// Differences from production-nfc, and why:
//
//   * NDEF_EXPIRY_SECONDS is 300, not 120. The most common real failure
//     is someone watching the lights, chatting, and tapping too late.
//     This required widening the constant AND sleep_timed_seconds() to
//     16-bit -- at uint8_t, 300 wraps to 44 and the window gets SHORTER.
//
//   * NDEF writes retry. RF wins arbitration against I2C on the ST25DV,
//     so a phone resting on the card during the show can NACK the patch.
//     production-nfc ignores the return value, which silently serves the
//     previous visitor's fortune -- on the pond that means claiming
//     someone else's duck.
//
//   * The digit offset moved by one byte (0x001D -> 0x001E) because the
//     path gained "/p". The per-card "&c=" suffix goes AFTER the digit so
//     every card runs this same binary.

#include <Arduino.h>

#include "anim.h"
#include "config.h"
#include "leds.h"
#include "mic.h"
#include "ndef.h"
#include "pins.h"
#include "pwm.h"
#include "rng.h"
#include "sleepy.h"
#include "unused_pins.h"

void setup() {
    bank_init();
    pwm_init();
    configure_unused_pins();
    mic_init();

    // Seed before the show -- ADC noise during quiet boot is plenty. A
    // second harvest happens at the lottery so live ambient sound also
    // colors the outcome.
    rng_seed_from_mic(RNG_SEED_SAMPLES);

    anim_boot_capture();
    delay(POST_BOOT_PAUSE_MS);
    anim_ducky_walk();
    delay(POST_WALK_PAUSE_MS);

    uint8_t fortune = anim_lottery();
    // Only the fire reveal needs the mic. Disabling ADC1 here saves
    // ~25 uA across the great/little/uncertain reveal paths.
    if (fortune != FORTUNE_BAD) {
        mic_deinit();
    }

    // Patch BEFORE the reveal so a tap during the show already picks up
    // the new URL. Worst case (~4 attempts) this is ~75 ms, still not
    // visible against a multi-second LED show, and software PWM hasn't
    // started ramping yet so there's no flicker risk.
    ndef_init();
    const bool patched = ndef_patch_fortune(fortune);
    ndef_deinit();

    anim_run_reveal(fortune);

    // The bad-luck reveal kept ADC1 alive for its blow detector. Turn it
    // off so the long URL-live sleep isn't dominated by the ~25 uA ADC
    // bias. Safe to call twice.
    mic_deinit();

    if (patched) {
        // Live-URL window. RTC-PIT wakes the CPU after
        // NDEF_EXPIRY_SECONDS; the timed sleep draws single-digit uA.
        sleep_timed_seconds(NDEF_EXPIRY_SECONDS);

        // Expiry: restore the default so a later tap lands on the
        // read-only pond instead of an expired fortune.
        ndef_init();
        ndef_patch_default();
        ndef_deinit();
    } else {
        // Every attempt NACKed, so the tag still holds whatever digit was
        // there before -- possibly the previous visitor's fortune. Don't
        // wait 300 s advertising someone else's luck; clear it now and
        // let this tap fall through to the read-only pond.
        ndef_init();
        ndef_patch_default();
        ndef_deinit();
    }

    sleep_forever();
}

void loop() {
    // Unreachable: sleep_forever() is [[noreturn]].
}
