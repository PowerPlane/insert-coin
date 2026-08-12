#!/usr/bin/env bash
#
# Record one card, immediately after flashing it.
#
#   pio run -e production-pond -t upload    # the same binary, every time
#   ./tools/record-card.sh                  # reads SIGROW, appends cards.csv
#
# ══ WHY THIS EXISTS ══
# `&c=` is typed text like everything else in a URL, so a server that
# registered any serial it was shown could be told about cards that never
# existed. Phantom rows are not dangerous — a card with no ducks does
# nothing — but they make the Cards tab useless for the one question it has
# to answer: is this one of mine?
#
# So the server only accepts serials it already knows, and this is where it
# learns them. It costs no extra step: the programmer is reading SIGROW
# anyway in order to flash.
#
# ══ WHY IT DERIVES THE SERIAL HERE ══
# It could just record the raw SERNUM and let the importer derive. It
# derives here as well ON PURPOSE, and stores both: the importer re-derives
# from the SERNUM column and refuses the file if the two disagree. That
# disagreement — the flashing host computing a different serial from the
# firmware — is the one Phase 2 failure that is otherwise completely silent,
# and this is the cheapest place to catch it.
#
# NOT YET RUN AGAINST REAL HARDWARE. The pymcuprog invocation below is the
# part to check first; everything after it is exercised by
# pond/test/cards-csv.test.ts.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CSV="${CARDS_CSV:-$HERE/../cards.csv}"
POND="${POND_DIR:-$HERE/../../../pond}"
LABEL="${1:-}"

# ── read SIGROW.SERNUM ──────────────────────────────────────────────────
# pymcuprog ships with PlatformIO's atmelmegaavr platform and talks to the
# same UPDI programmer the upload used. `-d attiny1616` must match the board.
#
# The device-info output carries the serial as a hex string; ten bytes.
if ! command -v pymcuprog >/dev/null 2>&1; then
    echo "pymcuprog not found. It ships with PlatformIO's atmelmegaavr" >&2
    echo "platform — try: pip install pymcuprog" >&2
    exit 1
fi

RAW="$(pymcuprog -d attiny1616 -t uart -u "${UPDI_PORT:-/dev/tty.usbserial-*}" ping 2>/dev/null \
       | grep -iE 'serial ?number' | head -1 | tr -cd '0-9A-Fa-f')"

SERNUM="$(printf '%s' "$RAW" | tr 'A-F' 'a-f')"

if [ "${#SERNUM}" -ne 20 ]; then
    echo "Expected twenty hex characters of SIGROW.SERNUM, got '${SERNUM}'" >&2
    echo "Check UPDI_PORT and that the board is powered." >&2
    exit 1
fi

# ── derive the serial, using the ONE definition ─────────────────────────
# Deliberately not reimplemented in bash. shared/firmware/card-identity is
# the single source, and this calls into it rather than making a third
# derivation that could drift from the other two.
SERIAL="$(cd "$POND" && npx tsx -e "
import { cardSerial } from './src/card/identity.ts';
const hex = '${SERNUM}';
const bytes = new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
process.stdout.write(cardSerial(bytes));
")"

# ── append ──────────────────────────────────────────────────────────────
if [ ! -f "$CSV" ]; then
    echo "serial,sernum,recorded,label" > "$CSV"
fi

if grep -q "^${SERIAL}," "$CSV"; then
    echo "!! ${SERIAL} is ALREADY in ${CSV}" >&2
    echo "   Either this card was already recorded, or two chips derived the" >&2
    echo "   same serial — which would make them indistinguishable. Check" >&2
    echo "   before flashing any more." >&2
    exit 1
fi

printf '%s,%s,%s,%s\n' "$SERIAL" "$SERNUM" "$(date +%s)" "$LABEL" >> "$CSV"

echo "recorded ${SERIAL}  (SERNUM ${SERNUM})"
echo
echo "Now: battery in, wait for the confirmation pattern, then tap it."
echo "The URL must read  ...?d=0&c=${SERIAL}&g=0000&t=..."
echo
echo "When the batch is done:"
echo "  cd ${POND} && npm run cards:import -- ${CSV}"
