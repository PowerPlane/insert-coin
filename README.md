# Insert Coin

> A series of interactive business cards that come to life when you insert a CR2032 coin cell.
> Inspired by the Target gift cards of the early 2000s.

The "Insert Coin" cards are PCB-as-business-card builds where the coin cell is the *user interaction*: slide it into the holder and the card boots, blinks, listens, taps NFC, then sleeps. Different variants explore different form factors, sensor sets, and animations under the same playful idea.

## Variants

| Slug | Form factor | MCU | Status | Notes |
|---|---|---|---|---|
| [`business-card-v1`](variants/business-card-v1/) | Business card (85 × 54 mm) | ATtiny1616 | Hardware done, firmware pending | 24-LED matrix, MEMS mic, ST25DV04K NFC tag |

## Repo layout

```
insert-coin/
├── docs/                       # cross-variant notes, photos, renders
├── shared/                     # things reused across variants
│   ├── kicad/                  # symbols, footprints, 3D models
│   ├── firmware/               # shared HAL/drivers (LED matrix, NFC, mic)
│   └── tools/                  # flashing scripts, gerber gen helpers
└── variants/<slug>/
    ├── hardware/               # KiCad project + fab outputs
    ├── firmware/               # PlatformIO project (bringup + production envs)
    └── enclosure/              # 3D-printed sleeves / holders (CAD)
```

## Adding a new variant

Use the slug pattern `<form-factor>-v<n>`:
- `business-card-v2` — next rev of the business-card form factor
- `keychain-v1`, `coaster-v1`, `badge-v1` — new form factors

Copy the structure of `variants/business-card-v1/` (without the KiCad files) as a starting point.

## Firmware toolchain

[PlatformIO](https://platformio.org/) + [megaTinyCore](https://github.com/SpenceKonde/megaTinyCore) targeting the ATtiny1616 over **UPDI**. Default programmer: SerialUPDI through an FTDI USB-serial adapter (one 4.7 kΩ resistor between TX and RX). Per-variant `firmware/README.md` has the wiring diagram and build commands.
