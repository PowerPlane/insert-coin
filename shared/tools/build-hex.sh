#!/usr/bin/env bash
#
# Build one firmware environment and hand over the .hex.
#
#   shared/tools/build-hex.sh                 # production-pond, to ~/Desktop
#   shared/tools/build-hex.sh bringup ~/tmp   # another env, another folder
#
# Prints the SHA-256 of the file it wrote. The flasher page prints the
# SHA-256 of the file dropped on it. Read the first eight characters to
# each other and you know it is the same file.
#
# Does NOT flash anything and does NOT touch the firmware sources. It runs
# `pio run -e <env>` exactly as the README does and copies the result out
# of .pio/build/ with the commit in its name.

set -euo pipefail

ENV="${1:-production-pond}"
DEST="${2:-$HOME/Desktop}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FW="$HERE/../../variants/business-card-v1/firmware"
cd "$FW"

if [ "$ENV" = "production-pond" ]; then
  SECRETS="production-pond/src/secrets.h"
  if [ ! -f "$SECRETS" ]; then
    echo "error: $SECRETS is missing. Copy secrets.h.example to secrets.h and fill it in." >&2
    exit 1
  fi
  # The example is sixteen zero bytes over two lines. A card built with it
  # signs claims anyone can forge, and never registers in the pond.
  if [ "$(grep -c '0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,' "$SECRETS")" -ge 2 ]; then
    echo "error: $SECRETS still holds the all-zero placeholder key." >&2
    exit 1
  fi
fi

command -v pio >/dev/null || export PATH="$HOME/.platformio/penv/bin:$PATH"
pio run -e "$ENV"

SHA="$(git rev-parse --short HEAD)"
# Against HEAD, so staged-but-uncommitted changes count too, and the
# porcelain check catches an untracked source file.
DIRTY=""
if ! git diff --quiet HEAD -- . || [ -n "$(git status --porcelain -- .)" ]; then DIRTY="-dirty"; fi
mkdir -p "$DEST"
OUT="$DEST/insert-coin-$ENV-$SHA$DIRTY.hex"
cp ".pio/build/$ENV/firmware.hex" "$OUT"

if command -v shasum >/dev/null; then
  DIGEST="$(shasum -a 256 "$OUT" | cut -c1-64)"
else
  DIGEST="$(sha256sum "$OUT" | cut -c1-64)"
fi

echo
echo "wrote   $OUT"
echo "sha256  ${DIGEST:0:4} ${DIGEST:4:4}   ($DIGEST)"
echo
echo "Send the file to whoever is flashing. They open:"
echo "  https://ducky.davidyang.work/flash"
