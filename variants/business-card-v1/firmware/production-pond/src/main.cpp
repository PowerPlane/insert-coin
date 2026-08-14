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
//                           tap lands on https://ducky.davidyang.work/?d=N&c=...
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
//   * The digit offset is 0x0023, and it is DERIVED rather than chosen:
//     shared/firmware/card-identity/ndef_record.h computes it from the URL
//     strings at compile time, so the constant in config.h cannot drift
//     from the record it indexes. The per-card "&c=", "&g=" and "&t=" all
//     go AFTER the digit, so every card runs this same binary.

#include <Arduino.h>

#include "anim.h"
#include "claim.h"
#include "config.h"
#include "leds.h"
#include "mic.h"
#include "ndef.h"
#include "provision.h"
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

    /*
     * The claim window, while the mic is already up and before the show
     * spends the battery. It returns in about CLAIM_FIRST_BLOW_MS unless
     * somebody is actually blowing, so the ordinary boot barely notices it.
     */
    const bool claimed = claim_listen();

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

    // First boot writes the WHOLE record from this chip's own SIGROW
    // serial; every boot after that this is one EEPROM read and returns.
    // It has to happen before the digit is patched, because on a virgin
    // card there is nothing to patch yet.
    //
    // A card that fails to verify stays unprovisioned and retries on the
    // next power-up. It still runs the show — a visitor should not be
    // punished for a bad solder joint — but the tag will not resolve, and
    // the LED confirmation is what tells whoever is flashing it. See
    // docs/pond/PROVISIONING.md.
    const bool identified = provision_ensure();

    /*
     * ══ THE CLAIM, BEFORE THE FORTUNE ══
     * The gesture was listened for above, while the mic was still up. If it
     * landed, the tag gets a fresh counter and a signature over it, and the
     * next tap opens Card setup instead of a duck.
     *
     * Arming is not allowed to cost the fortune: a card whose claim write
     * failed still deals luck, because a visitor should not be punished for
     * a keeper's gesture. The reverse matters more — an arm that only half
     * wrote leaves a signature that does not match its counter, and the
     * server refuses it, which is the right answer for a half-written arm.
     */
    const bool armed = claimed && identified && claim_arm();

    const bool patched = identified && ndef_patch_fortune(fortune);
    ndef_deinit();

    anim_run_reveal(fortune);

    // The bad-luck reveal kept ADC1 alive for its blow detector. Turn it
    // off so the long URL-live sleep isn't dominated by the ~25 uA ADC
    // bias. Safe to call twice.
    mic_deinit();

    // If the patch succeeded, hold the fortune live for the visitor. If it
    // did not, the tag still holds whatever digit was there before --
    // possibly the previous visitor's -- so skip the wait and clear it now
    // rather than spending 300 s advertising someone else's luck.
    if (patched || armed) {
        // RTC-PIT wakes the CPU after NDEF_EXPIRY_SECONDS; the timed sleep
        // draws single-digit uA.
        //
        // An armed card waits too even if the digit did not take: the claim
        // is the thing somebody is standing there waiting to tap, and five
        // minutes is the window they get to find their phone.
        sleep_timed_seconds(NDEF_EXPIRY_SECONDS);
    }

    // Restore the default so a later tap lands on the read-only pond
    // instead of an expired fortune.
    //
    // This one genuinely matters, so it is not best-effort: going to
    // terminal sleep with a stale digit still live means the NEXT person to
    // tap this card claims a duck they did not earn, and nothing wakes the
    // MCU to fix it until someone pulls the coin. Each ndef_patch_default()
    // already retries NDEF_WRITE_ATTEMPTS times internally; if RF is still
    // holding the bus, back off a second and try the whole sequence again.
    for (uint8_t round = 0; round < NDEF_CLEAR_ROUNDS; round++) {
        ndef_init();
        const bool cleared = ndef_patch_default();
        // An armed URL left armed is a claim lying on the floor: anyone who
        // picks the card up next taps into somebody else's setup screen.
        // Cleared on the same schedule as the fortune, for the same reason.
        const bool unarmed = !armed || claim_disarm();
        ndef_deinit();
        if (cleared && unarmed) break;
        // Almost certainly a phone parked on the antenna. Sleeping a second
        // costs nothing here and is the most likely way for it to move.
        sleep_timed_seconds(1);
    }

    sleep_forever();
}

void loop() {
    // Unreachable: sleep_forever() is [[noreturn]].
}
