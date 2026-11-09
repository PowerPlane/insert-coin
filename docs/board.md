# business-card-v1

The first Insert Coin variant: a 2-layer PCB cut to standard business-card size with a CR2032 holder on the front, a 24-LED matrix, a MEMS microphone, and an NFC tag.

## Highlights

| | |
|---|---|
| **Form factor** | Business card — roughly 85 × 54 mm |
| **MCU** | ATtiny1616-M (Microchip, AVR tinyAVR 1-series, 16 kB flash, 2 kB SRAM, VQFN-20) |
| **Power** | CR2032 coin cell (the "coin" you insert to activate the card) |
| **Display** | 24 × red LEDs driven through 9 MOSFETs (multiplexed matrix) |
| **Audio in** | 1 × MEMS microphone (ZTS6156) — sound-reactive interaction |
| **NFC** | ST25DV04K-IER8C3 (I²C dynamic NFC tag, 4 Kb EEPROM, tap-to-launch URL) |
| **Programming** | UPDI (single-wire) via SerialUPDI |

## Status

- ✅ **Hardware**: Schematic + layout complete (KiCad), fab package generated.
- ⏳ **Firmware**: Bring-up and production firmware planned — see [`firmware/`](firmware/).
- ⏳ **Enclosure**: 3D-printed sleeve / mailer holder — see [`enclosure/`](enclosure/).

## Known caveats

- The fab zip inside [`hardware/production/`](hardware/production/) is named `Ducky-Business-Card_0-1.zip` — a leftover from a forked fabrication-toolkit config. The board *itself* is the Insert Coin design; only the zip filename is wrong. Will be corrected on the next fab run.

## Hardware files

- `hardware/Insert-Coin-Business-Card.kicad_pro` — open this in KiCad to view the schematic and PCB.
- `hardware/production/` — BOM (`bom.csv`), pick-and-place positions (`positions.csv`), designator map, IPC netlist, and the (mis-named) fab zip.
