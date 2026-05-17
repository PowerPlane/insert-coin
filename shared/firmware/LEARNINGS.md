# Firmware Learnings — Insert Coin

What we learned during business-card-v1 bring-up that the production
firmware (and every future variant) should know up-front. Each entry
is one concrete finding with the cause and the practical takeaway.

---

## Hardware quirks specific to this PCB family

### LED "matrix" is actually 9 cathode banks, not 24 addressable LEDs

24 anodes go to VCC through individual current-limit resistors; the
9 N-FETs (Q1–Q5, Q7–Q10) each sink the cathodes of a fixed group of
2 or 4 LEDs. Firmware can address **9 banks**, not 24 LEDs.

- **Why:** PCB area constraint — addressing all 24 individually would
  need either Charlieplexing (would have changed the resistor topology)
  or a row/column matrix (would have needed crossover traces).
- **How to apply:** Any "pixel-level" effect (waterfall, scrolling
  text, etc.) is impossible. Design effects around bank-level state.
  Future variants should pick the matrix topology *before* layout, not
  during firmware.

### "Net stub" pin: PB4 is wired out of the MCU but unconnected

`/LED10` (PB4, schematic pin 10) is brought out of the MCU but doesn't
drive any MOSFET — it's a stub. Easy to mistake for a 10th bank
driver from the schematic alone.

- **Why:** Historical artifact — probably an early matrix plan that
  was simplified before fab.
- **How to apply:** Always verify pin assignments against
  `hardware/production/netlist.ipc`, not just the schematic. The
  netlist is post-route truth; the schematic is intent.

### No external I²C pull-ups on the PCB

PB0/PB1 (SCL/SDA to the ST25DV04K NFC tag) have no pull-up resistors.
TWI won't work until firmware enables internal pull-ups.

- **Why:** Area / BOM reduction. The ATtiny's internal pull-ups are
  ~35 kΩ which is weak but workable for low-speed I²C (≤ 100 kHz) at
  short trace lengths.
- **How to apply:** Before `Wire.begin()` always set:
  ```cpp
  PORTB.PIN0CTRL |= PORT_PULLUPEN_bm;
  PORTB.PIN1CTRL |= PORT_PULLUPEN_bm;
  ```
  Don't rely on `Wire.usePullups()` alone — it's a no-op on some
  megaTinyCore versions.

### No UART pins are free, and no button

PB2/PB3 are the default Serial pair *and* bank drivers 7/8 — they
can't be both. The alternate swap pair (PA1/PA2) is also bank
drivers (banks 0/1). There's also no button on the PCB.

- **Why:** Every spare pin on a 20-pin QFN got used for visible
  output; debug UART and user input weren't prioritized.
- **How to apply:** Result reporting is by **LED pattern**, not
  `Serial.print`. Mode selection must be **compile-time**, not
  runtime. Future variants should reserve at least 1 pin for either
  UART debug or a user button — pick one.

### UPDI lands on TP1 only, NOT on the right-edge connector J1

The right-edge connector (J1) is the **NFC antenna pigtail**, not the
programming header. UPDI is a single 1.0 mm pad in a row of three
test points: `TP3 (GND) — TP1 (UPDI) — TP2 (VCC)`.

- **Why:** Programming pads were optimized for area and PCB
  aesthetics, not for ease-of-flashing.
- **How to apply:** Solder thin wire pigtails (~28 AWG, ~2 cm) from
  TP1 and TP3 to a male 2-pin header you can clip to. Turns one
  fiddly probing job into ten easy flashings. Future variants should
  include either a 3-pin SMD header for UPDI or pre-tinned
  larger-pitch (2 mm) pads.

---

## ATtiny1616 / megaTinyCore gotchas

### PC0 is ADC1 AIN6, NOT ADC0 AIN6

The ATtiny1616 has two ADC peripherals. On the txy6 pin map, PC0
routes to ADC1 (channel 6). ADC0 channel 6 is PA6 — which on this
board is a LED bank driver, not the mic.

- **Why:** Microchip routed ADC1's channels through PORTC to give
  more analog-capable pins; megaTinyCore exposes both ADCs but the
  default `analogRead()` uses ADC0.
- **How to apply:** When reading PC0, write to **`ADC1.*`**
  registers, not `ADC0.*`. The macros in this project's `pins.h`
  expose this via `#define MIC_ADC ADC1`. Sampling the wrong ADC
  reads a GPIO with no signal — looks like "mic is dead" but is
  actually firmware-side.

