# NFC ducky -- post-reveal URL personalization

The `production-nfc` firmware variant writes the fortune result to the
ST25DV04K NFC tag over I2C so that a phone scan after the show lands
on a fortune-coded URL. `davidyang.work` runs a small inline script
(`cargo-snippet.html`) that reads `?d=N` and prepends the matching
duck illustration to the `DAVID YANG` header.

After 60 seconds the MCU wakes once more, resets the URL digit to `0`
(no ducky), and goes back to terminal deep sleep.

## Architecture at a glance

```
+-----------------------------+        I2C            +-----------------------+
|  ATtiny1616 (post-reveal)   |  -- 4 byte write -->  |  ST25DV04K NDEF EEPROM |
|  ndef_patch_fortune(N)      |                       |  ?d=N is now live      |
+-----------------------------+                       +-----------+-----------+
                                                                  |
                                                            NFC (RF-powered)
                                                                  |
                                                                  v
                                                       +-----------------------+
                                                       |  Visitor's phone      |
                                                       |  opens davidyang.work |
                                                       |  /?d=N                |
                                                       +-----------+-----------+
                                                                  |
                                                                  v
                                                       +-----------------------+
                                                       |  Cargo.site custom JS |
                                                       |  prepends ducky[N] to |
                                                       |  the DAVID YANG row   |
                                                       +-----------------------+
```

## One-time setup

These steps only need to be done once per physical card and once per
Cargo.site instance.

### 1. Pre-program the tag from a phone

The MCU only patches a single byte; the full NDEF framing must be in
place first. Easiest path:

1. Install **NFC TagWriter by NXP** (Android) or **NFC Tools** (iOS/Android).
2. Choose "Write URL".
3. Enter `https://davidyang.work/?d=0` exactly (with the trailing `0`).
4. Hold the phone to the unpowered card, around the etched antenna on
   the back.
5. Confirm with the app's "Read tag" function that you see the same
   URL back.

The placeholder `0` is what the firmware will overwrite at runtime. If
you write a *different* URL (say, with `?d=1` or no query string at all)
the byte offset assumption in `config.h` (`NDEF_DIGIT_OFFSET = 0x001D`)
will be wrong and you'll either patch the wrong byte or corrupt the
NDEF framing. Stick to `https://davidyang.work/?d=0`.

### 2. Upload the four ducks to Cargo Media Manager

The SVGs live next to this README in `assets/`:

| File                  | Maps to | Fortune                 |
| --------------------- | ------- | ----------------------- |
| `ducky-great.svg`     | `d=1`   | great luck (banks 4)    |
| `ducky-little.svg`    | `d=2`   | little luck (bank 5)    |
| `ducky-uncertain.svg` | `d=3`   | uncertain (bank 6)      |
| `ducky-bad.svg`       | `d=4`   | bad luck / fire (7+8)   |

Upload all four to Cargo's Media Manager. For each, copy the public
URL Cargo gives you (something like
`https://freight.cargo.site/.../ducky-great.svg`).

### 3. Paste the snippet into Cargo Site Options

1. Open `cargo-snippet.html` from this directory.
2. Replace the four `ASSET_URL_*` placeholders with the Cargo URLs
   from step 2.
3. In Cargo: **Site Options -> Custom Code -> Body End** (the section
   that injects at the close of `</body>`).
4. Save and reload `davidyang.work`. Visiting plain `davidyang.work`
   should show no ducky; `davidyang.work/?d=1` should show the
   great-luck duck floating before `DAVID YANG`.

### 4. Verify the byte offset (one-time)

After step 1, before flashing `production-nfc`, manually test the
patch offset:

1. Pre-program tag with `https://davidyang.work/?d=0` (step 1).
2. With the card unpowered, scan with the phone. URL ends `...?d=0`.
3. Flash a tiny ad-hoc sketch that calls `ndef_init();
   ndef_patch_fortune(0);` (writes `'1'`) once, then halts.
4. Re-scan. URL should now end `...?d=1`.

If the URL is unchanged or corrupted, the offset is wrong. Sniff the
first 32 bytes of user memory with a Wire-based read loop, identify
where the digit landed, and update `NDEF_DIGIT_OFFSET` in
`production-nfc/src/config.h`.

## Flash and run

```bash
cd variants/business-card-v1/firmware
pio run -e production-nfc -t upload
```

The two variants compile as separate environments:

- `pio run -e production` -- original behavior, no NFC writes
- `pio run -e production-nfc` -- the new behavior described here

## Fortune to duck mapping

| `fortune` index | ASCII byte written | URL on phone           | Ducky shown             |
| --------------- | ------------------ | ---------------------- | ----------------------- |
| `FORTUNE_GREAT` (0)     | `'1'` (0x31)  | `.../?d=1` | great-luck duck (gold)  |
| `FORTUNE_LITTLE` (1)    | `'2'` (0x32)  | `.../?d=2` | little-luck duck (gold) |
| `FORTUNE_UNCERTAIN` (2) | `'3'` (0x33)  | `.../?d=3` | uncertain duck (small)  |
| `FORTUNE_BAD` (3)       | `'4'` (0x34)  | `.../?d=4` | bad-luck duck (flame)   |
| (expired, 60 s post-reveal) | `'0'` (0x30) | `.../?d=0` | no ducky                |

## Edge cases worth knowing

| Scenario                                       | Behavior                                          |
| ---------------------------------------------- | ------------------------------------------------- |
| Visitor scans card *before* coin insert        | Sees `?d=0` -> default page, no ducky             |
| Visitor scans within 60 s of reveal            | Sees current fortune's ducky                      |
| Visitor scans 60+ s after reveal               | Sees `?d=0` -> default page (URL was reset)       |
| MCU's I2C write fails (NACK, RF busy)          | Previous byte stays -> shows previous fortune or default |
| Battery dies mid-show before reset             | URL stays at the just-set fortune (next visitor sees that ducky) |
| User manually visits `davidyang.work/?d=99`    | Falls through `DUCKIES[d]` lookup -> no ducky    |
| Visitor scans with battery dead                | Tag is RF-powered; whatever URL was last written serves |
| Re-insert coin during 60 s window              | Cold reset -> new fortune overrides the digit; 60 s timer restarts |

## Hardware note: no external I2C pull-ups

The card has no 4.7 kOhm pull-ups on SDA/SCL. `ndef_init()` enables
the ATtiny1616's internal pull-ups (`PORT_PULLUPEN_bm`) on PB0/PB1 and
clocks SCL at 25 kHz to keep the rise-time margin generous on the
~25 pF bus. This is intentionally out of formal I2C spec but works
reliably for 1-2 cm of trace. If you ever see persistent NACKs, the
escape hatch is a dead-bug 4.7 kOhm from each line to VCC.
