// business-card-v1 production-nfc firmware -- entry point.
//
// Same forward pass as the original production firmware, with an
// NFC NDEF patch threaded around the reveal so a phone scan during
// the show already lands on the fortune-coded URL:
//   1. boot capture     -- bank 0 ramps in, dips, holds
//   2. ducky walk       -- banks 0->3 stop-motion
//   3. lottery          -- pick fortune from hardware-seeded RNG
//   4. NDEF patch       -- I2C-write fortune digit ('1'..'4') into the
//                          ST25DV04K so the next phone tap lands on
//                          https://davidyang.work/?d=N. ~11 ms; happens
//                          before the reveal so taps during the LED show
//                          already see the new URL.
//   5. reveal           -- banks 4..8 per fortune
//   6. 60 s timed sleep -- URL stays "live" for the visitor to scan
//   7. NDEF reset       -- I2C-write '0' to restore the no-ducky default
//   8. sleep forever    -- coin pull is the only restart
//
// All NDEF calls are best-effort. A NACK leaves the previous URL byte
// intact -- worst case the website shows the wrong (or no) ducky.

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

    // Seed before the show -- the ADC noise during quiet boot is plenty.
    // A second harvest happens at the lottery so live ambient sound also
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

    // Patch the NDEF digit BEFORE the reveal animation runs so a phone
    // tap during the show already picks up the new URL. The write is
    // ~11 ms blocking (3 ms I2C @ 25 kHz + 6 ms EEPROM cycle) -- not
    // visible against the upcoming multi-second LED show, and software
    // PWM hasn't started ramping yet so there's no flicker risk.
    ndef_init();
    ndef_patch_fortune(fortune);
    ndef_deinit();

    anim_run_reveal(fortune);

    // The bad-luck reveal kept ADC1 alive for its blow detector. Turn
    // it off now so the 60 s URL-live sleep below isn't dominated by
    // the ~25 uA ADC bias. Safe to call twice.
    mic_deinit();

    // Live-URL window. RTC-PIT wakes the CPU after NDEF_EXPIRY_SECONDS;
    // the timed sleep itself draws single-digit uA.
    sleep_timed_seconds(NDEF_EXPIRY_SECONDS);

    // Expiry: restore the default URL so the next visitor (who hasn't
    // re-inserted the coin) lands on the plain page.
    ndef_init();
    ndef_patch_default();
    ndef_deinit();

    sleep_forever();
}

void loop() {
    // Unreachable: sleep_forever() is [[noreturn]].
}
