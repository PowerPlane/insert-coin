#!/usr/bin/env bash
#
# Regenerate card-identity.json from the C implementation.
#
# The vectors are GENERATED, never hand-written. A hand-written vector
# agrees with whatever the author believed at the time, which is exactly the
# belief the file exists to check. Generating them from card_identity.c and
# then testing the TypeScript side against the result means the two
# implementations are compared through an artifact neither one authored.
#
# Run this only when the specification itself changes — and when you do,
# expect the pond tests to fail until the host side is brought back in step.
# That failure is the whole point of the file.
#
#   ./regenerate.sh && (cd ../../../pond && npm test)

set -euo pipefail
cd "$(dirname "$0")"

CC=${CC:-cc}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# The generator is kept here rather than in a checked-in .c file: it exists
# only to print vectors, and a second source file that must stay in step
# with the spec is one more thing to drift.
cat > "$OUT/gen.c" <<'GEN'
#include <stdio.h>
#include "card_identity.h"

static void dump_serial(const char *label, const uint8_t s[10], int last) {
    char out[CARD_SERIAL_LEN + 1];
    card_serial(s, out);
    printf("    { \"note\": \"%s\", \"sernum\": \"", label);
    for (int i = 0; i < 10; i++) printf("%02x", s[i]);
    printf("\", \"serial\": \"%s\" }%s\n", out, last ? "" : ",");
}

int main(void) {
    uint8_t a[10] = {0,0,0,0,0,0,0,0,0,0};
    uint8_t b[10] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    /* Two chips from one reel: identical lot, one die coordinate apart.
       This is the case the hashed derivation exists for. */
    uint8_t c[10] = {0x41,0x32,0x30,0x37,0x35,0x31,0x0A,0x14,0x07,0x00};
    uint8_t d[10] = {0x41,0x32,0x30,0x37,0x35,0x31,0x0A,0x14,0x08,0x00};
    uint8_t e[10] = {0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09};
    puts("  \"serials\": [");
    dump_serial("all zero", a, 0);
    dump_serial("all ones", b, 0);
    dump_serial("reel sibling A", c, 0);
    dump_serial("reel sibling B, one die coordinate away", d, 0);
    dump_serial("counting bytes", e, 1);
    puts("  ],");

    uint8_t key[16];
    for (int i = 0; i < 16; i++) key[i] = (uint8_t)i;
    const char *serials[3] = {"7F3A9KQZ", "00000000", "ZZZZZZZZ"};
    uint16_t counters[4] = {0, 1, 0xBEEF, 0xFFFF};
    puts("  \"tokens\": [");
    for (int s = 0; s < 3; s++)
        for (int k = 0; k < 4; k++) {
            char t[CARD_TOKEN_LEN + 1], g[CARD_COUNTER_LEN + 1];
            card_token(key, serials[s], counters[k], t);
            card_counter_hex(counters[k], g);
            printf("    { \"serial\": \"%s\", \"counter\": %u, \"counter_hex\": \"%s\", \"token\": \"%s\" }%s\n",
                   serials[s], (unsigned)counters[k], g, t,
                   (s == 2 && k == 3) ? "" : ",");
        }
    puts("  ]");
    return 0;
}
GEN

"$CC" -std=c99 -Wall -Wextra -Werror -O2 -I. -o "$OUT/gen" card_identity.c "$OUT/gen.c"

{
    cat spec-header.json.part
    "$OUT/gen"
    echo "}"
} > card-identity.json

python3 -c "import json; d = json.load(open('card-identity.json')); \
print('card-identity.json:', len(d['serials']), 'serials,', len(d['tokens']), 'tokens')"
