# Provisioning: every card is identical

**There is no per-card data.** Flash the same binary onto every board, put a
battery in once, tap once to check. The card gives itself an identity.

That is the whole design goal: nothing to type, no list to keep straight, and
no way to give two cards the same serial.

---

## Where the identity comes from

The ATtiny1616 carries a factory-programmed serial number: `SIGROW.SERNUM[9:0]`,
ten bytes, unique per chip, read-only. On first boot the firmware reads it,
shortens it to eight characters, and writes the finished NDEF record into the
ST25DV over I2C — the whole record, not a patch. After that the ST25DV is
never touched again except to change the one fortune digit.

```c
/* Crockford base32 of the low 40 bits. 40 bits is ~1.1e12 values; at a
   hundred cards the chance of any collision is about 4 in a billion, and
   the alphabet has no I, L, O or U so nothing reads as a typo. */
void card_serial(const uint8_t sernum[10], char out[9]);
/* shared/firmware/card-identity/ — one definition, compiled for both the
   AVR and the host, because deriving this twice is what would make every
   card unknown to the server at once. */
```

### Why the MCU's serial and not the NFC chip's

The ST25DV has its own 64-bit UID, and it is the more natural identity — it
is the thing a phone actually taps, and it survives the MCU being replaced.
Two things decide it the other way:

- **The programmer can read SIGROW during flashing.** That means the flashing
  script records each card's serial with no extra step, which closes the hole
  below for free. The ST25DV's UID lives on the other chip; the programmer
  cannot see it.
- It needs no I2C session and no second device address.

If a board is ever reworked with a new MCU it becomes a new card. For a
hundred hand-built cards that is an acceptable trade, and the admin page can
merge two rows if it ever happens.

---

## Why the serials still get recorded

The obvious version of this is: the card shows up with `&c=<serial>`, the
server has never seen it, so it registers it. Tempting, and wrong on its own —
`&c=` is typed text like everything else in the URL, so anyone could conjure
cards that never existed. Phantom rows are not dangerous (a card with no ducks
does nothing) but they make the Cards tab useless for the one question it has
to answer: *is this one of mine?*

So the flashing script appends each serial to `cards.csv` as it goes, and the
server only accepts serials it already knows. No extra manual work — the
programmer is reading the chip anyway.

```bash
# one card, start to finish
export PATH="$HOME/.platformio/penv/bin:$PATH"
pio run -e production-pond -t upload           # same binary every time
../tools/record-card.sh "the one for Sam"      # reads SIGROW, appends cards.csv

# once the batch is done
cd ../../../pond && npm run cards:import -- ../variants/business-card-v1/cards.csv
```

`record-card.sh` reads `sernum` with **avrdude**, which ships with
PlatformIO's atmelmegaavr platform and knows it as a named memory on UPDI
parts — so there is nothing extra to install. (An earlier draft called
`pymcuprog`, which is *not* bundled. Corrected after trying it.)

It records the derived serial **and** the raw SERNUM. That redundancy is
the point: `cards:import` re-derives from the SERNUM column and refuses the
whole file if any row disagrees, which is the only automatic check that the
flashing host and the firmware still agree.

---

## Per card, in full

1. **Flash.** Identical binary, no per-card build.
2. **Battery in.** First boot writes the complete NDEF record. The LEDs give a
   distinct confirmation pattern once the write has been read back and
   verified.
3. **Tap it.** Confirms the URL resolves and the fortune digit changes. This
   is the real test and it takes three seconds.

   Then paste what the phone showed:

   ```bash
   cd pond && npm run cards:check -- "<the URL>"
   ```

   It checks the shape, whether the card is in `cards.csv`, and the one
   thing no amount of looking will reveal: whether the card was flashed
   with the real signing key or with the all-zero placeholder from
   `secrets.h.example`.

Roughly two minutes a card once you have a rhythm. A hundred cards is an
evening.

---

## The other one risk: a card flashed before secrets.h was filled in

`board_hardware.eesave = yes` preserves EEPROM across a reflash. That is
deliberate — it is how a card keeps its claim counter through firmware
updates — but it has a sharp edge:

**A card provisioned with the placeholder key keeps its forgeable token
forever.** Re-flashing does not fix it. The firmware reads a valid
provisioning flag, concludes it is done, and skips the write entirely.

The recovery is to erase EEPROM first:

