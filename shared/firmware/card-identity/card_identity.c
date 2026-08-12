/*
 * card_identity — implementation.
 *
 * Pure C99, no Arduino, no allocation, no libc beyond <stdint.h>. It
 * compiles for the ATtiny1616 and for the host from the same source,
 * because a second implementation of this is exactly the thing that would
 * make every card unknown at once.
 */

#include "card_identity.h"

/* ── SipHash-2-4 ───────────────────────────────────────────────────────
 *
 * A direct port of the reference implementation. Verified against its own
 * 64-message vector set in test_card_identity.c — the port is proved
 * against the standard, and only then is our framing of it proved against
 * card-identity.json.
 */

#define ROTL64(x, b) (uint64_t)(((x) << (b)) | ((x) >> (64 - (b))))

/*
 * One SipHash round, as a real function rather than a macro.
 *
 * ══ WHY noinline, WHICH LOOKS BACKWARDS ══
 * The reference implementation uses a macro, and on a 64-bit host inlining
 * eight copies of it is free and fast. On an 8-bit AVR it is neither: every
 * 64-bit add, XOR and rotate is synthesised from byte operations, so each
 * inlined round is hundreds of bytes of flash. Measured on the real build,
 * the inlined version cost 4,466 bytes — thirty-five per cent of a
 * 16 KB part — for a function that runs twice, at boot, where nothing is
 * waiting on it.
 *
 * Forcing one shared copy trades microseconds nobody can perceive for
 * kilobytes Phase 5 needs. The correctness is unchanged and the reference
 * vectors prove it.
 */
#if defined(__AVR__)
#define SIP_NOINLINE __attribute__((noinline))
#else
#define SIP_NOINLINE
#endif

static SIP_NOINLINE void sipround(uint64_t v[4]) {
    v[0] += v[1];
    v[1] = ROTL64(v[1], 13);
    v[1] ^= v[0];
    v[0] = ROTL64(v[0], 32);
    v[2] += v[3];
    v[3] = ROTL64(v[3], 16);
    v[3] ^= v[2];
    v[0] += v[3];
    v[3] = ROTL64(v[3], 21);
    v[3] ^= v[0];
    v[2] += v[1];
    v[1] = ROTL64(v[1], 17);
    v[1] ^= v[2];
    v[2] = ROTL64(v[2], 32);
}

static uint64_t load64_le(const uint8_t *p) {
    uint64_t out = 0;
    for (int i = 7; i >= 0; i--) out = (out << 8) | (uint64_t)p[i];
    return out;
}

uint64_t siphash24(const uint8_t key[16], const uint8_t *msg, size_t len) {
    const uint64_t k0 = load64_le(key);
    const uint64_t k1 = load64_le(key + 8);

    uint64_t v[4];
    v[0] = 0x736f6d6570736575ULL ^ k0;
    v[1] = 0x646f72616e646f6dULL ^ k1;
    v[2] = 0x6c7967656e657261ULL ^ k0;
    v[3] = 0x7465646279746573ULL ^ k1;

    const size_t left = len & 7;
    const uint8_t *end = msg + len - left;

    for (; msg != end; msg += 8) {
        const uint64_t m = load64_le(msg);
        v[3] ^= m;
        sipround(v);
        sipround(v);
        v[0] ^= m;
    }

    /* The final block carries the length in its top byte, which is what
     * stops two messages differing only in trailing zeros from colliding. */
    uint64_t b = ((uint64_t)len) << 56;
    for (size_t i = 0; i < left; i++) b |= ((uint64_t)msg[i]) << (8 * i);

    v[3] ^= b;
    sipround(v);
    sipround(v);
    v[0] ^= b;

    v[2] ^= 0xff;
    sipround(v);
    sipround(v);
    sipround(v);
    sipround(v);

    return v[0] ^ v[1] ^ v[2] ^ v[3];
}

/* ── The serial ────────────────────────────────────────────────────────
 *
 * "ducky.serial.v1" and a NUL — sixteen bytes exactly. PUBLIC: this is
 * domain separation, not a secret. Its whole job is to make sure the
 * serial derivation and the claim token can never produce related values,
 * and printing it in a document costs nothing.
 */
const uint8_t CARD_SERIAL_KEY[16] = {
    'd', 'u', 'c', 'k', 'y', '.', 's', 'e', 'r', 'i', 'a', 'l', '.', 'v', '1', 0,
};