### EMA bias tracker stalls if hardcoded initial value is far from truth

The classic AC-coupled mic envelope tracker
`dc_ema += (x - dc_ema) >> 7;` only converges when
`|x - dc_ema| >= 128`. Hardcoding `dc_ema = 512` (assuming bias =
VCC/2) breaks if the actual bias is more than ~12 % of VCC off —
e.g., ZTS6156 biases at ~0.6 × VCC = ~1.8 V → ADC ≈ 635 → gap of 123
units → right-shift truncates to 0 → EMA stuck forever.

- **Why:** Integer arithmetic. The `>> 7` is fast and avoids
  floating-point, but rounds sub-LSB updates to zero.
- **How to apply:** **Always seed adaptive filters from real data**
  on first use. Never hardcode initial values that depend on
  hardware-dependent operating points. Two clean patterns:
  ```cpp
  // Pattern A: seed on declaration (when ADC is ready immediately)
  while (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) {}
  int16_t dc_ema = (int16_t)MIC_ADC.RES;

  // Pattern B: sentinel + lazy seed (when init order is flexible)
  static int16_t dc_ema = -1;        // -1 = "not yet seeded"
  if (dc_ema < 0) dc_ema = x;
  else            dc_ema += (x - dc_ema) >> 7;
  ```

### Arduino `init()` leaves ADC0 enabled by default

megaTinyCore's pre-`setup()` `init()` enables ADC0 for the
`analogRead()` API. ADC0 draws ~150 µA when enabled — enough to
blow a < 1 µA sleep budget by 150×.

- **Why:** Convenience: `analogRead()` "just works" from `setup()`.
- **How to apply:** Before `sleep_cpu()` in any low-power code path,
  explicitly disable both ADCs:
  ```cpp
  ADC0.CTRLA &= ~ADC_ENABLE_bm;
  ADC1.CTRLA &= ~ADC_ENABLE_bm;
  ```
  Re-enable after waking if needed.

### Floating digital input buffers leak 1–10 µA each in sleep

`pinMode(pin, OUTPUT)` only touches DIR, not the input buffer.
Unused pins (or even *driven outputs*) with their input buffer
enabled can oscillate at floating voltages and waste current.

- **Why:** PINnCTRL.ISC defaults to "enabled, both edges trigger";
  it's a separate register from DIR.
- **How to apply:** For every pin that isn't actively used as a
  digital input *or* as an ADC input, write:
  ```cpp
  *getPINnCTRLregister(port, bit) = PORT_ISC_INPUT_DISABLE_gc;
  ```
  Output drivers are unaffected and still work. PA0 (UPDI) and PC0
  (mic ADC) are the only exceptions on this board. See
  `bringup/src/unused_pins.h` and `tests/test_sleep_wake.cpp` for
  reference implementations.

### RTC PIT keeps running in PWR_DOWN; no watchdog needed for wake

The 32.768 kHz ULP oscillator drives the RTC's Periodic Interrupt
Timer (PIT), which stays alive in `SLEEP_MODE_PWR_DOWN`. No
watchdog, no external pin interrupt required for periodic wake.

- **Why:** The PIT was specifically designed for tinyAVR's
  ultra-low-power use cases — a real upgrade over classic AVRs where
  you'd have used the WDT.
- **How to apply:** For periodic wake at intervals ≥ 1 s:
  ```cpp
  RTC.CLKSEL     = RTC_CLKSEL_INT32K_gc;
  RTC.PITCTRLA   = RTC_PERIOD_CYC32768_gc | RTC_PITEN_bm;  // 1 Hz
  RTC.PITINTCTRL = RTC_PI_bm;
  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  sleep_enable();
  sei();
  sleep_cpu();   // wakes on PIT IRQ, microamp-class idle
  ```
  See `tests/test_sleep_wake.cpp` for the full pattern.

---

## C++ / AVR codegen pitfalls

### `uint16_t * uint8_t` evaluates as 16-bit on AVR; overflow above ~65 %

