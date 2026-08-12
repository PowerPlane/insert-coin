/*
 * Native test runner for card_identity.
 *
 * Runs on the host, not on the AVR, because everything it checks is pure
 * arithmetic — and because the one failure this module exists to prevent
 * (the C and the host script disagreeing) can only be caught somewhere
 * both of them can be reached.
 *
 *   cc -std=c99 -Wall -Wextra -Werror -o /tmp/ci \
 *      card_identity.c test_card_identity.c && /tmp/ci
 *
 * `npm test` in pond/ runs the same vectors against the TypeScript side.
 */

#include <stdio.h>
#include <string.h>

#include "card_identity.h"
#include "ndef_record.h"
#include "siphash_reference_vectors.h"

static int failures = 0;
static int checks = 0;

static void check(int ok, const char *what, const char *got, const char *want) {
    checks++;
    if (ok) return;
    failures++;
    printf("  FAIL  %s\n        got  %s\n        want %s\n", what, got, want);
}

static void hex64_le(uint64_t v, char out[17]) {
    /* The reference prints its digest as eight bytes little-endian. */
    static const char H[] = "0123456789abcdef";
    for (int i = 0; i < 8; i++) {
        const uint8_t b = (uint8_t)(v >> (8 * i));
        out[i * 2] = H[b >> 4];
        out[i * 2 + 1] = H[b & 0xF];
    }
    out[16] = '\0';
}

/* ── 1. The port, against the standard's own vectors ────────────────── */
static void test_siphash_reference(void) {
    uint8_t key[16];
    for (int i = 0; i < 16; i++) key[i] = (uint8_t)i;

    uint8_t msg[64];
    for (int i = 0; i < 64; i++) msg[i] = (uint8_t)i;

    for (int len = 0; len < 64; len++) {
        char got[17];
        hex64_le(siphash24(key, msg, (size_t)len), got);
        char what[64];
        snprintf(what, sizeof(what), "siphash24, message length %d", len);
        check(strcmp(got, SIPHASH_REF[len]) == 0, what, got, SIPHASH_REF[len]);
    }
}

/* ── 2. Crockford, which a person has to be able to read ───────────── */
static void test_crockford(void) {
    char out[CARD_SERIAL_LEN + 1];

    crockford40(0, out);
    check(strcmp(out, "00000000") == 0, "crockford40(0)", out, "00000000");

    crockford40(0xFFFFFFFFFFULL, out);
    check(strcmp(out, "ZZZZZZZZ") == 0, "crockford40(2^40-1)", out, "ZZZZZZZZ");

    /* Most significant group first: 1 in the top five bits and nothing
     * else means "10000000", not "00000001". Getting this backwards is
     * survivable on its own and fatal if only one side does it. */
    crockford40(1ULL << 35, out);
    check(strcmp(out, "10000000") == 0, "crockford40 is MSB-first", out, "10000000");

    /* The alphabet must not contain the four characters that read as
     * something else on a silkscreen. */
    crockford40(0x0123456789ULL, out);
    for (const char *p = out; *p; p++) {
        char what[48];
        snprintf(what, sizeof(what), "no ambiguous letter '%c'", *p);
        check(*p != 'I' && *p != 'L' && *p != 'O' && *p != 'U', what, out, "no I L O U");
    }
}

/* ── 3. The provisioning flag fails CLOSED ─────────────────────────── */
static void test_provision(void) {
    card_provision_t p = {0};
    p.counter = 0;
    card_provision_seal(&p);
    check(card_provision_valid(&p) == 1, "a sealed record is valid", "invalid", "valid");

    /* The whole reason this is not one byte: a single flipped bit in the
     * middle of a write must not read as "finished". */
    card_provision_t bad = p;
    bad.counter ^= 0x0040;
    check(card_provision_valid(&bad) == 0, "a corrupted counter is refused", "valid", "invalid");

    bad = p;
    bad.version = 0x02;
    check(card_provision_valid(&bad) == 0, "a future version is refused", "valid", "invalid");

    card_provision_t blank = {0};
    check(card_provision_valid(&blank) == 0, "erased EEPROM is not provisioned", "valid", "invalid");

    /* 0xFF is what an erased AVR EEPROM actually reads as, and it is the
     * single most likely thing to be sitting there on a first boot. */
    card_provision_t erased;
    memset(&erased, 0xFF, sizeof(erased));
    check(card_provision_valid(&erased) == 0, "0xFF EEPROM is not provisioned", "valid", "invalid");
}

