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

int main(void) {
    printf("card_identity\n");
    test_siphash_reference();
    test_crockford();
    test_provision();
    test_token_shape();
    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
