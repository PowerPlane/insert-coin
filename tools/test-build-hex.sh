#!/usr/bin/env bash
#
# Checks build-hex.sh's stranded-secret guard without PlatformIO.
#
# git moves tracked files when the layout changes, but secrets.h is ignored,
# so after a pull it stays behind at the old path. The build must say where
# to move it, not fail on a missing header.
#
#   tools/test-build-hex.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLD="variants/business-card-v1/firmware/production-pond/src/secrets.h"
FAIL=0

repo() {
  local T
  T="$(mktemp -d)"
  mkdir -p "$T/tools" "$T/firmware/production-pond/src"
  cp "$HERE/build-hex.sh" "$T/tools/"
  echo "$T"
}

# 1. Secret stranded at the old path: exit 1 and print the exact move.
T="$(repo)"
mkdir -p "$T/$(dirname "$OLD")" && touch "$T/$OLD"
OUT="$(bash "$T/tools/build-hex.sh" 2>&1)"; CODE=$?
if [ "$CODE" -ne 1 ] || ! grep -qF "mv $OLD firmware/production-pond/src/secrets.h" <<<"$OUT"; then
  echo "FAIL stranded secret: exit $CODE, output: $OUT"; FAIL=1
else
  echo "ok   stranded secret names the move"
fi
rm -rf "$T"

# 2. Nothing at the old path: the guard stays silent.
T="$(repo)"
OUT="$(bash "$T/tools/build-hex.sh" 2>&1)"
if grep -qF "old path" <<<"$OUT"; then
  echo "FAIL guard spoke with nothing stranded: $OUT"; FAIL=1
else
  echo "ok   no stranded secret, no guard message"
fi
rm -rf "$T"

exit "$FAIL"
