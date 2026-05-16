# shared/tools

Helper scripts that aren't variant-specific.

Empty for now. Expected occupants:

- `flash.sh` — convenience wrapper around `pio run -e <env> -t upload` that picks up the FTDI port automatically.
- `gen-gerbers.sh` — KiCad CLI command for regenerating fab outputs without opening the GUI.
- `bom-merge.py` — merge a variant's `bom.csv` with shared part-numbers from a master spreadsheet, if we ever centralize sourcing.
