# business-card-v1 firmware

Two PlatformIO environments in one project share the same `platformio.ini`:

| Env | Purpose |
|---|---|
| **`bringup`** | Smoke tests for each subsystem — exercise every LED, read the mic, scan I²C for the NFC tag, verify sleep/wake. The first thing you flash on a freshly-soldered card. |
| **`production`** | The real interactive firmware: boot animation, idle low-power, mic-reactive pattern, NFC-tap drops a URL. The firmware that ships on cards you hand out. |

The actual source code is **not yet written** — that's the next session. The `src/` folders are empty placeholders.

## Toolchain

- **[PlatformIO Core](https://platformio.org/install/cli)** (`pip install platformio` or via Homebrew).
- **[megaTinyCore](https://github.com/SpenceKonde/megaTinyCore)** — pulled in automatically by `platformio.ini`. This is the Arduino-style core for the tinyAVR 0/1/2-series and exposes the ATtiny1616's modern peripherals (Event System, Configurable Custom Logic, TCD high-res timer) as easy-to-use APIs.

## Programmer wiring

The ATtiny1616 uses **UPDI**, Microchip's 1-wire programming protocol. No bootloader is required (and no bootloader is on the board) — UPDI talks directly to the chip's NVM controller.

### Primary path: SerialUPDI via FTDI (recommended)

```
   FTDI TX ──[ 4.7 kΩ ]──┬── UPDI pin on card
                          │
   FTDI RX ───────────────┘
   FTDI GND ─────────────────── GND on card
```

- The single resistor between TX and RX merges them into the half-duplex UPDI line.
- Power the card from the CR2032 during flashing — **do not back-feed Vcc from the FTDI**, the LDO and chip share a node sized for the coin cell.
- Upload speed: 230400 baud (megaTinyCore's tuned default).

`platformio.ini` is preconfigured for this path. Set `upload_port` to your FTDI:

```bash
ls /dev/cu.usbserial-* /dev/cu.usbmodem*    # find your adapter on macOS
pio run -e bringup -t upload --upload-port /dev/cu.usbserial-XXXX
```

### Fallback path: jtag2updi on an Arduino Nano

If the FTDI is unavailable, flash the [`jtag2updi`](https://github.com/ElTangas/jtag2updi) sketch onto an Arduino Nano once (it becomes a permanent UPDI programmer), then:

```
   Nano D6 ──[ 4.7 kΩ ]── UPDI pin on card
   Nano GND ────────────── GND on card
```

Switch the env's `upload_protocol` to `jtag2updi`:

```ini
upload_protocol = jtag2updi
upload_speed    = 19200
```

Slower than SerialUPDI but works fine for low-iteration use.

## Fuse / clock settings

Configured in `platformio.ini` so they're consistent across builds:

- `F_CPU = 10000000` — 10 MHz internal oscillator. The 20 MHz option is more headroom but eats more current; 10 MHz is the megaTinyCore default and friendlier to the CR2032 budget.
- **BOD off** — Brown-Out Detector disabled. BOD continuously sips ~20 µA which dominates the sleep current; the card is supposed to *gracefully* die when the coin cell sags, not reset-loop.
- Millis timer: **TCB0** (so TCD0 stays free for high-resolution LED PWM later).

## Build & flash

```bash
cd insert-coin/variants/business-card-v1/firmware

pio run -e bringup              # compile bring-up
pio run -e bringup -t upload    # flash bring-up
pio device monitor -b 115200    # open serial (if UART debug is wired)

pio run -e production -t upload # flash production firmware
```
