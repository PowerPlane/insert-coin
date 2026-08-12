# The Pond — threat model

Written to be honest rather than reassuring. Most of this is the result of an
external review; where something is genuinely not defended, it says so.

The short version: **the card is not an authentication device, and the pond
does not pretend it is.** What protects the pond is that it's small, every
action is reversible, and nothing valuable is stored.

---

## 1 · `?d=N` is forgeable, and that is the central fact

Anyone can type `ducky.davidyang.work/?d=1` and get a great-luck session without
ever touching a card. The digit proves a fortune was *requested*, not that a
coin was *inserted*.

This was worth stating plainly because the original design leaned on the
120-second expiry as if it were a credential. It isn't — the expiry only
limits how long the *physical card* advertises a fortune. It does nothing
about someone typing the URL.

**What actually holds the line:**

| Control | Effect |
| --- | --- |
| One duck per session | A session is spent atomically (`UPDATE … WHERE spent_duck IS NULL`) |
| Rate limit per card id | A card that starts minting dozens of ducks gets throttled |
| Rate limit per visitor | Clearing cookies to farm ducks is slow and boring |
| `cards.disabled` | A lost or abused card is switched off without touching any existing duck |
| Admin hide | Anything that gets through is one tap from invisible |

**What would actually fix it:** a per-coin-insert nonce written by the MCU
(`&n=`) and consumed once server-side. The schema and `mintSession()` already
support it — `nonces` has a `(card_id, nonce)` primary key, so a replay
collides on INSERT and is rejected. It is not enabled because the firmware
does not yet write it, and doing so means patching more than one byte.

**Nonce sizing, if it is ever turned on:** four characters is not enough. At
base36 that's ~1.7M values, brute-forceable against a known card id in an
afternoon. Use at least 8 characters and rate-limit failed nonce lookups.

**Verdict:** accepted for a friend-scale pond, with the controls above.
Revisit before a card goes anywhere public.

---

## 2 · The card's URL is public and shareable

Every card serves the same URL modulo one digit. Screenshotting or forwarding
`/?d=3` hands someone else a fortune.

For a pond meant for friends this is close to harmless and arguably charming.
It is listed here so the decision is deliberate rather than overlooked.

**Not defended:** the ST25DV's RF write protection and I²C password are not
configured, so the tag can in principle be rewritten by anyone with an NFC
writer and physical access to a card. Physical access to the card is already
game over for a card-based system, so this is noted rather than fixed.

---

## 3 · The private link is the account

`/d/<32-char key>` is a bearer credential with no expiry, no rotation and
no recovery. That is a deliberate trade — accounts would be heavier than the
thing they protect — but the failure modes are real:

| Failure | Handling |
| --- | --- |
| Link lost | The duck stays; it just can't be edited. There is no recovery, by design. |
| Link leaked | Whoever has it can edit or delete that duck. Nothing else. |
| Leaks via `Referer` | Prevented: `Referrer-Policy: no-referrer` on every response |
| Leaks via search engines | Prevented: `X-Robots-Tag: noindex, nofollow` on `/d/*` |
| Leaks via server logs | The key is in the path, so **do not log full URLs**. |
| Shared device / history | Not defended. It is a link in a browser. |

The key is 32 characters from a 55-character alphabet (~185 bits) and is
generated independently of the public duck id, so knowing a duck tells you
nothing about its key.

**Blast radius is one duck.** There is no account, no password, nothing to
reuse elsewhere, and the contact behind it is deleted with it.

---

## 4 · Contacts

The one thing here that would genuinely hurt someone if it leaked.

- Separate table, its own access path, `ON DELETE CASCADE` from `ducks`.
- The public read module **does not name the table**. `test/contacts-isolation.test.ts`
  fails the build if it ever does.
- `PublicDuck` is asserted to contain no contact-shaped field.
- Deleting a duck deletes the contact in the same statement.

**Not defended:** admin compromise, database backups, and anything David
exports. Table separation is access-control hygiene, not encryption. If
contacts ever need to survive a stolen backup, that is a different design.

---

## 5 · Concurrency

Every high-frequency action is a single atomic statement, because D1
serialises writes per database and read-then-write loses under concurrency:

| Action | Mechanism |
| --- | --- |
| Wave | `INSERT OR IGNORE` on `(duck_id, visitor)`, then `wave_count = wave_count + 1` |
| Extinguish | `UPDATE fires … WHERE out_at IS NULL` — first writer wins |
| Say | `INSERT … SELECT … WHERE NOT EXISTS` — the cooldown *is* the insert |
| Release | `UPDATE sessions … WHERE spent_duck IS NULL` |

None of these use a JS-side read, compare, write. That pattern is how you get
lost waves and bypassed cooldowns.

**Known ceiling:** the pond is polled, and every client fetches the whole
visible pond. That is fine at a few hundred ducks and will not be fine at
tens of thousands. The fix when it arrives is a cached response with a short
TTL, not a Durable Object.

---

## 6 · Content

24×24 pixels, a fixed palette and a curated sticker set is a low ceiling on
what can be depicted, but not zero. Text is normalised, control and format characters are
stripped by Unicode property — while deliberately KEEPING zero-width
joiners and variation selectors, since stripping those shreds ordinary
emoji — and lengths are counted in code points so an emoji costs one.

Every duck has a report button; hiding is one tap in admin and is never a
hard delete, so a mistake is reversible.

---

## 7 · Admin

Behind a secret path **and** a password. The password is the security; the
path is convenience. URLs leak through browser history, referrers and logs,
so the path is not treated as a secret.

---

## What breaks first

In the order it will actually happen:

1. Someone types `/?d=1` and makes a duck without a card. Mitigated, not prevented.
2. A person loses their private link and wants their duck edited. There is no recovery — answer honestly.
3. Polling the whole pond gets slow enough to notice. Cache it.
4. A message or drawing needs hiding. One tap; make sure admin works before handing out the first card.
