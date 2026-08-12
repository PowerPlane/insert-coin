/*
 * card_identity — how a card works out who it is, and proves it.
 *
 * ══ WHY THIS IS A SHARED, ARDUINO-FREE MODULE ══
 * Every value here is derived TWICE: once in C on the ATtiny1616 as it
 * writes its own NDEF record, and once on the host as the flashing script
 * records the same card in cards.csv. If those two derivations disagree by
 * so much as a bit order, EVERY card is unknown to the server at once —
 * and it fails quietly, because an unknown serial is designed to degrade
 * rather than error. The visitor still gets a fortune; the duck is just
 * unattributed, forever, on all hundred cards.
 *
 * So this file is the single definition, it has no Arduino dependency, and
 * it compiles for the host as well as for AVR. `card-identity.json` next to
 * it is the pinned specification with test vectors, and both sides are
 * tested against that same file rather than against each other.
 *
 * Nothing here allocates, and nothing here is longer than the 2 KB of RAM
 * an ATtiny1616 has.
 */

#ifndef CARD_IDENTITY_H
#define CARD_IDENTITY_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── SipHash-2-4 ────────────────────────────────────────────────────────
 *
 * Chosen over HMAC-SHA256 because it is built for exactly this shape of
 * problem: short messages, keyed, ~200 bytes of code, fast on an 8-bit AVR
 * with 2 KB of RAM. Verified against the reference implementation's own
 * 64-message vector set, not just against our own expectations.
 */
uint64_t siphash24(const uint8_t key[16], const uint8_t *msg, size_t len);

/* ── The card's serial ──────────────────────────────────────────────────
 *
 * Eight Crockford base32 characters, written into the tag as `&c=`.
 *
 * ══ REVISED FROM THE PLAN, AND WHY ══
 * BUILD-PLAN says "eight characters from the low 40 bits" of
 * SIGROW.SERNUM. Taking raw bits is the wrong move, for a reason
 * PROVISIONING.md already worried about in its bench checklist: SERNUM is
 * lot number, wafer number and die coordinates, and a hundred cards built
 * from one reel share a lot. Whichever 40 bits you slice, some of them are
 * CONSTANT across the batch — so the "4 in a billion" collision estimate,
 * which assumes 40 uniform bits, would not have been true of the thing it
 * was describing.
 *
 * Hashing all ten bytes and taking 40 bits of the digest uses every bit of
 * entropy the chip has, makes the distribution uniform, and makes that
 * estimate honest. It costs nothing: SipHash is in the binary anyway for
 * the claim token.
 *
 * The key is a PUBLIC domain-separation constant, not a secret. It exists
 * so the serial derivation and the claim token can never collide into each
 * other, and it is safe to print in a document.
 */
extern const uint8_t CARD_SERIAL_KEY[16];

#define CARD_SERIAL_LEN 8   /* 40 bits / 5 bits per character */

/* Writes CARD_SERIAL_LEN characters plus a NUL. `sernum` is the ten bytes
 * of SIGROW.SERNUM, in the order the chip presents them. */
void card_serial(const uint8_t sernum[10], char out[CARD_SERIAL_LEN + 1]);

/* Crockford base32, most significant group first. The alphabet omits I, L,
 * O and U so nothing a person reads off a silkscreen is ambiguous. */
void crockford40(uint64_t value, char out[CARD_SERIAL_LEN + 1]);

/* ── The claim token ────────────────────────────────────────────────────
 *
 * The card SIGNS its claim. An earlier design accepted an unseen counter as
 * proof, which was not a credential at all: everything in the URL is typed
 * text, so an unseen number proves only that nobody used THAT number yet.
 *
 *   token = SipHash-2-4(FIRMWARE_SECRET, serial ‖ counter) truncated to 40 bits
 *
 * The message is pinned exactly: the eight ASCII serial characters,
 * followed by the counter as two bytes LITTLE-ENDIAN. Ten bytes, no
 * separator, no NUL. Written down because it is precisely the sort of
 * detail two implementations would each guess differently.
 *
 * The output is the LOW 40 bits of the 64-bit digest, rendered as ten
 * LOWERCASE hex characters, most significant nibble first.
 */
#define CARD_TOKEN_LEN 10   /* 40 bits as hex */
#define CARD_COUNTER_LEN 4  /* 16 bits as hex */

void card_token(const uint8_t secret[16], const char serial[CARD_SERIAL_LEN],
                uint16_t counter, char out[CARD_TOKEN_LEN + 1]);

/* The counter as it appears in `&g=`: four lowercase hex characters. */
void card_counter_hex(uint16_t counter, char out[CARD_COUNTER_LEN + 1]);

/* ── The provisioning flag ──────────────────────────────────────────────
 *
 * Held in the MCU's own EEPROM. Deliberately NOT one byte: a single byte
 * can be corrupted mid-write into something that looks provisioned,
 * stranding a card with a half-written record and no way to notice. A
 * versioned magic plus a checksum fails closed instead — a card that
 * cannot prove it finished simply tries again on the next power-up.
 */
#define CARD_PROVISION_MAGIC0 0x50 /* 'P' */
#define CARD_PROVISION_MAGIC1 0x44 /* 'D' */
#define CARD_PROVISION_VERSION 0x01

typedef struct {
    uint8_t magic0;
    uint8_t magic1;
    uint8_t version;
    uint16_t counter; /* the claim counter, kept across power cycles */
    uint8_t crc;      /* CRC-8/ATM over the five preceding bytes */
} card_provision_t;

uint8_t card_crc8(const uint8_t *data, size_t len);
void card_provision_seal(card_provision_t *p);   /* fills version/magic/crc */
int card_provision_valid(const card_provision_t *p); /* 1 if trustworthy */

#ifdef __cplusplus
}
#endif

#endif /* CARD_IDENTITY_H */
