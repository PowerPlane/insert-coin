# The web flasher

Put firmware on an Insert Coin card from a browser. Nothing to install.

**https://ducky.davidyang.work/flash** · Chrome or Edge, on a laptop.

Made so a friend with an [Adafruit UPDI Friend](https://www.adafruit.com/product/5879)
can flash cards without PlatformIO. The page talks UPDI to the ATtiny1616
through the browser's Web Serial API, the same way `pio run -t upload`
does through avrdude. The firmware file never touches a server.

---

## 1 · Flashing a card (for whoever holds the UPDI Friend)

You need: a UPDI Friend, its cable, a card with a **fresh** CR2032 in it,
the `.hex` file David sent, and a laptop running Chrome or Edge.

1. **Set the UPDI Friend's switch to 3V.** The card runs at coin-cell
   voltage. 5V on the UPDI pin is out of spec for the chip.
2. **Wire two pins.** UPDI Friend `UPDI` to the card's `UPDI` pad, `GND`
   to `GND`. **Leave `VCC` unconnected.** The card is powered by its own
   coin cell while flashing.
3. **Open the page** and drop the `.hex` on it. It shows the file's size
   and the first eight characters of its SHA-256. Read those to David if
   you want to be sure it is the right file.
4. **Press Flash.** The first time, the browser asks which USB port; pick
   the UPDI Friend (it shows as a CH340 or "USB Serial"). Five rows tick
   off in about ten seconds: Connect, Check the chip, Write, Verify, Fuses.
5. **Done says the card's serial.** Pull the coin cell out, put it back,
   and the card should light up. The file stays loaded: swap the card and
   press Flash again.

If a row turns red, the page says what happened, whether the card is fine,
and what to check. **Show details** has the log if David asks for it.

| It says | It means | Do |
| --- | --- | --- |
| Open this in Chrome or Edge | This browser has no Web Serial. | Copy the link into Chrome or Edge on a laptop. Phones cannot do this. |
| The USB port is busy | Something else has the port open. | Close the Arduino IDE or any serial monitor, unplug and replug, press Flash. |
| The card did not answer | No reply on the UPDI wire. Nothing was written. | Coin cell in and fresh? UPDI on UPDI, GND on GND? Switch at 3V? Replug. |
| That is not an Insert Coin card | The chip is not an ATtiny1616. Nothing was written. | Check what the cable is clipped to. |
| Writing stopped part way | The card is half-written. | Fresh coin cell, then Flash again. Nothing is lost. |
| Read back differently | One byte did not stick. | Almost always the battery. Fresh cell, Flash again. Slow mode in Details if it repeats. |
| A setting did not take | Code is on; a fuse read back wrong. | Flash again. Twice in a row, send the card back with the details. |
| This chip is locked | Lock bits are set. This page does not erase locked chips. | Send the card back to David. |

---

## 2 · Making the file (for David)

```bash
shared/tools/build-hex.sh                 # production-pond → ~/Desktop
shared/tools/build-hex.sh bringup ~/tmp   # any env, any folder
```

It runs `pio run -e <env>`, copies the result out of `.pio/build/` with
the commit hash in the name, and prints the SHA-256. Send that file
however you like: AirDrop, email, a chat. Then read the first eight
characters of the hash to each other.

**The file is not hosted anywhere, and must not be.** The pond firmware
carries `FIRMWARE_SECRET`, the key every card signs its claims with. The
repository is public, so a committed or served `.hex` would publish the
key. The script refuses to build `production-pond` with the all-zero
placeholder key, because a card built with it never registers in the
pond and the only symptom is silence.

---

## 3 · How it works

```
 browser tab ── Web Serial ── USB ── UPDI Friend (CH340E + 1 kΩ) ── UPDI pin ── ATtiny1616
   flash.js                                                           ↑ card powers itself
```

The page bundles a TypeScript port of Microchip's SerialUPDI stack
([WebUPDI](https://github.com/manuelkasper/webupdi), MIT), so the
protocol on the wire is the one pymcuprog and avrdude speak. On top of it
sits a short, tested sequence:

1. **Connect** at 230400 baud; if the chip is silent, close the port and
   try 115200.
2. **Check the chip.** Read the device id. Anything but `0x1E9421` stops
   here, before a single write. Read the factory serial number and derive
   the card serial the same way the firmware and the server do.
3. **Write** all 256 flash pages: erase-and-write for pages with content,
   plain erase for blank ones.
4. **Verify** by reading the whole 16 kB back and comparing.
5. **Fuses.** Write the eight fuse bytes `platformio.ini` describes, read
   them back, compare.
6. **Leave programming mode.** The chip resets and boots the new code.

One order, no branches: the flasher does exactly this or stops with a
named reason.

---

## 4 · What it writes, and what it never touches

**Flash**: every page, from the `.hex`. Pages the file does not mention
are erased (0xFF), so nothing from an older firmware survives.

**Fuses**, byte for byte what `pio run -t fuses` would write from
`platformio.ini`. A test recomputes this table from the ini file with
PlatformIO's own rules, so the two cannot drift.

| Fuse | Value | Why |
| --- | --- | --- |
| WDTCFG | 0x00 | watchdog off |
| BODCFG | 0x00 | brown-out detector off, so the coin cell fades instead of reset-looping |
| OSCCFG | 0x02 | 20 MHz oscillator, divided to 10 MHz in code |
| TCD0CFG | 0x00 | defaults; the LED PWM sets TCD0 up itself |
| SYSCFG0 | 0xC5 | EEPROM kept across reflash, UPDI pin stays UPDI |
| SYSCFG1 | 0x06 | 32 ms start-up |
| APPEND | 0x00 | no application data section |
| BOOTEND | 0x00 | no bootloader |

Note that PlatformIO only writes fuses on `pio run -t fuses`, not on
`upload`. The web flasher writes them every time, so a card flashed here
has the fuses the ini asks for whether or not the bench ever ran that
target.

**Never touched:**

- **EEPROM.** The claim counter lives there (`provision.h`). The flasher
  uses page operations only and never issues a chip erase, so EEPROM is
  preserved even on a card whose EESAVE fuse was never set.
- **Lock bits.** Not written; a locked chip is refused rather than erased.
- **The user row.** Nothing on the card uses it.
- **The firmware sources.** This feature adds a page, a script and docs.
  No file under `variants/*/firmware/` changed.

---

## 5 · Where things live

```
pond/
  api/flash.ts                 the route (a function, like every HTML route)
  src/worker/flash-shell.ts    the page's HTML
  src/flasher/
    main.ts                    the page's behaviour: states, copy, port picking
    flasher.ts                 the sequence in § 3, over an interface a test can fake
    hex.ts                     Intel HEX → flash image, strict about what it accepts
    plan.ts                    image → page operations
    target.ts                  ATtiny1616 addresses and the fuse table
    explain.ts                 what the page says when it fails
    digest.ts                  SHA-256 of the dropped file
    serialupdi/                vendored WebUPDI, MIT; VENDORED.md lists every edit
  public/flash.js, flash.css   the committed bundle and stylesheet
  test/flasher-*.test.ts       hex, plan, fuse table vs platformio.ini, the flow
                               against a fake chip, the page against its script
shared/tools/build-hex.sh      David's side: build, name, hash, hand over
```

Design canvas (the screens, in the pond's language):
https://claude.ai/code/artifact/b278c922-17a4-4562-9c67-462ab4460528

---

## 6 · Decision log

| Decision | Chosen | Instead of | Why |
| --- | --- | --- | --- |
| Where the page lives | `/flash` on the pond, a Vercel function | GitHub Pages, a separate site | Deploys with the pond, inherits its security headers, and the pond already has the rule that every HTML route is a function. |
| Where the firmware comes from | Dropped on the page by the friend | Served from the page, fetched from a release | The pond `.hex` contains the signing key and the repo is public. Hosting it anywhere publishes the key. |
| Protocol stack | Vendored WebUPDI `serialupdi/` | Writing UPDI from scratch, `@types` + npm | It is a straight port of pymcuprog, MIT, and not on npm. Vendoring with a change list keeps updates a diff. |
| Only one chip | Refuse anything but `0x1E9421` | A device picker | A friend should not be choosing chips. A v2 board adds a second target, not a dropdown. |
| No chip erase | Page erase and erase-and-write on all 256 pages | Chip erase then write used pages | Chip erase wipes EEPROM unless EESAVE is already set, and PlatformIO's `upload` never sets fuses. Page ops leave EEPROM alone whatever the fuses say. |
| Fuses written every time | The eight bytes from `platformio.ini`, verified | Leave fuses as found | The ini is the spec; a card should not depend on whether the bench remembered `-t fuses`. Lock bits and reserved bytes are excluded. |
| Fuses after flash | Verify flash, then fuses | Fuses first | A failure part way leaves old fuses and new code, which still runs. |
| Baud | 230400 then 115200 | One baud, or a picker | megaTinyCore's tuned default first; the fallback covers a slow adapter. "Slow mode" in Details pins 115200 for the stubborn case. |
| Port picker filter | WCH and FTDI vendor ids | Every serial port | On a Mac the list otherwise includes every paired Bluetooth device; `platformio.ini` tells the story of the Bose speaker. Details has "show every port". |
| Verification | Whole flash read back, and fuses read back masked for reserved bits | Trust the write | A weak coin cell is the realistic failure and a silent one. |
| File identity | SHA-256 shown on both ends | Version strings in the file | Two humans reading eight characters to each other needs no format and survives renaming. |
| Errors | Named codes, plain copy, `touched` flag | The stack's messages | The person reading has a card in their hand. The copy says whether it is fine before it says what to try. |
| Copy language | English only | The pond's bilingual strings | Two readers, both known. |
| Reviews | `/code-review` after each phase | `codex:rescue` | That skill is not available in this session; noted, not substituted silently. |

---

## 7 · Change log

| Date | Change | Why |
| --- | --- | --- |
| 2026-09-14 | Web flasher added at `/flash` | Flash cards from a browser with a UPDI Friend, no PlatformIO. |
| 2026-09-14 | `shared/tools/build-hex.sh` | One command to build, name and hash the file to send. Refuses the placeholder key. |
| 2026-09-14 | Vendored WebUPDI with fixes | Double break was not awaited (one break, not two); read timeouts were never cleared; `device` typed instead of `any`. |
| 2026-09-14 | Baud fallback releases the port between attempts | A leaked port made the second attempt report "port busy" for a loose wire. Found in review. |
| 2026-09-14 | Extended addresses multiplied, not shifted | `0x8000 << 16` is negative in JavaScript, and the data silently vanished. Found in review. |
| 2026-09-14 | `[hidden]` rule in flash.css | Flex containers outranked the browser's `hidden`; every state showed at once. Found in review. |
| 2026-09-14 | Deploy-shape test checks every bundle | It compared `main.js` only, so a stale `flash.js` would have shipped. |
| 2026-09-14 | Link errors named by the phase they interrupt | A wire slipping during verify was reported as a half-written card. Found in review. |
| 2026-09-14 | A newer AVR family is "wrong chip", not "no answer" | An AVR Dx answers the SIB and was retried at every baud, then blamed on wiring. Found in review. |
| 2026-09-14 | `vercel.json` no-cache rule covers the bundles that exist | The rule named `app.js`, which is not a file; `main.js` and `admin.js` were never covered. The flash rule had copied the mistake. |
