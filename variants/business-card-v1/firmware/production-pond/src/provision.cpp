#include "provision.h"

#include <Arduino.h>
#include <EEPROM.h>
#include <string.h>

#include "card_identity.h"
#include "config.h"
#include "ndef.h"
#include "ndef_record.h"

// FIRMWARE_SECRET. Gitignored — copy secrets.h.example and fill it in.
// Failing the build is the correct behaviour: a card flashed with a
// placeholder signs claims anyone can forge, and that is not something to
// discover after a hundred boards.
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy production-pond/src/secrets.h.example to secrets.h and set FIRMWARE_SECRET. It is gitignored on purpose."
#endif
#else
#include "secrets.h"
#endif

static bool s_ok = false;
static char s_serial[CARD_SERIAL_LEN + 1] = {0};

// SIGROW.SERNUM is ten bytes, factory-programmed and read-only. Read
// member by member rather than casting across the struct: the layout is
// not something worth assuming when getting it wrong changes every serial.
static void read_sernum(uint8_t out[10]) {
    out[0] = SIGROW.SERNUM0;
    out[1] = SIGROW.SERNUM1;
    out[2] = SIGROW.SERNUM2;
    out[3] = SIGROW.SERNUM3;
    out[4] = SIGROW.SERNUM4;
    out[5] = SIGROW.SERNUM5;
    out[6] = SIGROW.SERNUM6;
    out[7] = SIGROW.SERNUM7;
    out[8] = SIGROW.SERNUM8;
    out[9] = SIGROW.SERNUM9;
}

static void load_provision(card_provision_t *p) {
    uint8_t *raw = reinterpret_cast<uint8_t *>(p);
    for (uint16_t i = 0; i < sizeof(card_provision_t); i++) {
        raw[i] = EEPROM.read(PROVISION_EEPROM_ADDR + i);
    }
}

static void store_provision(const card_provision_t *p) {
    const uint8_t *raw = reinterpret_cast<const uint8_t *>(p);
    for (uint16_t i = 0; i < sizeof(card_provision_t); i++) {
        // update(), not write(): EEPROM has a finite cycle count and this
        // runs on a boot path.
        EEPROM.update(PROVISION_EEPROM_ADDR + i, raw[i]);
    }
}

bool provision_ok() { return s_ok; }
const char *provision_serial() { return s_serial; }

bool provision_ensure() {
    uint8_t sernum[10];
    read_sernum(sernum);
    card_serial(sernum, s_serial);

    card_provision_t saved;
    load_provision(&saved);

    if (card_provision_valid(&saved)) {
        // Already done, on some earlier boot that verified. Nothing to
        // write, and nothing to risk.
        s_ok = true;
        return true;
    }

    // ── UNPROVISIONED: build the whole record ───────────────────────────
    //
    // The counter starts at 0 and its signature ships with it. That is
    // safe: the server accepts a claim only when the counter EXCEEDS the
    // high-water mark it has stored, and cards.claim_counter starts at 0.
    // So this is a valid signature over a claim that can never be
    // accepted — and Phase 5's blow gesture only has to increment and
    // rewrite, with no second layout and no offsets moving.
    const uint16_t counter = 0;

    char token[CARD_TOKEN_LEN + 1];
    card_token(FIRMWARE_SECRET, s_serial, counter, token);

    uint8_t record[NDEF_RECORD_MAX];
    const size_t n = ndef_build(record, sizeof(record), s_serial, counter, token,
                                // '0' — no fortune. A card in a drawer must
                                // not advertise one it has not dealt.
                                '0');
    if (n == 0) return false;

    if (!ndef_write_record(record, n)) return false;

    // ── WRITTEN: prove it before believing it ───────────────────────────
    uint8_t check[NDEF_RECORD_MAX];
    if (!ndef_read_record(check, n)) return false;
    if (memcmp(record, check, n) != 0) {
        // Mismatch. Stay unprovisioned and try again next power-up rather
        // than shipping a card that believes it succeeded.
        return false;
    }

    // ── PROVISIONED ─────────────────────────────────────────────────────
    card_provision_t fresh;
    memset(&fresh, 0, sizeof(fresh));
    fresh.counter = counter;
    card_provision_seal(&fresh);
    store_provision(&fresh);

    s_ok = true;
    return true;
}
