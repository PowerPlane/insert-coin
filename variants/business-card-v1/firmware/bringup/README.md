# bringup firmware

Smoke-test firmware for a freshly-soldered business-card-v1. The goal is to **prove each subsystem works in isolation** before chasing bugs in the production firmware (where everything runs at once and root-causing is harder).

Test plan — each will be one selectable mode (button-press or compile-time `#define`):

1. **LED walking-bit** — light one LED at a time, walking across all 24, to verify every LED solder joint, every MOSFET, and every row/column trace.
2. **Full matrix sweep** — light the full matrix at a low brightness to catch dim/bright outliers (forward-voltage variance across the LED batch).
3. **Mic readout** — sample the MEMS microphone ADC at ~8 kHz, blink one LED proportional to envelope. Confirms the mic biasing and ADC reference.
4. **I²C scan** — scan the I²C bus, expect to find the ST25DV04K NFC tag at its default address (`0xA6/0xAE` for user/system). Confirms SDA/SCL routing and pull-ups.
5. **Sleep / wake** — enter `SLEEP_MODE_PWR_DOWN`, measure current with a multimeter (target: < 1 µA), wake on pin interrupt to verify the coin-cell can sustain idle for months.

Source code is added in the next session. Right now `src/` is empty (`.gitkeep` only).
