#!/usr/bin/env bash
#
# Record one card, immediately after flashing it.
#
#   pio run -e production-pond -t upload    # the same binary, every time
#   ./tools/record-card.sh "the one for Sam"
#
# ══ WHY THIS EXISTS ══
# `&c=` is typed text like everything else in a URL, so a server that
# registered any serial it was shown could be told about cards that never
# existed. Phantom rows are not dangerous — a card with no ducks does
# nothing — but they make the Cards tab useless for the one question it has
# to answer: is this one of mine?
#
# So the server only accepts serials it already knows, and this is where it
# learns them. It costs no extra step: the programmer is already talking to
# the chip in order to flash it.
#
# ══ WHY IT DERIVES THE SERIAL HERE ══
# It could record only the raw SERNUM and let the importer derive. It
# derives here as well ON PURPOSE, and stores both: the importer re-derives
# from the SERNUM column and refuses the file if the two disagree. That
# disagreement — the flashing host computing a different serial from the
# firmware — is the one Phase 2 failure that is otherwise completely
# silent, and this is the cheapest place to catch it.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CSV="${CARDS_CSV:-$HERE/../cards.csv}"
POND="${POND_DIR:-$HERE/../../../pond}"
LABEL="${1:-}"

# ── find avrdude ────────────────────────────────────────────────────────
# It ships with PlatformIO's atmelmegaavr platform, which is already
# installed if you can flash at all. avrdude 8.x knows `sernum` as a named
# memory on UPDI parts, so there is nothing extra to install — an earlier
# version of this script called pymcuprog, which is NOT bundled and is not
# needed.
AVRDUDE="${AVRDUDE:-$HOME/.platformio/packages/tool-avrdude/avrdude}"
AVRDUDE_CONF="${AVRDUDE_CONF:-$HOME/.platformio/packages/tool-avrdude/avrdude.conf}"

if [ ! -x "$AVRDUDE" ]; then
    AVRDUDE="$(command -v avrdude || true)"
    AVRDUDE_CONF=""
fi
if [ -z "$AVRDUDE" ] || [ ! -x "$AVRDUDE" ]; then
    echo "avrdude not found. It ships with PlatformIO's atmelmegaavr platform;" >&2
    echo "run 'pio run -e production-pond' once to install it, or set AVRDUDE." >&2
    exit 1
fi

# ── find the programmer ─────────────────────────────────────────────────
PORT="${UPDI_PORT:-}"
if [ -z "$PORT" ]; then
    # The same FTDI the upload used. If there are several, be explicit.
    PORT="$(ls /dev/cu.usbserial-* /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"
fi
if [ -z "$PORT" ]; then
    echo "No USB serial port found. Plug the UPDI programmer in, or set" >&2
    echo "UPDI_PORT=/dev/cu.usbserial-XXXX" >&2
    exit 1
fi

# ── read SIGROW.SERNUM ──────────────────────────────────────────────────
# Ten bytes, factory-programmed, read-only. `-qq` keeps avrdude quiet so the
# only thing on stdout is the hex dump; `:h` is one `0xNN,` list.
RAW="$("$AVRDUDE" \
        ${AVRDUDE_CONF:+-C "$AVRDUDE_CONF"} \
        -p t1616 -c serialupdi -P "$PORT" -b "${UPDI_BAUD:-230400}" \
        -qq -U sernum:r:-:h 2>/dev/null || true)"

# ══ EACH FIELD IS PADDED SEPARATELY, AND THAT IS THE WHOLE POINT ══
# avrdude does NOT zero-pad: a byte below 0x10 prints as `0x6`, not `0x06`.
# Stripping the `0x` and concatenating therefore drops a nibble and yields
# nineteen characters instead of twenty — which is not a silent corruption,
# it fails the length check below, but it fails on 48% OF ALL CARDS
# (1 - (15/16)^10 — the chance that at least one of ten bytes is < 0x10).
#
# The first card ever flashed happened to have all ten bytes >= 0x10 and
# recorded perfectly. The second one did not. This is exactly why the
# done-when is two cards and not one.
SERNUM="$(printf '%s' "$RAW" \
          | tr -d '[:space:]' \
          | tr ',' '\n' \
          | sed -n 's/^0[xX]\([0-9A-Fa-f]\{1,2\}\)$/\1/p' \
          | awk '{ printf "%02s", tolower($0) }' \
          | tr ' ' '0')"

if [ "${#SERNUM}" -ne 20 ]; then
    echo "Expected twenty hex characters of SIGROW.SERNUM, got '${SERNUM}'" >&2
    echo >&2
    echo "avrdude said:" >&2
    printf '%s\n' "$RAW" | sed 's/^/  /' >&2
    echo >&2
    echo "Check that the card is powered from its own cell (not the FTDI)," >&2
    echo "that UPDI_PORT is right (currently ${PORT}), and the 4.7k resistor." >&2
    exit 1
fi

# ── derive the serial, using the ONE definition ─────────────────────────
# Deliberately not reimplemented in bash. shared/firmware/card-identity is
# the single source and this calls into it, rather than becoming a third
# derivation that could drift from the other two.
SERIAL="$(cd "$POND" && npx --no-install tsx tools/derive-serial.ts "$SERNUM")"

if [ "${#SERIAL}" -ne 8 ]; then
    echo "Deriving the serial failed; got '${SERIAL}'." >&2
    echo "Run 'npm test' in ${POND} — card-identity.test.ts is the check." >&2
    exit 1
fi

# ── append ──────────────────────────────────────────────────────────────
if [ ! -f "$CSV" ]; then
    echo "serial,sernum,recorded,label" > "$CSV"
fi

if grep -q "^${SERIAL}," "$CSV"; then
    echo "!! ${SERIAL} is ALREADY in ${CSV}" >&2
    echo >&2
    echo "   Either this card was recorded already, or two chips derived the" >&2
    echo "   same serial — which would make two physical cards" >&2
    echo "   indistinguishable. Check which before flashing any more." >&2
    exit 1
fi

printf '%s,%s,%s,%s\n' "$SERIAL" "$SERNUM" "$(date +%s)" "$LABEL" >> "$CSV"

echo
echo "  recorded  ${SERIAL}"
echo "  SERNUM    ${SERNUM}"
echo
echo "Now: battery in, wait for the confirmation pattern, then tap it."
echo "The URL must read"
echo
echo "  https://ducky.davidyang.work/?d=0&c=${SERIAL}&g=0000&t=..."
echo
echo "If the &c= does not match character for character, STOP — the firmware"
echo "and this script are deriving different serials, and every card would"
echo "be unknown to the server."
echo
echo "When the batch is done:"
echo "  cd ${POND} && npm run cards:import -- ${CSV}"