/* ── 4. The counter, and the token's dependence on it ───────────────── */
static void test_token_shape(void) {
    char c[CARD_COUNTER_LEN + 1];
    card_counter_hex(0, c);
    check(strcmp(c, "0000") == 0, "counter 0", c, "0000");
    card_counter_hex(0xBEEF, c);
    check(strcmp(c, "beef") == 0, "counter 0xBEEF", c, "beef");
    card_counter_hex(0xFFFF, c);
    check(strcmp(c, "ffff") == 0, "counter 0xFFFF", c, "ffff");

    uint8_t secret[16];
    for (int i = 0; i < 16; i++) secret[i] = (uint8_t)(0xA0 + i);

    char t0[CARD_TOKEN_LEN + 1], t1[CARD_TOKEN_LEN + 1];
    card_token(secret, "7F3A9KQZ", 0, t0);
    card_token(secret, "7F3A9KQZ", 1, t1);
    check(strcmp(t0, t1) != 0, "the counter changes the token", t0, "something else");
    check(strlen(t0) == CARD_TOKEN_LEN, "token is 10 hex characters", t0, "10 chars");

    char other[CARD_TOKEN_LEN + 1];
    card_token(secret, "7F3A9KQY", 0, other);
    check(strcmp(t0, other) != 0, "the serial changes the token", t0, "something else");

    uint8_t wrong[16];
    for (int i = 0; i < 16; i++) wrong[i] = (uint8_t)(0xA0 + i);
    wrong[7] ^= 0x01;
    card_token(wrong, "7F3A9KQZ", 0, other);
    check(strcmp(t0, other) != 0, "the secret changes the token", t0, "something else");
}

/* ── 5. The NDEF record ─────────────────────────────────────────────── */
static void test_ndef(void) {
    char what[96];

    /* The offset config.h has been carrying as a magic number since before
     * the card wrote its own record. Derived here from the strings, so if
     * the URL ever changes the two cannot disagree — one of them is now
     * computed from the other's source. */
    snprintf(what, sizeof(what), "digit offset is 0x%04X", (unsigned)NDEF_DIGIT_OFFSET_DERIVED);
    check(NDEF_DIGIT_OFFSET_DERIVED == 0x0023, what, "derived", "0x0023");

    uint8_t buf[NDEF_RECORD_MAX];
    char token[CARD_TOKEN_LEN + 1];
    uint8_t secret[16];
    for (int i = 0; i < 16; i++) secret[i] = (uint8_t)i;
    card_token(secret, "7F3A9KQZ", 0, token);

    const size_t n = ndef_build(buf, sizeof(buf), "7F3A9KQZ", 0, token, '0');
    snprintf(what, sizeof(what), "record is %u bytes", (unsigned)n);
    check(n == NDEF_RECORD_MAX, what, "length", "NDEF_RECORD_MAX");

    /* A buffer one byte short must refuse rather than truncate. A truncated
     * record on a hundred cards is unrecoverable without a reflash. */
    check(ndef_build(buf, NDEF_RECORD_MAX - 1, "7F3A9KQZ", 0, token, '0') == 0,
          "refuses a short buffer", "wrote", "0");

    check(buf[0] == 0xE1, "CC magic", "?", "0xE1");
    check(buf[4] == 0x03, "NDEF TLV type", "?", "0x03");
    check(buf[5] == (uint8_t)NDEF_MESSAGE_LEN, "TLV length", "?", "message length");
    check(buf[6] == 0xD1 && buf[9] == 0x55, "record header and URI type", "?", "D1 .. 55");
    check(buf[8] == (uint8_t)NDEF_PAYLOAD_LEN, "payload length", "?", "payload length");
    check(buf[10] == 0x04, "URI prefix is https://", "?", "0x04");
    check(buf[n - 1] == 0xFE, "terminator TLV", "?", "0xFE");

    /* The digit really is where the derived constant says it is. */
    check(buf[NDEF_DIGIT_OFFSET_DERIVED] == '0', "digit sits at the derived offset",
          "?", "'0'");

    /* And the whole URL reads back as the thing we meant to write. */
    char url[NDEF_RECORD_MAX + 1];
    size_t u = 0;
    for (size_t i = NDEF_URI_TEXT_OFFSET; i < n - 1; i++) url[u++] = (char)buf[i];
    url[u] = '\0';
    char want[NDEF_RECORD_MAX + 1];
    snprintf(want, sizeof(want), "%s0&c=7F3A9KQZ&g=0000&t=%s", NDEF_URL_PREFIX, token);
    check(strcmp(url, want) == 0, "the URL reads back correctly", url, want);

    /* Patching the digit must move nothing else — that is the entire reason
     * the per-card suffix sits after it. */
    uint8_t four[NDEF_RECORD_MAX];
    ndef_build(four, sizeof(four), "7F3A9KQZ", 0, token, '4');
    int only_digit_differs = 1;
    for (size_t i = 0; i < n; i++) {
        if (i == NDEF_DIGIT_OFFSET_DERIVED) continue;
        if (buf[i] != four[i]) only_digit_differs = 0;
    }
    check(only_digit_differs, "the fortune digit is the only byte that moves", "?", "one byte");
}

int main(void) {
    printf("card_identity\n");
    test_siphash_reference();
    test_crockford();
    test_provision();
    test_token_shape();
    test_ndef();
    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
