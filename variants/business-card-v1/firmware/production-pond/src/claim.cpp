#include "claim.h"

#include <Arduino.h>
#include <string.h>

#include "card_identity.h"
#include "config.h"
#include "leds.h"
#include "mic.h"
#include "ndef.h"
#include "ndef_record.h"
#include "pins.h"
#include "provision.h"
#include "secrets.h"

// ── counting blows ───────────────────────────────────────────────────────
//
// `mic_blow_detected()` reports a streak, not an edge — it stays true for
// as long as the air keeps coming. One long breath would otherwise count as
// four, which would make the gesture meaningless.
//
// So a blow is only counted on the RISING edge, and the next one cannot be
// counted until the envelope has fallen back under the threshold for
// CLAIM_GAP_MS. Four separate breaths, not one long one.

static void show_count(uint8_t blows) {
    // One LED per blow, from the bottom. Stopping at three has to look
    // different from reaching four.
    uint16_t mask = 0;
    for (uint8_t i = 0; i < blows && i < NUM_BANKS; i++) mask |= (uint16_t)(1u << i);
    bank_all_mask(mask);
}

// ── watching for the gesture, while the show runs ────────────────────────
//
// ══ WHY THIS REPLACED A WINDOW ══
// The gesture used to have its own window: 2.5 seconds after power-up,
// before the show, with the LEDs off. Reported from the bench as simply not
// working, and it is easy to see why — the window was INVISIBLE (it looks
// exactly like the card thinking) and it was over before anybody would
// react. In practice you had to already be blowing as you pushed the coin
// in. Blow once the duck starts walking and nothing was listening: the mic
// is only re-armed during a 凶 reveal, where a blow means "put the fire
// out" instead.
//
// So there is no window any more. The mic stays up through the show and the
// animations pump this watcher between frames, which means four blows land
// whenever they land — during the walk, during the lottery, at whatever
// moment somebody thinks to try. The keeper gets seconds instead of an
// invisible two and a half.
//
// The cost is ~25 uA of ADC bias for the few seconds of the show, which is
// nothing against LEDs, and one shared resource: the banks are the show's
// during the show, so a blow flashes them briefly rather than holding a
// count. Somebody who is not blowing never sees it.

static uint8_t watch_blows = 0;
static bool watch_blowing = false;
static bool watch_done = false;
static uint32_t watch_quiet_since = 0;

void claim_watch_begin() {
    mic_blow_reset();
    watch_blows = 0;
    watch_blowing = false;
    watch_done = false;
    watch_quiet_since = millis();
}

bool claim_watch_done() { return watch_done; }

/*
 * ══ COUNTING IS SILENT DURING THE SHOW ══
 * No per-blow feedback while the duck is walking. The banks belong to the
 * animation then, and a card that flashed at every loud noise would be
 * showing a stranger a counter for a gesture they do not know exists —
 * which is both a worse show and a worse secret.
 *
 * The confirmation is the whole sweep that runs when the fourth blow
 * lands. Counting out loud is for setup mode, where the banks are idle and
 * the person blowing is the one who meant to.
 */

bool claim_watch_delay(uint16_t ms) {
    // Already claimed: the rest of the show is being abandoned, so run
    // through its remaining frames without spending their time.
    if (watch_done) return true;

    const uint32_t until = millis() + ms;
    while ((int32_t)(millis() - (int32_t)until) < 0) {
        const uint32_t now = millis();
        if (!mic_pump_sample()) continue;

        if (mic_blow_detected()) {
            if (!watch_blowing) {
                watch_blowing = true;
                watch_blows++;
                if (watch_blows >= CLAIM_BLOWS) {
                    watch_done = true;
                    bank_all_off();
                    return true;
                }
            }
            watch_quiet_since = now;
            continue;
        }

        /*
         * Falling edge, debounced: the breath has to actually stop before
         * the next one counts. `mic_blow_detected()` reports a STREAK, not
         * an edge — without this one long breath would count as four and
         * the gesture would mean nothing.
         */
        if (watch_blowing && now - watch_quiet_since >= CLAIM_GAP_MS) {
            watch_blowing = false;
            mic_blow_reset();
        }
        if (!watch_blowing) watch_quiet_since = now;
    }
    return false;
}

// ── setup mode ───────────────────────────────────────────────────────────
//
// ══ WHAT THE CARD DOES WHILE THE PHONE DOES THE WORK ══
// Once armed, the card has nothing left to do: the keeper taps it and sets
// the name, the language and their duck on the web. The card just has to
// keep the URL live, and be leavable.
//
// So it waits, dark, listening. Four more blows retire the claim and end
// setup — the way out for somebody who armed a card they did not mean to,
// or who has finished and would rather the next tap open a duck.
//
// Here the count IS shown, one ducky frame per blow, because the banks are
// idle and the only person blowing at a card sitting in the dark is the
// one who meant to. That is the difference from the show, where counting
// would be noise to somebody who does not know the gesture exists.
//
// The CPU stays awake for this, which it does not during an ordinary
// fortune's live window. A few milliamps for the setup window costs a
// fraction of a percent of a CR2032, and setting a card up happens once.

bool claim_setup_wait(uint16_t seconds) {
    mic_blow_reset();
    bank_all_off();

    uint8_t blows = 0;
    bool blowing = false;
    uint32_t quiet_since = millis();
    const uint32_t opened = millis();
    const uint32_t limit = (uint32_t)seconds * 1000UL;

    while (millis() - opened < limit) {
        const uint32_t now = millis();
        if (!mic_pump_sample()) continue;

        if (mic_blow_detected()) {
            if (!blowing) {
                blowing = true;
                blows++;
                show_count(blows);
                if (blows >= CLAIM_BLOWS) {
                    bank_all_off();
                    return true;
                }
            }
            quiet_since = now;
            continue;
        }

        if (blowing && now - quiet_since >= CLAIM_GAP_MS) {
            blowing = false;
            mic_blow_reset();
        }
        if (!blowing) quiet_since = now;
    }

    bank_all_off();
    return false;
}

// ── arming ───────────────────────────────────────────────────────────────

static bool write_claim(uint16_t counter) {
    char hex[CARD_COUNTER_LEN + 1];
    char token[CARD_TOKEN_LEN + 1];
    card_counter_hex(counter, hex);
    card_token(FIRMWARE_SECRET, provision_serial(), counter, token);

    // The counter first. If the token write fails after it, the tag carries
    // a counter with a signature that does not match, and the server
    // refuses it — which is the correct outcome for a half-written arm.
    if (!ndef_write_span(NDEF_COUNTER_OFFSET, (const uint8_t *)hex, CARD_COUNTER_LEN)) {
        return false;
    }
    return ndef_write_span(NDEF_TOKEN_OFFSET, (const uint8_t *)token, CARD_TOKEN_LEN);
}

bool claim_arm() {
    if (!provision_ok()) return false;

    // Persisted BEFORE anything reaches the tag. The other order can hand
    // out a counter that the card forgets across a power cycle and then
    // re-issues, which the server sees as a replay and refuses — leaving a
    // card that armed once and never works again.
    const uint16_t counter = provision_bump_counter();
    if (counter == 0) return false;

    return write_claim(counter);
}

bool claim_disarm() {
    if (!provision_ok()) return false;
    // Counter 0 is what every card ships with and the one value the server
    // never accepts, so it is the natural "not armed". The signature is
    // rewritten to match rather than left stale — a valid signature over an
    // unusable counter is easier to reason about than a broken one.
    return write_claim(0);
}
