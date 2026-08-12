/*
 * Building the NDEF record. Pure byte assembly — no I2C, no Arduino, so it
 * can be built and inspected on the host, which is the only place anyone
 * will ever actually read it.
 */

#include "ndef_record.h"

static size_t put(uint8_t *out, size_t at, const char *s, size_t n) {
    for (size_t i = 0; i < n; i++) out[at + i] = (uint8_t)s[i];
    return at + n;
}

size_t ndef_build(uint8_t *out, size_t cap, const char serial[CARD_SERIAL_LEN],
                  uint16_t counter, const char token[CARD_TOKEN_LEN], char digit) {
    if (cap < NDEF_RECORD_MAX) return 0;

    size_t at = 0;

    /* Capability Container. 0xE1 magic, version 1.0, 64 bytes of memory in
     * 8-byte units, read/write. Fixed for the ST25DV04K. */
    out[at++] = 0xE1;
    out[at++] = 0x40;
    out[at++] = 0x40;
    out[at++] = 0x00;

    /* NDEF message TLV: type 0x03, then the length. One byte is enough
     * while the message stays under 255, and a static assert below keeps
     * that true rather than trusting it. */
    out[at++] = 0x03;
    out[at++] = (uint8_t)NDEF_MESSAGE_LEN;

    /* Record header. MB|ME|SR|TNF=1 (well-known), type length 1, payload
     * length, type 'U' for URI. */
    out[at++] = 0xD1;
    out[at++] = 0x01;
    out[at++] = (uint8_t)NDEF_PAYLOAD_LEN;
    out[at++] = 0x55;

    /* URI identifier code 0x04 = "https://", which is eight characters the
     * tag does not have to store. */
    out[at++] = 0x04;

    at = put(out, at, NDEF_URL_PREFIX, NDEF_URL_PREFIX_LEN);

    /* The one byte that is ever patched again. Everything after it is
     * per-card and fixed for the life of the card. */
    out[at++] = (uint8_t)digit;

    at = put(out, at, "&c=", 3);
    at = put(out, at, serial, CARD_SERIAL_LEN);

    /* The claim counter and its signature ship from the very first boot,
     * carrying counter 0. That is deliberate and it is safe: the server
     * accepts a claim only when the counter is GREATER than the highest it
     * has seen, and `cards.claim_counter` starts at 0. So this record is a
     * valid signature over a claim that can never be accepted — and Phase
     * 5's blow gesture only has to increment and rewrite, with no second
     * record layout and no offsets moving underneath it. */
    at = put(out, at, "&g=", 3);
    {
        char g[CARD_COUNTER_LEN + 1];
        card_counter_hex(counter, g);
        at = put(out, at, g, CARD_COUNTER_LEN);
    }

    at = put(out, at, "&t=", 3);
    at = put(out, at, token, CARD_TOKEN_LEN);

    /* Terminator TLV. */
    out[at++] = 0xFE;

    return at;
}

/* The single-byte TLV length above is only valid while the message fits.
 * If the URL ever grows past this, the record needs a three-byte length
 * field and every offset moves — better to fail at compile time than to
 * write a truncated record onto a hundred cards. */
typedef char ndef_message_fits_one_byte[(NDEF_MESSAGE_LEN <= 0xFE) ? 1 : -1];