C's usual arithmetic conversions promote both operands to `unsigned
int`, which is 16-bit on AVR. So `PERIOD_US * DUTY_PCT` with both
small `uint16_t` values can silently overflow when the product
exceeds 65535 (e.g., 1000 µs × 70 % = 70000 → wraps to ~4464).

- **Why:** ABI choice — saves register pressure on the 8-bit AVR
  but contradicts the desktop habit where `int` is 32-bit.
- **How to apply:** When computing any product that might exceed
  65535, cast one operand to `uint32_t` *before* the multiply:
  ```cpp
  uint32_t on_us = (uint32_t)PERIOD_US * DUTY_PCT / 100UL;
  static_assert(PERIOD_US <= 65535UL,
                "period exceeds delayMicroseconds() arg range");
  ```
  See `tests/test_full_low_pwm.cpp`.

### `bank_all_mask()` is a single port write per PORT, not 9 digitalWrites

At 1 kHz PWM × 2 transitions per cycle = 2000 port writes/sec, the
difference between batched `PORTA.OUT = ...` (~6 cycles) and 9
`digitalWrite()` calls (~450 cycles) is the difference between
clean PWM and visible flicker.

- **Why:** `digitalWrite()` is the universal Arduino API but it does
  pin-mode and bit-mask lookups per call; PORT writes hit hardware
  directly.
- **How to apply:** Group LED bank pins by PORT in `pins.h` (banks
  0–6 are PORTA bits 1–7, banks 7–8 are PORTB bits 2–3), then write
  one masked OUT per PORT. See `leds.cpp::bank_all_mask()`.

---

## Power budget

### LED resistor is 10 kΩ → ~120 µA/LED max → full DC ≈ 2.9 mA total

R1–R6 are 10 kΩ arrays in series with the LED anodes; with VCC = 3 V
and an LED Vf of ~1.8 V, the per-LED current ceiling is ~120 µA.
All 24 LEDs lit DC: ~2.9 mA. The CR2032 (~200 mAh) runs all-on for
~70 hours. Much friendlier to coin cell life than typical LEDs.

- **Why:** Intentional shelf-life-over-brightness trade-off — a
  business card might sit unused for years between brief
  hand-out-and-show-once moments.
- **How to apply:** Don't waste flash on heavy PWM-dimming code for
  this PCB — even 100 % duty is CR2032-safe. Bumped `FULL_PWM_DUTY_PCT`
  from 8 to 100 on this basis. Future variants for "demo at a
  conference booth" use cases should target ~1 mA/LED (~470 Ω) for
  visual punch and accept a runtime hit.

### BOD-off is right for a one-cell coin-cell product

Brown-Out Detector continuously draws ~20 µA on the ATtiny. With a
CR2032 (~200 mAh), that's a 10000-hour BOD-only drain = ~14 months
of "doing nothing." Disabling it (configured in `platformio.ini`)
lets the card gracefully dim as the cell sags instead of reset-
looping near end-of-life.

- **Why:** BOD protects against undefined behavior during voltage
  rails dropping fast (e.g., a load step); coin-cell loads are
  inherently low and slow.
- **How to apply:** `board_hardware.bod = disabled` in
  `platformio.ini`. Never enable BOD on a coin-cell product unless
  there's a specific known transient that requires it.

---

## Bring-up firmware as a category

### Bring-up firmware can't help debug "I can't flash it"

Bring-up tests assume the chip is reachable via UPDI. If UPDI itself
fails (wrong pad, dead chip, cold joint, wrong adapter), bring-up
firmware is useless — chicken-and-egg.

- **Why:** Bringup needs to be flashed to run.
- **How to apply:** The first step of any bring-up is **verifying
  UPDI handshake** with the multimeter procedure documented in
  `variants/business-card-v1/firmware/README.md`. Only after the
  chip responds to a `pymcuprog ping` should you reach for bring-up
  firmware.

### LED pattern is the right "console" for boards without UART or button

With result reporting limited to LEDs, mode selection limited to
compile-time, and no console, every test needs a **deterministic
visual signature** of its result. Bank-N-blinks-at-frequency-F is
unambiguous from across a desk; `Serial.print` debug habits don't
transfer.

- **Why:** Forced minimalism — turns the LEDs into a 9-bit display.
- **How to apply:** Pre-define result patterns up-front
  (success-pattern, error-pattern, sub-test-N-pattern) before
  writing the test logic. Reuse the same patterns across all tests
  for visual consistency. The I²C scan test
  (`tests/test_i2c_scan.cpp`) is a good template: bank 0 @ 2 Hz =
  success; bank 8 @ 5 Hz = failure.

### Raw-ADC diagnostic mode is the right L1 mic test

When mic-reactive code "doesn't respond," the problem could be at
ANY of: mic dead, mic unbiased, ADC misconfigured, wrong ADC chosen,
DC tracker stuck, threshold mismatched, mapping wrong. A "raw ADC →
bank fill" mode bypasses every transform and shows the raw signal
directly. With it, "is the mic alive" is a 5-second observation.

- **Why:** Each transform in a signal-processing chain is a place
  to hide a bug. Testing with the *minimum* number of transforms
  first localizes the failure to either "physical" or "math."
- **How to apply:** For any future analog input (mic, light sensor,
  potentiometer, etc.) include a "raw ADC view" debug mode from
  day one — about 15 lines of code, pays for itself the first time
  something breaks. See `tests/test_mic_raw.cpp` (mode 7) for the
  reference implementation.

### Mic bias is hardware-specific; never assume VCC/2

The ZTS6156 on this board biases at ~0.6 × VCC (1.0–1.8 V observed,
varying with probe conditions). MEMS mic preamp topologies bias
anywhere from 0.5 × VCC to 0.65 × VCC. Code that assumes 0.5 × VCC
silently breaks on the outliers.

- **Why:** Different preamp topologies (charge pump, source
  follower, fixed bias) land at different operating points.
- **How to apply:** Production firmware should auto-seed any bias
  tracker from data, document the *measured* bias of the specific
  mic part chosen, and validate end-to-end with the raw-ADC test
  mode before shipping. Don't rely on datasheet typicals.

---

## Tooling notes

### SerialUPDI via cheap CP2102 / CH340 modules is fragile

`pymcuprog`-via-SerialUPDI works in theory and saves cost, but in
practice the bare USB-to-UART approach is sensitive to:
- TX/RX silkscreen errors on the adapter
- RX leg landing on the wrong side of the 4.7 kΩ shared-line
  resistor
- Module voltage jumper accidentally set to 5 V (out-of-spec for
  this 3 V chip)
- Adapter-internal latency at ≥ 115200 baud

If SerialUPDI fails after wiring is verified correct, **jtag2updi on
an Arduino Nano is the durable fallback** — uses bidirectional GPIO
instead of the resistor cheat, ~zero protocol-layer fragility.

- **How to apply:** Use jtag2updi for any new board's first-ever
  flash. Once a board is known-good and a SerialUPDI rig is
  validated, SerialUPDI is fine for subsequent flashes. Document
  the working programmer wiring with a labeled photo.

### `build_src_filter`, NOT `src_dir`, for multi-env source separation in PlatformIO

PlatformIO's `src_dir` is a `[platformio]`-section-only option. If
you put it inside `[env:foo]` it's silently ignored with a warning,
and the build either fails ("Nothing to build") or uses the wrong
sources.

- **How to apply:** Set `src_dir = .` at the project level, then use
  `build_src_filter = -<*> +<env-specific/src/>` inside each `[env:*]`
  block. See `variants/business-card-v1/firmware/platformio.ini`.

---

## Production firmware roadmap implied by this bring-up

Things this bring-up firmware proved out that production should
inherit directly:

- Pin map (`bringup/src/pins.h`) — extract to
  `shared/firmware/pins/business-card-v1.h` once a second variant
  exists.
- LED bank driver (`leds.cpp` with batched port writes) — extract
  to `shared/firmware/leds_bank.{h,cpp}`.
- Mic envelope tracker with seeded EMA (`test_mic_envelope.cpp`
  post-fix) — extract to `shared/firmware/mic_envelope.{h,cpp}`.
  Pattern is well-tuned for this mic; new mic parts will need
  re-tuning but the structure carries.
- Sleep/wake skeleton (RTC PIT + input-buffer + ADC disable) —
  extract to `shared/firmware/sleep_wake.{h,cpp}`.
- `unused_pins.h` discipline — apply to every variant.

Things production will need that bring-up deliberately deferred:

- NFC tag I²C driver — write NDEF URL records to the ST25DV04K's
  user EEPROM area (address 0x53).
- ST25DV `GPO` pin as a wake source — currently not routed on
  business-card-v1; **wire it in next-revision hardware** so the
  card can wake on tap.
- Coordinated boot animation → idle → mic-reactive state machine.
- Battery low-voltage indicator (the card "gracefully dims" by
  design but a visible "swap me" indicator near EOL would help).
