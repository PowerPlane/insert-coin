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

bool claim_listen() {
    mic_blow_reset();

    uint8_t blows = 0;
    bool blowing = false;
    uint32_t quiet_since = millis();
    const uint32_t opened = millis();
    uint32_t last_blow = 0;

    show_count(0);

    for (;;) {
        const uint32_t now = millis();

        /*
         * ══ A DEADLINE MUST NOT LAND MID-BREATH ══
         * `mic_blow_detected()` only goes true after BLOW_DWELL_MS of
         * continuous air. Somebody who starts blowing just before a
         * deadline has a blow in flight that the detector has not yet
         * matured, and closing the window on the clock alone throws it
         * away — the gesture fails for the one person who was doing it
         * right, and does so more often the closer they are to the edge.
         *
         * So the deadlines only apply while the room is quiet. The hard
         * ceiling below still applies always, so noise cannot hold the
         * card here forever.
         */
        const bool hearing = mic_envelope() >= BLOW_THRESHOLD_ADC;

        // Nobody is claiming. Give the ordinary boot its two seconds back.
        if (!hearing && blows == 0 && now - opened >= CLAIM_FIRST_BLOW_MS) break;
        // Started and stopped — three blows is a failure, not a claim.
        if (!hearing && blows > 0 && now - last_blow >= CLAIM_BETWEEN_BLOWS_MS) break;
        // A ceiling regardless, so a noisy room cannot hold the card here.
        if (now - opened >= CLAIM_WINDOW_MS) break;

        if (!mic_pump_sample()) continue;

        if (mic_blow_detected()) {
            if (!blowing) {
                blowing = true;
                blows++;
                last_blow = now;
                show_count(blows);
                if (blows >= CLAIM_BLOWS) {
                    bank_all_off();
                    return true;
                }
            }
            quiet_since = now;
            continue;
        }

        // Falling edge, debounced: the breath has to actually stop before
        // the next one counts.
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
