# bringup firmware

Smoke-test firmware for a freshly-soldered business-card-v1. The goal is to **prove each subsystem works in isolation** before chasing bugs in the production firmware (where everything runs at once and root-causing is harder).

## Test modes

Selected at compile time via `BRINGUP_MODE` in [`src/config.h`](src/config.h). No button on the PCB, so there is no run-time selector; reflash via SerialUPDI to switch modes.

| Mode | Test | What it proves |
|---|---|---|
| **0** *(default)* | Auto-cycle through tests 1, 2, 3 with 3 s dwell each. | First-light smoke test — flash once, see all three indicator subsystems in turn. |
| 1 | **LED walking-bank** — light each of the 9 cathode banks in sequence (200 ms each). | Every MOSFET, every cathode-bank trace, every LED solder joint. A dead LED shows up as a missing dot in its bank. *(Individual-LED walking is not possible on this PCB — all 24 anodes go to VCC through individual current-limit resistors, so an LED is lit exactly when its bank's MOSFET is on.)* |
| 2 | **Full at low PWM duty** — software-PWM all banks together at ~8 % duty. | Forward-voltage variance across the LED batch (dim/bright outliers), and the global rail under sustained load. |
| 3 | **Mic envelope** — free-run ADC0 on PC0, peak-and-decay envelope, VU-meter bank fill. | Mic biasing, ADC reference, and the analog routing. |
| 4 | **I²C scan** — scan 0x08..0x77 with internal pull-ups enabled, look for ST25DV04K at 0x53. | SDA/SCL routing and the NFC tag itself. Result is reported by LED pattern: **bank 0 blinks @ 2 Hz on success, bank 8 blinks @ 5 Hz on failure.** *(0x53 is the 7-bit form of the `0xA6` address from the datasheet — `0xA6` is the address shifted left for the 8-bit R/W form.)* |
| 5 | **Sleep / wake** — sleep in `SLEEP_MODE_PWR_DOWN`, wake every 4 s via the RTC PIT (running off the 32.768 kHz ULP osc), pulse bank 0 for 50 ms. | Sleep current target < 1 µA. Measure with a multimeter in series with the CR2032. *(The PCB has no button or NFC GPO wired to the MCU, so we wake from the internal PIT rather than an external pin interrupt.)* |

## Power-budget guidance

| Mode | Avg current | Peak | Power source |
|---|---|---|---|
| 1 walking-bank | ~5–10 mA (one bank lit at a time) | same | CR2032 OK indefinitely. |
| 2 full @ 8 % duty | ~38 mA avg | ~480 mA for ~80 µs per PWM period | Bench supply recommended; CR2032 will sag visibly but BOD-off keeps the MCU running. |
| 3 mic envelope | 5–80 mA, depends on loudness | up to full-on mask | Bench supply recommended; coin-cell ESR can swamp the mic noise floor. |
| 4 I²C scan | < 5 mA scanning, ~10 mA blinking | same | CR2032 fine. |
| 5 sleep / wake | **target < 1 µA** between blinks; ~10 mA for the 50 ms blink every 4 s | same | CR2032 — and this is the test where coin-cell ESR vs. bench supply changes the *measurement*. |

> Tunable via `src/config.h`: PWM duty for test 2, frame rate / bank-step threshold for test 3, PIT period and blink width for test 5.

## Source layout

```
src/
  main.cpp                       BRINGUP_MODE dispatcher
  config.h                       BRINGUP_MODE + per-test tunables
  pins.h                         pin map (verified against netlist.ipc)
  leds.{h,cpp}                   bank driver (active-high MOSFET gates)
  unused_pins.h                  disable input buffer on idle pins
  tests/
    test_walking_banks.{h,cpp}
    test_full_low_pwm.{h,cpp}
    test_mic_envelope.{h,cpp}
    test_i2c_scan.{h,cpp}
    test_sleep_wake.{h,cpp}
```

## Build & flash

```
cd insert-coin/variants/business-card-v1/firmware
pio run -e bringup -t upload --upload-port /dev/cu.usbserial-XXXX
```

To change mode, edit `BRINGUP_MODE` in `src/config.h` and reflash.
