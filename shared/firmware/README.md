# shared/firmware

Reusable firmware modules that span multiple variants.

Empty for now — populate as patterns emerge while writing `business-card-v1`'s bring-up and production firmware. Likely first extractions:

- **LED matrix driver** — charlieplexing / row-column scanning helpers, ISR-driven from TCD0.
- **ST25DV04K NFC tag driver** — I²C wrapper for reading/writing the user EEPROM (NDEF URL records).
- **Mic envelope tracker** — ADC sampling + low-pass envelope, threshold-based wake.
- **Coin-cell power management** — sleep helpers tuned for the CR2032 budget (deep sleep with RTC wake, peripheral power-gating).

When extracted, each module should be drop-in includable from a variant's `firmware/<env>/src/` via PlatformIO's `lib_extra_dirs` or a `lib_deps` `file://` reference.

---

See [`LEARNINGS.md`](LEARNINGS.md) for hard-won lessons from the business-card-v1 bring-up: ATtiny1616 pin-map quirks, the EMA bias-tracker stall bug, ADC0-vs-ADC1, sleep-current discipline, programmer fragility, and what the production firmware should inherit. Read this before designing the next variant.
