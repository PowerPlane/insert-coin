/*
 * The whole NDEF record a card writes into its own tag on first boot.
 *
 * ══ WHAT CHANGED, AND WHY IT MATTERS ══
 * Until now a phone tag-writer wrote the record and the MCU patched one
 * byte of it. That made the layout a fact living in two places — a comment
 * in config.h and whatever somebody typed into an app — with a magic
 * number, NDEF_DIGIT_OFFSET, joining them. Getting that number wrong
 * patches the wrong byte and the card serves a broken URL forever.
 *
 * Now the card writes the record itself, so the layout has exactly one
 * definition. Every offset here is DERIVED from the strings at compile
 * time. The digit offset is not a number anyone maintains; it is
 * `sizeof` the prefix, and it cannot drift from the thing it indexes.
 *
 * Nothing here allocates. The caller supplies the buffer, and
 * NDEF_RECORD_MAX is a compile-time bound on it.
 */

#ifndef NDEF_RECORD_H
#define NDEF_RECORD_H

#include <stdint.h>
#include <stddef.h>

#include "card_identity.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The host, without the "https://" that the URI prefix byte 0x04 encodes,
 * and up to and including the "=" of the fortune parameter. The digit sits
 * at exactly this length past the start of the URI text. */
#define NDEF_URL_PREFIX "ducky.davidyang.work/?d="

/* sizeof includes the NUL, which is not written. */
#define NDEF_URL_PREFIX_LEN (sizeof(NDEF_URL_PREFIX) - 1)

/* ── The map ────────────────────────────────────────────────────────────
 *
 *   0x0000  CC file           E1 40 40 00
 *   0x0004  NDEF TLV          03 <message length>
 *   0x0006  record header     D1 01 <payload length> 55
 *   0x000A  URI prefix        04                     ("https://")
 *   0x000B  host and "?d="    NDEF_URL_PREFIX
 *   ....    the fortune digit  <-- the ONE byte patched per tap
 *   ....    "&c=" + serial     8 characters
 *   ....    "&g=" + counter    4 hex characters
 *   ....    "&t=" + token      10 hex characters
 *   ....    terminator TLV    FE
 *
 * `&c=`, `&g=` and `&t=` all sit AFTER the digit, so the patch target
 * never moves and every card still runs one identical binary.
 */

#define NDEF_CC_LEN 4
#define NDEF_TLV_HEADER_LEN 2
#define NDEF_RECORD_HEADER_LEN 4
#define NDEF_URI_PREFIX_LEN 1 /* the 0x04 byte */

/* Where the URI text starts, and therefore where the digit lands. */
#define NDEF_URI_TEXT_OFFSET \
    (NDEF_CC_LEN + NDEF_TLV_HEADER_LEN + NDEF_RECORD_HEADER_LEN + NDEF_URI_PREFIX_LEN)

/* THE patch target. Derived, not chosen. */
#define NDEF_DIGIT_OFFSET_DERIVED (NDEF_URI_TEXT_OFFSET + NDEF_URL_PREFIX_LEN)

/*
 * ══ WHERE THE CLAIM LIVES, DERIVED LIKE EVERYTHING ELSE ══
 * Arming a card rewrites two spans in place — the counter and the token —
 * rather than the whole 68-byte record, because a re-arm happens with a
 * person waiting rather than once on a bench. Fourteen bytes is ~84 ms
 * against ~408 ms for the record.
 *
 * The digit's offset is the anchor and does not move, so these follow it
 * by construction. Do not write these numbers down anywhere else.
 */
#define NDEF_LABEL_LEN 3 /* "&c=", "&g=", "&t=" are all three bytes */

/* The four hex characters of "&g=", not the label. */
#define NDEF_COUNTER_OFFSET                                          \
    (NDEF_DIGIT_OFFSET_DERIVED + 1 + NDEF_LABEL_LEN + CARD_SERIAL_LEN \
     + NDEF_LABEL_LEN)

/* The ten hex characters of "&t=", not the label. */
#define NDEF_TOKEN_OFFSET \
    (NDEF_COUNTER_OFFSET + CARD_COUNTER_LEN + NDEF_LABEL_LEN)

/* "&c=" + serial, "&g=" + counter, "&t=" + token. */
#define NDEF_SUFFIX_LEN \
    (3 + CARD_SERIAL_LEN + 3 + CARD_COUNTER_LEN + 3 + CARD_TOKEN_LEN)

/* Everything after the URI prefix byte: text, digit, suffix. */
#define NDEF_URI_LEN (NDEF_URL_PREFIX_LEN + 1 + NDEF_SUFFIX_LEN)

/* The record payload the header counts: the prefix byte plus the URI. */
#define NDEF_PAYLOAD_LEN (NDEF_URI_PREFIX_LEN + NDEF_URI_LEN)

/* The message the TLV counts. */
#define NDEF_MESSAGE_LEN (NDEF_RECORD_HEADER_LEN + NDEF_PAYLOAD_LEN)

/* Everything written to the tag, terminator included. */
#define NDEF_RECORD_MAX (NDEF_CC_LEN + NDEF_TLV_HEADER_LEN + NDEF_MESSAGE_LEN + 1)

/*
 * Build the complete record.
 *
 * `digit` is '0'..'4'. First boot writes '0' — no fortune — because the
 * card has not been tapped yet and a card sitting in a drawer must not
 * advertise one.
 *
 * Returns the number of bytes written, or 0 if the buffer is too small.
 */
size_t ndef_build(uint8_t *out, size_t cap, const char serial[CARD_SERIAL_LEN],
                  uint16_t counter, const char token[CARD_TOKEN_LEN], char digit);

#ifdef __cplusplus
}
#endif

#endif /* NDEF_RECORD_H */
