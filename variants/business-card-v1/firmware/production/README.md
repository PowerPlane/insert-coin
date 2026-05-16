# production firmware

The real interactive firmware that ships on cards handed out as business cards. Designed around the "insert coin" gesture: nothing happens until the CR2032 is slid into the holder.

Intended flow:

1. **Power-on detection** — when the coin cell makes contact, the ATtiny1616 boots from cold.
2. **Boot animation** — a short LED sequence (~1–2 s) on the 24-LED matrix; visual confirmation that the coin "works".
3. **Idle low-power** — drop into deep sleep, periodically wake (e.g. every ~250 ms via the RTC) to sample the mic.
4. **Mic-reactive pattern** — when ambient sound crosses a threshold, run a reactive LED animation whose intensity tracks the envelope.
5. **NFC content** — the ST25DV04K's EEPROM is pre-loaded with a URL (vCard / portfolio link); tapping a phone to the card opens it without any MCU involvement, even when the coin is *not* inserted (the tag is RF-powered).
6. **Quiet-down** — after ~30 s of silence, return to idle sleep. Pull the coin to fully de-power.

Battery budget target: roughly **one month of casual use** on a fresh CR2032 (220 mAh nominal). That sets a hard ceiling of ~300 µA average — which is why BOD is off (saves ~20 µA continuous) and why most of the time the chip is asleep.

Source code is added in the next session. Right now `src/` is empty (`.gitkeep` only).
