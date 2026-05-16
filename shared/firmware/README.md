# shared/firmware

Reusable firmware modules that span multiple variants.

Empty for now — populate as patterns emerge while writing `business-card-v1`'s bring-up and production firmware. Likely first extractions:

- **LED matrix driver** — charlieplexing / row-column scanning helpers, ISR-driven from TCD0.
- **ST25DV04K NFC tag driver** — I²C wrapper for reading/writing the user EEPROM (NDEF URL records).
- **Mic envelope tracker** — ADC sampling + low-pass envelope, threshold-based wake.
- **Coin-cell power management** — sleep helpers tuned for the CR2032 budget (deep sleep with RTC wake, peripheral power-gating).

When extracted, each module should be drop-in includable from a variant's `firmware/<env>/src/` via PlatformIO's `lib_extra_dirs` or a `lib_deps` `file://` reference.
