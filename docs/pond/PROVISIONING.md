# Provisioning a card for the pond

What has to happen to each physical card once, before it can point at
`ducky.davidyang.work`. Roughly ten minutes per card.

The firmware is identical on every card. The only thing that differs is the
NDEF text written once by a phone, which is why the `&c=` suffix goes
*after* the patched digit.

---

## 1 · Pick a card id

Six characters from the unambiguous alphabet (`23456789ABCDEFGHJKMNP…`) —
no `0`/`O` or `1`/`l`/`I`, so it can be read off a card and typed correctly.

Register it before the card can mint anything:

```sql
INSERT INTO cards (id, label, created) VALUES ('7F3A9K', 'the one I gave Sam', unixepoch());
```

An unregistered id is not an error — the Worker stores `NULL` and the pond
still works. You just lose attribution and per-card rate limiting.

## 2 · Write the tag

With the card **unpowered** (no coin), using NFC TagWriter or NFC Tools:

1. Choose **Write → URL**.
2. Enter exactly, including the trailing `0`:

   ```
   https://ducky.davidyang.work/?d=0&c=7F3A9K
   ```

3. Hold the phone over the etched antenna on the back.
4. Read the tag back and confirm you get the same string.

The `0` is the placeholder the firmware overwrites. Writing anything else
there — `?d=1`, or omitting the query entirely — puts the digit at a
different offset and the patch will corrupt the NDEF framing instead.

## 3 · Verify the offset before flashing a batch

Do this once per NDEF layout, not once per card. Phone tag-writers vary, and
`NDEF_DIGIT_OFFSET` assumes the standard short-record layout:

```
0x0000  CC (E1 40 40 00)
0x0004  TLV header (03 LL)
0x0006  NDEF record header (D1 01 LL 55)
0x000A  URI prefix (0x04 = "https://")
0x000B  "ducky.davidyang.work/?d="   24 bytes
0x0023  the digit                    ← NDEF_DIGIT_OFFSET
0x0024  "&c=7F3A9K"                  moves nothing
```

To check:

1. Write the tag as above, scan it with the card unpowered, confirm `?d=0`.
2. Flash `production-pond` and insert a coin.
3. Scan during the reveal. The URL should end `?d=N&c=7F3A9K` with `N` in 1–4.

If the URL is unchanged, the offset is wrong. If it's mangled, the offset is
wrong in the other direction. Dump the first 32 bytes of user memory with a
Wire read loop and adjust `NDEF_DIGIT_OFFSET` in
`production-pond/src/config.h`.

## 4 · Flash

```bash
cd variants/business-card-v1/firmware
pio run -e production-pond -t upload
```

The other environments are untouched and still available:

```bash
pio run -e production       # no NFC writes at all
pio run -e production-nfc   # davidyang.work/?d=N, 120 s window
```

## 5 · Confirm end to end

1. Insert a coin, watch the show.
2. Tap during or shortly after the reveal → the pond, holding your fortune.
3. Wait five minutes, tap again → the read-only pond. That's `?d=0` and it
   is correct behaviour, not a failure.

---

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| Always the read-only pond, even during the reveal | Offset wrong, or the tag was written with something other than `?d=0` |
| Shows the *previous* person's fortune | An RF field beat the I²C write. `production-pond` retries four times and clears the digit if all four fail; `production-nfc` does not. |
| Window feels much shorter than 5 minutes | You're on `production-nfc` (120 s), or someone narrowed `NDEF_EXPIRY_SECONDS` past 255 — the `static_assert` in `config.h` exists to catch exactly that |
| Tag reads but the page 404s | The Worker route isn't attached, or `wrangler.toml` still has `database_id = "REPLACE_ME"` |

## Retiring a card

```sql
UPDATE cards SET disabled = 1 WHERE id = '7F3A9K';
```

Immediate, and it leaves every duck that card already minted exactly where
it is.
