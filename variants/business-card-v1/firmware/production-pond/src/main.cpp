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

/*
 * Retire whatever this boot put on the tag, then sleep for good.
 *
 * Extracted because there are now two ways to reach it — a fortune's live
 * window, and setup mode — and the rules for leaving are identical and
 * fiddly enough that a second copy would drift. Never returns.
 */
[[noreturn]] static void clear_and_sleep(bool patched, bool armed) {
    (void)patched;
    // Restore the default so a later tap lands on the read-only pond
    // instead of an expired fortune.
    //
    // This one genuinely matters, so it is not best-effort: going to
    // terminal sleep with a stale digit still live means the NEXT person to
    // tap this card claims a duck they did not earn, and nothing wakes the
    // MCU to fix it until someone pulls the coin. Each ndef_patch_default()
    // already retries NDEF_WRITE_ATTEMPTS times internally; if RF is still
    // holding the bus, back off a second and try the whole sequence again.
    bool still_armed = armed;
    for (uint8_t round = 0; round < NDEF_CLEAR_ROUNDS; round++) {
        ndef_init();
        const bool cleared = ndef_patch_default();
        // An armed URL left armed is a claim lying on the floor: anyone who
        // picks the card up next taps into somebody else's setup screen.
        // Cleared on the same schedule as the fortune, for the same reason.
        if (still_armed && claim_disarm()) still_armed = false;
        ndef_deinit();
        if (cleared && !still_armed) break;
        // Almost certainly a phone parked on the antenna. Sleeping a second
        // costs nothing here and is the most likely way for it to move.
        sleep_timed_seconds(1);
    }

    /*
     * ══ NEVER SLEEP STILL ARMED ══
     * The loop above gives up after NDEF_CLEAR_ROUNDS. For a stale fortune
     * that is an acceptable loss — the worst case is somebody seeing luck
     * they did not earn. For a live CLAIM it is not: the counter is already
     * spent in EEPROM, so the URL on the tag stays valid until somebody
     * rewrites it, and the next person to tap this card walks into the
     * keeper's setup screen.
     *
     * Bumping the counter again does not help — the server has not seen the
     * exposed one either, so it would still be accepted. The only thing
     * that retires it is getting those bytes rewritten. So the card keeps
     * trying, backing off further each time, and only then sleeps.
     *
     * This costs battery in a case that should never happen (a phone parked
     * on the antenna through the whole sequence), and costs nothing at all
     * in the case that always happens.
     */
    for (uint8_t round = 0; still_armed && round < CLAIM_DISARM_ROUNDS; round++) {
        sleep_timed_seconds((uint16_t)(1u << round));
        ndef_init();
        if (claim_disarm()) still_armed = false;
        ndef_deinit();
    }

    sleep_forever();
}

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
     * ══ THE SHOW IS THE CLAIM WINDOW ══
     * The gesture used to have 2.5 s of its own, here, with the LEDs off.
     * It did not work and the bench found it at once: an invisible pause is
     * indistinguishable from the card thinking, and it closed before
     * anybody would react — you had to be blowing already as the coin went
     * in. Blow once the duck was walking and nothing was listening.
     *
     * Now the watcher starts here and the animations pump it between
     * frames, so four blows count whenever they arrive: during the walk,
     * during the lottery, whenever somebody thinks to try.
     */
    /*
     * ══ A POWER CYCLE MUST NOT LEAVE A CLAIM ON THE FLOOR ══
     * `clear_and_sleep` retires the fortune and the claim at the END of a
     * session, and it tries hard — see the note on never sleeping still
     * armed. But it only runs if the card gets to the end. Pull the coin
     * while a fortune is live, or in the five minutes after four blows,
     * and it never runs at all: the tag keeps whatever it was holding,
     * indefinitely, with nothing awake to fix it.
     *
     * Reinserting the coin used not to fix it either. The tag is not
     * touched until after the walk and the lottery, so for the whole boot
     * show a stale digit — or worse, an unspent claim — sat there
     * readable. Anyone tapping in those seconds got a fortune nobody paid
     * for, or walked into somebody else's setup screen.
     *
     * So a boot starts by putting the card back to nothing: no fortune, no
     * claim. Fifteen bytes, about 90 ms, hidden inside a show that runs
     * for seconds — and it happens before the watcher below, so blowing
     * four times on THIS power-up still arms normally.
     *
     * Best effort on purpose. `ndef_write_byte` already retries, the show
     * patches the digit again a moment later, and `clear_and_sleep` is
     * still the belt at the other end. This is the braces.
     */
    ndef_init();
    /*
     * `provision_ensure`, not `provision_ok`. The latter returns a static
     * that only becomes true INSIDE ensure — so gating on it here, before
     * ensure has run for this power-up, meant the whole block was dead
     * code. It compiled, it shipped, and it cleared nothing.
     *
     * Ensure is one EEPROM read on a card that has been provisioned. On a
     * virgin one it writes the whole record, which used to happen after
     * the lottery; doing it here is if anything better, because the tag
     * resolves sooner rather than later in the show.
     */
    if (provision_ensure()) {
        ndef_patch_default();
        claim_disarm();
    }
    ndef_deinit();

    claim_watch_begin();

    delay(POST_BOOT_PAUSE_MS);
    anim_ducky_walk();
    delay(POST_WALK_PAUSE_MS);

    uint8_t fortune = anim_lottery();
    const bool claimed = claim_watch_done();

    /*
     * ══ SETTING A CARD UP IS NOT A TURN AT THE GAME ══
     * A claimed card deals no fortune. It used to deal one anyway, and the
     * result was a tag carrying both a fortune digit and a claim, where the
     * tap opens Card setup and the fortune is simply lost — a coin spent on
     * nothing, and one more thing on the tag to go stale.
     *
     * So the show is over. The tag gets the claim and only the claim.
     */
    if (claimed) {
        ndef_init();
        const bool identified = provision_ensure();
        const bool armed = identified && claim_arm();
        ndef_deinit();

        if (!armed) {
            // Nothing was promised: the tag still holds the counter the
            // server has already retired. Say so unmistakably — an unarmed
            // card opens a duck screen, and finding that out on the phone
            // is finding it out too late.
            mic_deinit();
            anim_claim_failed();
            clear_and_sleep(false, false);
        }

        /*
         * ══ SETUP MODE ══
         * One sweep backwards down the strip, and then the card waits in
         * the dark while the phone does the work. Four more blows retire
         * the claim and end it — the way out for somebody who armed a card
         * they did not mean to, or who has finished and would rather the
         * next tap open a duck.
         *
         * The mic stays up for that, so this is the one path where the CPU
         * is awake through its whole window rather than in a timed sleep.
         * A few milliamps for five minutes is a fraction of a percent of
         * the coin cell, and setting a card up happens once.
         */
        anim_setup_enter();
        const bool left = claim_setup_wait(SETUP_WINDOW_SECONDS);
        mic_deinit();

        // Leaving gets the sweep FORWARDS — the mirror of the way in.
        // Playing the same animation for both would make arriving and
        // leaving a matter of remembering which way the light went.
        if (left) anim_setup_leave();

        // Either way the claim is retired here rather than left on the
        // tag. `clear_and_sleep` keeps trying until it takes — see the
        // note on never sleeping still armed.
        clear_and_sleep(false, true);
    }

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

    clear_and_sleep(patched, armed);
}

void loop() {
    // Unreachable: sleep_forever() is [[noreturn]].
}
