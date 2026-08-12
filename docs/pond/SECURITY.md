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

| Control | Effect | State |
| --- | --- | --- |
| One duck per session | Both the insert and the claim carry `WHERE spent_duck IS NULL`, in one `batch()` — the loser of a race inserts nothing | ✅ |
| Rate limit per card id | 60 mints a day. A card gets passed round a table, so this is generous by design; a scripted card id still cannot mint hundreds overnight | ✅ 1b |
| Rate limit per visitor | 10 mints a day. Clearing cookies to farm ducks is slow and boring rather than impossible — the honest goal is friction | ✅ 1b |
| `cards.disabled` | A lost or abused card is switched off without touching any existing duck | ✅ |
| Admin hide | Anything that gets through is one tap from invisible | Phase 4 |

**The rate limits were written here before they existed**, and that is worth
naming: a documented control that is not built reads exactly like one that
is. They are built now — `src/worker/limits.ts`, a fixed window decided in a
single upsert, because a limiter that reads then writes lets two requests
both see 9 and both write 10. Being over a limit produces exactly what
tapping a card with no coin in it produces: a read-only pond. There is no
honest way to distinguish the two to a visitor without also telling a farmer
which limit they hit.

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

`/e/<32-char key>` is a bearer credential with no expiry, no rotation and
no recovery. That is a deliberate trade — accounts would be heavier than the
thing they protect — but the failure modes are real:

| Failure | Handling |
| --- | --- |
| Link lost | The duck stays; it just can't be edited. There is no recovery, by design. |
| Link leaked | Whoever has it can edit or delete that duck. Nothing else. The page itself server-renders **nothing** about the duck, so the document in a cache or a screenshot is not the leak. |
| Leaks via `Referer` | Prevented: `Referrer-Policy: no-referrer` on every response |
| Leaks via search engines | Prevented: `X-Robots-Tag: noindex, nofollow` on `/e/*`, set both by the function and in `vercel.json` — this is the one header whose absence cannot be noticed until a bearer URL is already indexed. `/pondkeeper` gets the same in Phase 4. `/d/<slug>` is public on purpose and stays indexable. |
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

- Separate table, its own access path.
- The public read module **does not name the table**, and the one module that
  may write to it (`release.ts`) never reads from it.
  `test/contacts-isolation.test.ts` fails the build if either changes.
- `PublicDuck` is asserted to contain no contact-shaped field — and no card
  serial, which is half of what a card claim is keyed on.
- **Deleting a duck deletes the contact, and that does not depend on foreign
  keys being enforced.** It used to: `ON DELETE CASCADE` does nothing when
  `PRAGMA foreign_keys` is off, which is per-connection, off by default, and
  not something we can verify on Turso's HTTP mode from here. The cascade is
  still declared, but the thing that actually does the work is a trigger,
  `ducks_before_delete`, which fires either way. Every deletion test runs
  twice — once with the pragma deliberately off.
- `scope` records who the contact was shared with, and `epoch_id` ties that
  consent to the keeper it was given to. **Choosing "nobody" writes no row**,
  so there is nothing to leak and nothing to have to delete later.

**Not defended:** admin compromise, database backups, and anything David
exports. Table separation is access-control hygiene, not encryption. If
contacts ever need to survive a stolen backup, that is a different design.

---

## 5 · Concurrency

Every high-frequency action is a single atomic statement. SQLite has one
writer at a time, so read-then-write loses under concurrency — that was true
on D1 and is equally true on Turso, which is part of why the database moved
sideways rather than to Postgres:

| Action | Mechanism |
| --- | --- |
| Bump | One upsert. The ten-unreturned cap is the `WHERE`; `ON CONFLICT DO UPDATE` is the repeat |
| Extinguish | `UPDATE fires … WHERE out_at IS NULL` — first writer wins, and winning *is* the credit |
| Say | `INSERT … SELECT … WHERE NOT EXISTS` — the cooldown *is* the insert |
| Release | Insert and claim share one guard, in one `batch()` |
| Report | `INSERT OR IGNORE` on `(duck_id, visitor)` — the button is idempotent |
| Rate limit | One upsert guarded on the current count |

None of these use a JS-side read, compare, write. That pattern is how you get
lost bumps and bypassed cooldowns.

**Two counters were deleted rather than made atomic.** Bumps and rescues used
to be denormalised columns updated by a second write; they are derived at read
time now. The half-state window did not need closing, it needed not to exist.

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

Every duck has a report button. A report carries one of four reasons and an
optional note, because a bare row tells the person reading the queue nothing
they can act on — "Rude or abusive" and "Private details" need different
responses, and the second needs answering quickly. One report per visitor per
duck, so the queue cannot be flooded by one person tapping repeatedly.

Hiding is one tap in admin and is never a hard delete, so a mistake is
reversible.

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
