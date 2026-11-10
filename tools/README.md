# tools

Helper scripts that run on David's machine.

- `build-hex.sh`: build one firmware environment and hand over the `.hex`
  with its SHA-256 (see [`docs/flasher/README.md`](../docs/flasher/README.md)).
- `test-build-hex.sh`: checks `build-hex.sh` without PlatformIO, including
  the warning for a `secrets.h` left at its pre-move path.
