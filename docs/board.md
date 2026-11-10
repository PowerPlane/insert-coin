# The board

The Ducky business card (`business-card-v1`): a 2-layer PCB cut to standard business-card size with a CR2032 holder on the front, a 24-LED matrix, a MEMS microphone, and an NFC tag.

## Highlights

| | |
|---|---|
| **Form factor** | Business card, roughly 85 × 54 mm |
| **MCU** | ATtiny1616-M (Microchip, AVR tinyAVR 1-series, 16 kB flash, 2 kB SRAM, VQFN-20) |
| **Power** | CR2032 coin cell (the "coin" you insert to activate the card) |
| **Display** | 24 × red LEDs driven through 9 MOSFETs (multiplexed matrix) |
| **Audio in** | 1 × MEMS microphone (ZTS6156), sound-reactive interaction |
| **NFC** | ST25DV04K-IER8C3 (I²C dynamic NFC tag, 4 Kb EEPROM, tap-to-launch URL) |
| **Programming** | UPDI (single-wire) via SerialUPDI |

## Status

- **Hardware**: V0-1 and V0-2 fabbed (KiCad 10); V0-3 started as a copy of V0-2. See the table below.
- **Firmware**: bring-up and production environments in [`firmware/`](../firmware/).
- **Enclosure**: see [`enclosure/`](../enclosure/).

## Hardware files

Each board revision has its own folder under [`hardware/`](../hardware/). Open the `.kicad_pro` inside one in KiCad to view its schematic and PCB.

| Revision | Folder | Project file | Fab outputs |
|---|---|---|---|
| V0-1 | [`Ducky Business Card V0-1/`](../hardware/Ducky%20Business%20Card%20V0-1/) | `Insert-Coin-Business-Card.kicad_pro` | yes |
| V0-2 | [`Ducky-Business-Card-V0-2/`](../hardware/Ducky-Business-Card-V0-2/) | `Ducky-Business-Card-V0-2.kicad_pro` | yes |
| V0-3 | [`Ducky-Business-Card-V0-3/`](../hardware/Ducky-Business-Card-V0-3/) | `Ducky-Business-Card-V0-3.kicad_pro` | not yet (started as a copy of V0-2) |

A revision's `production/` folder holds the BOM (`bom.csv`), pick-and-place positions (`positions.csv`), designator map, IPC netlist, and the fab zip. V0-1 and V0-2 share the same BOM and MCU pin nets, so the firmware's `pins.h` fits both.

All three use the `DavidLib_Mechanical` footprints from kicad-libraries for the ducky logo and the NFC antenna.