/* No I, L, O or U. A serial gets read off a screen and typed by a person. */
static const char CROCKFORD[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

void crockford40(uint64_t value, char out[CARD_SERIAL_LEN + 1]) {
    /* Most significant group first, so the text reads in the same order as
     * the number. Eight groups of five bits is exactly forty. */
    for (int i = 0; i < CARD_SERIAL_LEN; i++) {
        const unsigned shift = (unsigned)(5 * (CARD_SERIAL_LEN - 1 - i));
        out[i] = CROCKFORD[(value >> shift) & 0x1F];
    }
    out[CARD_SERIAL_LEN] = '\0';
}

void card_serial(const uint8_t sernum[10], char out[CARD_SERIAL_LEN + 1]) {
    /* All ten bytes, not a slice of them. A hundred cards from one reel
     * share a lot number, so any fixed slice is partly constant across the
     * batch — see the note in the header. */
    const uint64_t h = siphash24(CARD_SERIAL_KEY, sernum, 10);
    crockford40(h & 0xFFFFFFFFFFULL, out);
}

/* ── The claim token ───────────────────────────────────────────────────*/

static const char HEX[] = "0123456789abcdef";

void card_counter_hex(uint16_t counter, char out[CARD_COUNTER_LEN + 1]) {
    for (int i = 0; i < CARD_COUNTER_LEN; i++) {
        const unsigned shift = (unsigned)(4 * (CARD_COUNTER_LEN - 1 - i));
        out[i] = HEX[(counter >> shift) & 0xF];
    }
    out[CARD_COUNTER_LEN] = '\0';
}

void card_token(const uint8_t secret[16], const char serial[CARD_SERIAL_LEN],
                uint16_t counter, char out[CARD_TOKEN_LEN + 1]) {
    /* serial ‖ counter, little-endian, no separator and no NUL. Ten bytes.
     * Pinned here because it is precisely the detail two implementations
     * would each guess differently, and the disagreement would be silent. */
    uint8_t msg[CARD_SERIAL_LEN + 2];
    for (int i = 0; i < CARD_SERIAL_LEN; i++) msg[i] = (uint8_t)serial[i];
    msg[CARD_SERIAL_LEN] = (uint8_t)(counter & 0xFF);
    msg[CARD_SERIAL_LEN + 1] = (uint8_t)(counter >> 8);

    const uint64_t h = siphash24(secret, msg, sizeof(msg));
    const uint64_t t = h & 0xFFFFFFFFFFULL;

    for (int i = 0; i < CARD_TOKEN_LEN; i++) {
        const unsigned shift = (unsigned)(4 * (CARD_TOKEN_LEN - 1 - i));
        out[i] = HEX[(t >> shift) & 0xF];
    }
    out[CARD_TOKEN_LEN] = '\0';
}

/* ── The provisioning flag ─────────────────────────────────────────────*/

/* CRC-8/ATM: polynomial 0x07, init 0x00, no reflection, no final XOR.
 * Small enough to be free on an AVR and strong enough for six bytes. */
uint8_t card_crc8(const uint8_t *data, size_t len) {
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t bit = 0; bit < 8; bit++) {
            crc = (uint8_t)((crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1));
        }
    }
    return crc;
}

/* The struct is serialised by hand rather than memcpy'd, because struct
 * padding differs between the host and AVR and this record is written by
 * one and could be inspected by the other. */
static void provision_bytes(const card_provision_t *p, uint8_t out[5]) {
    out[0] = p->magic0;
    out[1] = p->magic1;
    out[2] = p->version;
    out[3] = (uint8_t)(p->counter & 0xFF);
    out[4] = (uint8_t)(p->counter >> 8);
}

void card_provision_seal(card_provision_t *p) {
    p->magic0 = CARD_PROVISION_MAGIC0;
    p->magic1 = CARD_PROVISION_MAGIC1;
    p->version = CARD_PROVISION_VERSION;
    uint8_t buf[5];
    provision_bytes(p, buf);
    p->crc = card_crc8(buf, sizeof(buf));
}

int card_provision_valid(const card_provision_t *p) {
    if (p->magic0 != CARD_PROVISION_MAGIC0) return 0;
    if (p->magic1 != CARD_PROVISION_MAGIC1) return 0;
    if (p->version != CARD_PROVISION_VERSION) return 0;
    uint8_t buf[5];
    provision_bytes(p, buf);
    return p->crc == card_crc8(buf, sizeof(buf)) ? 1 : 0;
}
