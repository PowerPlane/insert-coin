# Ducky Card

> An interactive business card that comes to life when you insert a CR2032 coin cell.
> Inspired by the Target gift cards of the early 2000s.

The card is a PCB cut to business-card size. The coin cell is the interaction: slide it into the holder and the card boots, blinks, listens for a blow, writes a fortune to its NFC tag, then sleeps. Tap it with a phone and the fortune opens in the pond, a small web app where the ducks you collect live.

This repo is one card project: the board, its firmware and its pond. Collaborations live in their own repos, started from this one (see [Collabs](#collabs)).

## Layout

```
ducky-card/
├── README.md
├── COLLABS.md             how to start a collab repo from this one
├── hardware/              KiCad project + production/ fab outputs
├── firmware/              PlatformIO project (bringup, production,
│   │                      production-nfc, production-pond envs)
│   └── lib/card-identity/ card serial, signing and NFC record, shared with pond/
├── enclosure/             3D-printed sleeves and holders
├── tools/                 build-hex.sh and its test
├── pond/                  web app on Vercel, including the /flash page
└── docs/                  board notes, flasher, NFC, pond docs
```

## The board

Business card size (about 85 × 54 mm), ATtiny1616, 24 LEDs, a MEMS microphone and an ST25DV04K NFC tag. Details in [`docs/board.md`](docs/board.md).

- ATtiny1616: [datasheet](https://ww1.microchip.com/downloads/en/DeviceDoc/ATtiny1614-16-17-DataSheet-DS40002204A.pdf)
- ST25DV04K: [datasheet](https://www.st.com/resource/en/datasheet/st25dv04k.pdf)

Open `hardware/Insert-Coin-Business-Card.kicad_pro` in KiCad 10. Board revisions are tagged in git (`hw-0.2`).

## Build and flash

[PlatformIO](https://platformio.org/) + [megaTinyCore](https://github.com/SpenceKonde/megaTinyCore), flashed over UPDI. Wiring, environments and build commands are in [`firmware/README.md`](firmware/README.md).

```bash
cd firmware && pio run -e production-pond
```

`production-pond` needs `firmware/production-pond/src/secrets.h` (copy `secrets.h.example`); its key must match the pond's `CARD_SECRET`. It is gitignored and never committed.

No PlatformIO on the machine? [`tools/build-hex.sh`](tools/build-hex.sh) builds a `.hex` to send, and [`ducky.davidyang.work/flash`](docs/flasher/README.md) flashes it from a browser through an Adafruit UPDI Friend.

## The pond

`pond/` is deployed to [ducky.davidyang.work](https://ducky.davidyang.work) on Vercel, backed by Turso. Hosting: [`docs/pond/HOSTING.md`](docs/pond/HOSTING.md). Everything else about the pond: [`docs/pond/README.md`](docs/pond/README.md).

```bash
cd pond && npm ci && npm run verify
```

## Collabs

A collab is a separate repo made from this one with GitHub's "Use this template", with its own pond, its own NFC host and its own card secret. Steps: [`COLLABS.md`](COLLABS.md).

| Repo | Pond |
|---|---|
| `PowerPlane/ducky-card` (this one) | Shared pond |
| `PowerPlane/ducky-card-spencer-collab` | Personal pond, with Spencer Chang |
