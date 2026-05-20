# production-nfc firmware

(Same overall behavior as `production/`, plus a post-reveal I2C patch
of the ST25DV04K NDEF EEPROM so a phone tap surfaces the fortune
result. See `docs/nfc-ducky/` for the on-tag URL contract and the
Cargo.site snippet.)

Interactive firmware for business-card-v1. One coin insertion = one fortune.

## What it does

Coin makes contact → MCU boots → runs a single forward pass:

1. **Boot capture** — bank 0 (ducky frame 1) eases up to full, dips, recovers, holds.
2. **Ducky walk** — banks 0→1→2→3 hard-cut stop-motion with eased dwell pacing.
3. **Lottery** — slot-machine spin across banks 4 / 5 / 6 / 7+8, then a hardware-seeded random pick from { great, little, uncertain, bad }.
4. **Reveal** — per-fortune scene (see below).
5. **Sleep forever** — `SLEEP_MODE_PWR_DOWN` with no wake source. Pull the coin to reset.

## Reveal scenes

| Fortune | Bank(s) | Animation |
|---|---|---|
| Great luck   | 4   | 3× blink, 15 s static hold (sleeps through the hold) |
| Little luck  | 5   | 2× blink, 15 s static hold (sleeps through the hold) |
| Uncertain    | 6   | Eased ramp, then eased breathing for ~15 s, soft fade-off |
| Bad luck     | 7+8 | Two-stream candle flicker until mic detects a sustained blow (≥100 ms above threshold), then a flare-up + fast fade. 60 s timeout. |

The NFC tag (ST25DV04K) is RF-powered and ignored by the MCU — tap-to-URL works independently of the coin.

## Power

- BOD off, `millis()` on TCB0, ADC0 disabled at boot, ADC1 disabled after the lottery on non-fire reveals.
- 15 s holds use the RTC PIT at 1 Hz to drop into deep sleep with the GPIO output latched high — chip current goes from ~5 mA active to <10 µA while the bank stays lit.
- After the show: `sleep_forever()` disables both ADCs, kills every input buffer except UPDI, and parks in `PWR_DOWN` until cold boot.
- Target: < 1 µA quiescent after shutdown, comfortable headroom on a CR2032 for hundreds of activations.

## Source layout

```
src/
  main.cpp            entry point; runs the show then sleeps
  anim.{h,cpp}        scripted scenes (boot capture, walk, lottery, reveals)
  flame.{h,cpp}       two-stream candle flicker for banks 7+8
  pwm.{h,cpp}         9-bank software PWM with eased fade/hold helpers
  mic.{h,cpp}         ADC1 envelope + raw-threshold blow detector
  rng.{h,cpp}         xorshift32 seeded from ADC LSB noise on the mic pin
  sleepy.{h,cpp}      RTC-PIT timed sleep + terminal deep sleep
  leds.{h,cpp}        bank MOSFET driver (verbatim from bringup)
  pins.h              pin map + bank/fortune semantic indices
  unused_pins.h       input-buffer-disable for everything PCB-unused
  config.h            all timings, thresholds, RNG sample counts
```

## Build & flash

```
cd insert-coin/variants/business-card-v1/firmware
pio run -e production-nfc
pio run -e production-nfc -t upload --upload-port /dev/cu.usbserial-XXXX
```

`FORCE_FORTUNE` (set in `config.h` or via `-DFORCE_FORTUNE=3` build flag) skips the lottery for blow-out tuning. Defaults to `-1` (real RNG).
