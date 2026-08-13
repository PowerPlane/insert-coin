# Progress

The tracker. Tick things off here as they land; `BUILD-PLAN.md` is the
detail behind each line.

**Branch** `pond` · **PR** [#11](https://github.com/PowerPlane/insert-coin/pull/11)
· **Tests** 128 + 100 native C · **Live** <https://ducky.davidyang.work>

---

## The shape of it, in one paragraph

Tap an NFC business card, get one of four fortunes, decorate the duck you were
dealt, sign it, optionally leave a private contact, and release it into a
shared pond that everyone else's ducks are already floating in. Ducks live
forever. You can bump other people's, put out the ones that catch fire, and
whistle to gather everyone from one friend's card. About a hundred cards, all
flashed identically, each giving itself an identity on first boot.

---

## Phases

| | Phase | State | Notes |
| --- | --- | --- | --- |
| **1a** | Turso adapter | ✅ **done** | D1-shaped interface, batch, `meta.changes`. |
| **1b** | Port to Vercel | ✅ **done, deployed** | Contract frozen, routes ported. Live and verified end to end. |
| **2** | One real card | ✅ **done** | Two cards flashed, recorded, tapped, imported. Attribution proved on production. |
| **3** | The client | ⬜ next | Nine screens against the frozen API. The biggest piece. |
| **4** | Admin | ⬜ | `/pondkeeper` — ducks, contacts, cards, CSV. |
| **5** | Keepers | ⬜ | Blow gesture, signed claim, Card setup. Schema is already in. |
| **6** | 繁體中文 | ⬜ | ~80 strings. `lang` negotiation already works. |

---

## Deployed, and verified end to end

Live at <https://ducky.davidyang.work> — Vercel Hobby, Turso remote primary,
one CNAME at Cargo. Verified against the real domain, not a preview URL:

| | |
| --- | --- |
| `GET /api/pond` | 200, `{"ducks":[],"now":…}` |
| `npm run db:verify` | the contact is gone, the session released its reference |
| `/?d=1` | sets `pond_s` — the tap really does become a session |
| release → bump → report → delete | every step, through the live API |
| `/d/<slug>` | server-rendered `og:title`, indexable |
| `/e/<key>` | `x-robots-tag: noindex`, nothing about the duck in the document |
| `/api/sweep` without a bearer token | 404 |
| `accept-language: zh-TW` | `<html lang="zh-Hant">` |

The pond is empty on purpose: every duck made while testing was deleted
through the API, which is itself the proof that deleting works.

### Two things only the deploy could find

Both were invisible locally, and both now have a test that fails without
having to deploy again.

**1 · Extensionless imports 500'd every route.** Vercel transpiles each file
separately rather than bundling, and with `"type": "module"` Node's ESM
loader treats `from "./env"` as a literal path. Every relative import now
carries `.js`. The 90 tests passing at the time could not have caught it —
Vitest loads through Vite, which resolves the way a bundler does, so **the
test environment was more forgiving than production**, which is the one
direction it must never differ in.

**2 · Half the API was unreachable.** `api/[...path].ts` was chosen over a
rewrite so the router would see the real path. It deployed cleanly and then
matched exactly ONE path segment: `/api/pond` worked, `/api/duck/by-slug/…`
returned Vercel's own `NOT_FOUND` without invoking our code. Zero-config
`/api` does not expand a catch-all across segments. `/api/*` is a rewrite
now, like every other route here, and `api/router.ts` reassembles the path
from `__path`.

`test/deploy-shape.test.ts` exists because of these: it asserts the things
that are invisible locally and fatal in production — extensions on every
relative import, the absence of `public/index.html`, that referenced assets
exist, and that the `/api/*` rewrite is still there.

---

## Phase 2 — where it stands

**Done, and testable without hardware:**

- `shared/firmware/card-identity/` — the serial, the claim token, CRC-8 and
  the provisioning flag, as Arduino-free C that compiles for the AVR and the
  host. 100 native checks, including all 64 SipHash reference vectors
  fetched from veorq/SipHash rather than recalled.
- **`card-identity.json` — the pinned spec.** Generated from the C, consumed
  by both sides. Neither implementation is the reference for the other,
  because the failure this guards against (the two derivations disagreeing)
  makes every card unknown at once and does it silently.
- `ndef_record.h` — the whole 68-byte record, every offset derived from the
  strings at compile time. The digit offset comes out at `0x0023`, which is
  what config.h had as a magic number; it is now checked from both sides.
- `pond/src/card/` — the host half, plus the cards.csv parser and importer.
  The importer re-derives every serial from its own recorded SERNUM and
  refuses the whole file on any disagreement.
- `record-card.sh`, `secrets.h.example`, and the gitignore entries for the
  two things that must never be committed.

> **REVISED: the serial is hashed, not sliced.** "The low 40 bits" of
> SIGROW.SERNUM is lot number, wafer number and die coordinates — a hundred
> cards from one reel share a lot, so any fixed window is partly constant
> across the batch and the 4-in-a-billion collision estimate would not have
> been true of it. Hashing all ten bytes makes it honest and costs nothing.

- **The firmware**, written, compiled and now FLASHED. `provision.cpp` is the
  state machine PROVISIONING.md specified; the whole-record write reuses the
  retry wrapper the digit patch already proved. Flash sits at 59.2%.

**It works on real silicon.** 2026-08-12, first card:

```
SERNUM   3054304c493268721626
recorded 0YBSVSVN
tapped   /?d=1&c=0YBSVSVN&g=0000&t=5d29221795
```

Character for character. The whole first-boot chain ran — read SIGROW, hash,
sign, build 68 bytes, write, read back, compare, seal EEPROM — and `?d=1`
means the show ran and patched the digit afterwards, so the ~408 ms write
fits inside the boot window. Those values are pinned in
`card-identity.test.ts` as the one vector not generated by our own code.

### Both cards, and the loop closed on production

```
card 1   SERNUM 3054304c493268721626  ->  0YBSVSVN
card 2   SERNUM 3054304c493247482406  ->  G5JNY9HG
```

Both `&c=` values match what the host derives, character for character.
Both imported into the production `cards` table. Then, tapping card 1's real
URL against the live site and releasing a duck:

```
duck     JDBQdbNBxy
card_id  0YBSVSVN          <- attributed
epoch_id null              <- expected; keepers are Phase 5
public   id,slug,fortune,tint,stickers,paint,name,message,
         created,bumps,rescues,burning,say,keeper
         serial appears nowhere
```

An unknown serial (`ZZZZZZZZ`) still mints a session and still gives a
fortune — the deliberate degrade, not an error.

**The second card immediately earned itself.** `record-card.sh` failed on it:
avrdude does not zero-pad, so a byte below 0x10 prints as `0x6` rather than
`0x06`, and the parser produced nineteen characters instead of twenty. Card
1 happened to have all ten bytes ≥ 0x10. `1 - (15/16)^10` = **48% of cards
would have failed to record**, and one card could never have shown it. The
firmware was never wrong — it reads SIGROW directly and had already written
the right serial into its tag.

The two real SERNUMs also settled the derivation argument: their first SIX
bytes are identical, because both chips came off one reel. Sixty per cent of
the entropy is gone before you start, which is exactly why the serial hashes
all ten bytes rather than slicing "the low 40 bits".

**Left, and neither is about correctness:** brownout mid-write, and whether
a FAILED provision is distinguishable from a success at a glance. Both in
PROVISIONING.md.

### The bench runbook

Everything above is arithmetic and can be proved on a desk. These three
cannot, and PROVISIONING.md has said so from the start:

- **68 bytes on first boot**, ~408 ms at `NDEF_EEPROM_WRITE_MS`. Confirm it
  finishes inside the boot window and survives a brownout mid-record. (Page
  writes would cut this to a handful of cycles — an optimisation for after
  two cards work, not before.)
- **`SIGROW.SERNUM` is distinct across real chips from one reel.** Less
  load-bearing than it was, now the serial is a hash of all ten bytes, but
  two chips with an identical SERNUM would still collide.
- **The LED confirmation is unmistakable**, since it is the only signal a
  card is finished.

**Done when** the `&c=` in the tapped URL matches, character for character,
the row `record-card.sh` wrote — on TWO cards flashed from one binary. Two,
because "two cards open two pages" would pass with the derivations
disagreeing.

---

## Phase 1a — done

`pond/src/db/`. A D1-shaped interface (`prepare().bind().first()/run()/all()`,
`meta.changes`) so `src/worker/*.ts` never learned what platform it was on.
`batch()` for multi-statement writes, proved to roll back. `meta.changes`
proved to report rows *changed*, not matched — `extinguish()` still credits a
rescue on exactly that.

---

## Phase 1b — done

### The foreign-key question, answered by not needing an answer

1a ended with one honest gap: whether `PRAGMA foreign_keys` survives Turso's
HTTP mode on a remote primary could not be checked without a real database.
**So the answer was made not to matter** — and then, once a database existed,
it was checked anyway.

> **ANSWERED, 2026-08-12, against the real Turso primary: it is ON.**
> `connect()` sets the pragma in one `execute()` and reads it back in a
> separate one, so the libSQL client is holding a stateful connection rather
> than firing independent stateless requests. `npm run db:verify` reports
> `foreign_keys on this connection: ON` and all four checks pass.
>
> The trigger stays regardless. It is what makes the promise true on every
> delete path that will ever exist — including the Phase 4 admin screens —
> and it costs nothing. The pragma being on is now a second layer rather
> than the only one.

`ducks_before_delete` in `0001_init.sql` deletes the contact, the bumps in
both directions, the fires, the says and the reports, and releases the
references that would otherwise pin the row. A trigger fires whether or not
foreign keys are on, so **every deletion test runs twice** — once with the
pragma on, once with it deliberately off — and passes both ways.

> **Changed from the plan.** BUILD-PLAN said `connect()` should refuse to
> serve if it could not read the pragma back as ON. It no longer does, for
> remote databases. That gate could not be verified without deploying, and
> if the answer had been "off" the site simply would not have booted —
> downtime bought no safety, because the promise rested on the pragma
> either way. It warns; `npm run db:verify` is the real check, against the
> real database, in ten seconds.

### The bug that fell out of it

`sessions.spent_duck` referenced `ducks(id)` with **no ON DELETE action**, so
it pinned the duck it pointed at. Taking your duck out inside the 30-minute
session window raised a foreign key violation and left the contact behind —
in the most ordinary case there is, releasing a duck and changing your mind.
With foreign keys off it "worked", silently: two environments, two
behaviours, one broken promise.

1a's tests missed it because the fixture built ducks by hand and never went
through a session. The route-level harness in `test/routes.test.ts` exists so
that class of gap closes.

### The contract, frozen

| Area | What landed |
| --- | --- |
| **Bumps** | Replace waves. Per-pair and directional, ten-unreturned cap in one upsert, "bump back" derivable, "Most bumps from" a query. Authenticated by the bumper's edit key — an unauthenticated cap is a weapon. |
| **Keepers** | `card_epochs`. Ducks and contacts carry `epoch_id`, `ON DELETE SET NULL`. Keeper name and language live on the epoch. |
| **`via <keeper>`** | `PublicDuck.keeper`, resolved through the epoch. |
| **Contact scope** | `david` / `keeper` / `keeper_and_david`, defaulting to `david`. "Nobody" is spelled *no row at all*. |
| **Reports** | Reason + note, one per visitor per duck, idempotent. |
| **Card serial** | Out of every public payload, with a test that greps for it. |
| **Deleted** | The denormalised bump/rescue counters (derived now, cannot drift) and the whole `rescues` table — `fires.out_by` already recorded the one person who won. Extinguish is now a single atomic statement. |

### The port

- `handle(req, env)` takes a web `Request` and knows nothing about Vercel.
  `api/router.ts` is a few lines. `/api/*` reaches it by rewrite and hands
  the real path back as `__path` — a filename catch-all (`api/[...path].ts`)
  deployed cleanly and then matched only ONE path segment, so every route
  with a slash in it returned Vercel's own 404 without invoking our code.
- **No `public/index.html`, deliberately.** The CDN serves a static file
  before a function runs, and `/` is where a tap becomes a session. The shell
  is server-rendered, which also buys real link previews on `/d/<slug>` and a
  correct `<html lang>` before Phase 6 needs one.
- Fire ignition moved into `GET /api/pond`.
- **Rate limits implemented**, not just described. `SECURITY.md` had promised
  them for a while; a documented control that does not exist reads exactly
  like one that does.
- `api/sweep.ts` sweeps sessions, nonces and rate-limit windows behind the
  `CRON_SECRET` bearer check — including the nonces `HOSTING.md` always
  claimed were being swept.
- `pond/public/` un-ignored. It was ignored from when Wrangler built the
  client into it; on Vercel it is the output directory, served verbatim and
  generated by nothing, so ignoring it would have deployed a blank page.

---

## Open questions

- **KS0KEKBX is a bench card, deliberately left broken.** Flashed before
  `secrets.h` was filled in, so its claim token is signed with the all-zero
  placeholder, and it is not in `cards.csv`. Harmless as a test card — it
  still deals fortunes, its ducks are just unattributed — but it must be
  erased and reflashed before it goes to anybody.
  `npm run cards:check` identifies it in three seconds.

None blocking. Everything below has a decision; these are worth revisiting
once something is running.

- `CARD_SECRET` is one secret across all cards. Fine for a hundred among
  friends; needs a per-card key if these are ever sold.
- Payload at scale: ~400 KB at a thousand ducks. Fix is fetch-by-region.
- RF write protection on the ST25DV is not configured.
- **Contact scope wording.** The screens must say it in NAMES ("shared with
  Sam and David"), never as a value. Phase 3 writes those strings.
  The schema stores three, and the default is the narrowest: the contact
  screen asks "Want David to reply?" and answers "Only David sees this", so
  somebody who never opens a picker has agreed to exactly that. A default of
  `keeper_and_david` would have shared it with a person the screen never
  named — caught on review, while the freeze was still open.
- Rate limits are 60/day per card and 10/day per visitor. Guesses, not
  measurements. Revisit after the first evening a card gets passed round.

---

## Log

| Date | |
| --- | --- |
| 2026-08-12 | Design complete. Prototype at nine screens, copy deck, UI rules. |
| 2026-08-12 | Plan reviewed twice — internally, then adversarially by Codex. Claim counter replaced with a signed token; Turso FK trap caught; port estimate corrected. |
| 2026-08-12 | **Phase 1a landed.** 49 tests. |
| 2026-08-12 | **Phase 1b landed.** Contract frozen, routes ported, 90 tests. The deletion promise moved from a cascade to a trigger and is now proved with foreign keys off. `sessions.spent_duck` found pinning the duck it pointed at. Not deployed. |