```bash
avrdude -c serialupdi -p t1616 -P /dev/cu.usbserial-XXXX -e
pio run -e production-pond -t upload --upload-port /dev/cu.usbserial-XXXX
```

`npm run cards:check` is what tells you a card is in this state, and it is
worth running on every card that was flashed before the key was set.

## The main risk

**A failed first-boot write ships a blank card.** Low battery or a bad solder
joint on the I2C lines and the record is never written.

Handled three ways, and all three have to hold:

- The existing retry wrapper (`NDEF_WRITE_ATTEMPTS`) covers a flaky bus.
- The firmware **reads the record back and compares it** before setting the
  "provisioned" flag in its own EEPROM. A card that fails verification retries
  on the next power-up rather than believing it succeeded.
- Step 3 above is a real tap on a real phone. Nothing leaves the desk unread.

---

## The bench — done, on two cards

**2026-08-12. Both cards flashed from one binary, both correct.**

```
card 1   SERNUM 30 54 30 4c 49 32 68 72 16 26
         tapped /?d=1&c=0YBSVSVN&g=0000&t=5d29221795

card 2   SERNUM 30 54 30 4c 49 32 47 48 24 06
         tapped /?d=2&c=G5JNY9HG&g=0000&t=764c1cde6a
```

Both `&c=` values match what the host derives from the chip's own SERNUM,
character for character. **That is Phase 2's done-when, met.**

Note what the two SERNUMs have in common: the first SIX bytes are
identical, because both chips came off one reel. Only the last four differ.
That is 60% of the entropy gone before you start, on a sample of two — and
it is exactly why the serial hashes all ten bytes instead of slicing a
window out of them, as the plan originally said. The synthetic vectors
predicted this shape; the real chips confirmed it.

### And the second card immediately earned its keep

`record-card.sh` FAILED on card 2, and the reason is worth writing down:
**avrdude does not zero-pad.** A byte below 0x10 prints as `0x6`, not
`0x06`. The parser stripped `0x` and concatenated, producing nineteen
characters instead of twenty.

Card 1 had all ten bytes ≥ 0x10 and recorded perfectly. Card 2's last byte
is 0x06. The chance a card is affected is `1 - (15/16)^10` — **48%.** Very
nearly half of every card would have failed to record, and a single card
would never have shown it.

The firmware was never wrong: it reads SIGROW registers directly and had
already written the correct serial into its own tag. The bug lived only in
the host shell script. Fixed by padding each field separately, and tested
against the unpadded output verbatim.

**This is the argument for the done-when being two cards rather than one**,
though not the argument anyone expected — it caught a host-tooling bug
rather than a derivation disagreement.

The `&c=` matches the recorded serial character for character, which is the
thing this whole phase was built to make certain of: the C on the ATtiny and
the TypeScript on the host derive the same serial from the same chip.

The URL proves the rest of the chain too. The card read its own SIGROW,
hashed it, signed a claim token with the real FIRMWARE_SECRET (the token is
not the all-zero-key one, so `secrets.h` was filled in before flashing),
built all 68 bytes, wrote them over I2C, read them back, compared, and
sealed its EEPROM flag. `?d=1` means it then ran the show and patched the
fortune digit — so the ~408 ms first-boot write fits inside the boot window
with room to spare.

Its values are pinned in `pond/test/card-identity.test.ts` as the one vector
that did not come from our own code.

## Still to prove on the bench

Before committing to a hundred:

- Writing **68 bytes** on first boot instead of patching one — the record
  grew by the serial, the counter and the token, so this is ~408 ms at
  `NDEF_EEPROM_WRITE_MS`. Same mechanism, more traffic: confirm it completes
  inside the boot window and survives a brownout mid-write.
- That `SIGROW.SERNUM` is genuinely distinct across a handful of real chips
  from the same reel, not just per lot. **Less load-bearing than it was:**
  the serial is now a hash of all ten bytes rather than a slice of them, so
  two chips differing in one die coordinate get unrelated serials (there are
  pinned vectors for exactly that pair). Two chips with an IDENTICAL SERNUM
  would still collide, which is what this check is really for.
- That the LED confirmation is unmistakable, since it is the only signal that
  a card is finished. (The first card completed, so the pattern exists — what
  is unproven is whether a FAILED provision is distinguishable from a
  successful one at a glance.)

Two cards down, and the derivation is proved. What remains before a hundred
is the brownout behaviour and the LED question above — both are about
failure modes, not about correctness.
