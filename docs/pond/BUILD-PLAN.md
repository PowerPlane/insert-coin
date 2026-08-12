# Build plan

Every decision, and the order to build in. This is the document to work from;
where it disagrees with an older doc, this wins.

Status: **Phases 1a and 1b built, nothing deployed.** Reviewed twice — once
for internal contradictions, once adversarially by Codex. What follows
incorporates both, plus what building it actually taught us.

Where a decision changed during the build, it is marked **REVISED** and says
why. `PROGRESS.md` is the tracker; this is the reasoning behind it.

---

## 1. Decisions, settled

### Platform

| | | Why |
| --- | --- | --- |
| **Vercel, Hobby** | `ducky.davidyang.work` | Personal card, not sold. **The day BY-002 is something people buy, this needs Pro.** |
| **One CNAME at Cargo** | `ducky` → `cname.vercel-dns.com` | The apex never moves. That is the whole reason this is not Cloudflare Workers. |
| **Turso (libSQL)** | the database | It is SQLite, so the schema and SQL dialect carry over. **The client API does not** — see §3. |
| **Remote primary only. No embedded replicas.** | | Embedded replicas read locally and write remotely, so a fire ignited during one request can be invisible to the next. Read-your-writes is load-bearing here, not a nicety. |
| **No minute-scale cron** | Hobby crons are daily, and a finer expression fails at deploy | Fire ignites **on read**; `burning` is `now - lit_at < 90s`, computed, so nothing runs to put one out. The daily cron only sweeps sessions, nonces and spent rate-limit windows. |

### Routes

```
/                 the pond            → api/shell.ts
/d/<slug>         public duck page    → api/duck-page.ts   SERVER-RENDERED
/e/<key>          private edit page   → api/duck-edit.ts   noindex
/pondkeeper       admin               → Phase 4; not routed yet
/api/*            everything else     → api/[...path].ts
```

**There is no `public/index.html`, deliberately.** Vercel's CDN serves a
static file before any function runs, so an index.html would mean `/` could
never exchange a tap for a session — and that exchange has exactly one
chance to happen. The shell is rendered by `src/worker/shell.ts`, which is
also what gives `/d/<slug>` real link previews and `<html lang>` a correct
value before Phase 6 needs one.

### Card identity

**The MCU's serial.** `SIGROW.SERNUM[9:0]` on the ATtiny1616 — ten bytes,
factory-programmed, read-only. Not the ST25DV's UID, because the programmer
already reads `SIGROW` while flashing, so the host can record every serial
with no extra step. The NFC chip's UID lives where the programmer cannot see
it.

Eight Crockford base32 characters from the low 40 bits (no I, L, O or U).
**This is not collision-proof, it is collision-*unlikely*** — about 4 in a
billion across a hundred cards. `cards.id` is a primary key, so a collision
would make two physical cards indistinguishable. The import step rejects a
duplicate loudly rather than overwriting.

**An unknown serial degrades, it does not fail.** The serial is derived twice
— in C on the MCU, in Python on the host — so a byte-order or bit-range
disagreement would make *every* card unknown at once. The visitor still gets
their fortune and a working pond; the duck is simply unattributed and the card
is flagged in admin. **Shared test vectors** (§ Phase 2) are what stop this
from happening at all.

### The claim credential

The earlier design — a counter `&g=NN`, accepted if unseen — was not a
credential. Everything in the URL is typed text, so an unseen counter proves
only that nobody has used *that number* yet. Anyone who learned a serial could
walk the counter space by hand.

**The card signs its claim.**

```
token = SipHash-2-4( FIRMWARE_SECRET, serial ‖ counter )   truncated to 40 bits
URL   = /?d=<digit>&c=<serial>&g=<counter>&t=<token>
```

- `FIRMWARE_SECRET` is a 128-bit constant compiled into the binary. Every card
  has the same one, so the firmware is still **identical on every board** and
  there is still no per-card data.
- SipHash-2-4 because it is built for exactly this: short messages, keyed,
  ~200 bytes of code, fast on an 8-bit AVR. HMAC-SHA256 would work and is
  overkill on 2 KB of RAM.
- The counter is **16-bit** in EEPROM. Four hex characters, 65,536 gestures —
  it never wraps in practice, so there is no wrap semantics to define.
- The server accepts a claim when the token verifies **and** the counter is
  greater than the highest it has seen for that card. Both, not either.
- **Increment EEPROM first, then write the NDEF.** If the write fails, the
  counter has advanced and the card shows a stale token — the next gesture
  advances again and writes correctly. The other order lets a consumed
  counter reappear, which is the one outcome that breaks the scheme.
- Claim attempts are rate-limited per card and per visitor. Ten a day is
  generous for a gesture that requires opening a battery holder.

**What this stops:** forging a claim without the secret, and replaying a
claim URL you saw over someone's shoulder.

**What it does not stop, stated plainly:**

- **Extracting `FIRMWARE_SECRET` from a card.** Set the ATtiny lock bits, and
  accept that a determined attacker with physical possession and a programmer
  wins. For a hundred cards given to friends that is proportionate; if these
  are ever sold, this needs a per-card key written at flash time instead.
- **Someone who physically holds the card claiming it.** That is the design,
  not a flaw — possession *is* the credential.
- **Racing the legitimate keeper.** Anyone who can see the armed URL was
  standing next to the card, which is the same bar. First writer wins.
- **Rewriting the tag.** RF write protection is not configured; see
  `SECURITY.md`.

### The pond

- **It wraps.** No edges. Deleting clamping deleted most of the camera bugs in
  this project. Every distance measures the short way round.
- **No scenery for now.** Later, maybe.
- Zoom is `CELL` ∈ `{2,3,4,6,8}`, **4 is home**. Integers only.
- Position and zoom interpolate together, one motion; the sub-integer
  remainder is a CSS scale on an overscanned canvas.
- **Bump**, not wave. Ten unreturned bumps and it is their turn.
- The **whistle** is the duck count.

Full detail in `POND-CAMERA.md`.

### Card keepers — in the first build

Four blows during the battery-insert boot window arms config; the next tap
opens Card setup, carrying the signed claim above.

- `card_epochs` — a card has a *succession of keepers*, not an owner. Ducks
  and contacts carry `epoch_id`, **`ON DELETE SET NULL`, never CASCADE.**
- A keeper can name the card, link their own duck, set the language, and adopt
  the ducks that predate their claim.
- **No custom link.** Anyone who wants their card to point elsewhere can
  rewrite the tag. Removing it deletes an open-redirect risk on this domain.
- Contact scope is **nobody / the keeper / the keeper and David**, named as
  people, scoped to the epoch — consent was given to Sam, so Mika never
  inherits it. **In the schema "nobody" is the absence of a row**, not a
  third value: choosing it means nothing is stored, which is a stronger
  promise than storing a flag that says not to look.

### Language — in the first build

English and 繁體中文. Keeper sets the default; **the visitor's phone wins**.
`lang` must be correct or Chinese readers get Japanese letterforms. CJK uses
system faces. The uppercase-and-tracked label style needs a parallel rule.
大吉 · 小吉 · 末吉 · 凶 need no translation. **User content is never
translated.**

### Privacy, non-negotiable

- The duck card **never** shows the card serial. It shows `via <keeper>`,
  resolved through the epoch, or nothing.
- Contacts live in their own table the public read module never names,
  enforced by test. The one module that may write to it is `release.ts`, and
  nothing reads a contact back out until Phase 4.
- "Take my duck out" deletes the duck and its contact **in one statement**.
  **REVISED:** this used to rest on `ON DELETE CASCADE`, and therefore on a
  per-connection pragma that cannot be verified without a deployed database.
  It is now a trigger, `ducks_before_delete`, which fires either way — see
  §3, Phase 1b.

---

## 2. The contract — FROZEN as of Phase 1b ✅

Phase 3 builds nine screens against this. Changing it afterwards means
changing them twice. Nothing was deployed, so `0001_init.sql` was edited
directly — writing a migration against a database that has never existed is
cargo cult.

**From the first deploy onward this file is closed and `0002_*.sql` opens.**

| Area | Was missing | Landed as |
| --- | --- | --- |
| **Bumps** | `waves` was wave-shaped — a number on a duck. | `bumps(from_duck, to_duck, total)`. The cap is one upsert: `WHERE sent − received < 10`. "Bump back" is the reverse row; "Most bumps from" is a query. **Authenticated by the bumper's edit key** — an unauthenticated cap lets anyone spend a stranger's allowance, which makes it a weapon rather than a courtesy. |
| **Keepers** | `card_epochs` did not exist. | It does. Ducks and contacts carry a nullable `epoch_id`, `ON DELETE SET NULL`, never CASCADE — ending a tenure must never delete a stranger's duck. A partial unique index enforces one current keeper per card. |
| **`via <keeper>`** | `PublicDuck` had no keeper field. | `keeper: string \| null`, resolved through the epoch. |
| **Contact scope** | `contacts` had only `duck_id`, `value`, `created`. | `scope` ∈ `keeper` / `keeper_and_david`, plus `epoch_id` so consent expires with the keeper it was given to. **"Nobody" is spelled *no row at all*** — nothing stored is nothing to leak. |
| **Reports** | Stored neither reason nor note. | Both, `CHECK`ed against the four buttons in COPY.md, one per visitor per duck so the button is idempotent. |
| **Language** | No column on `card_epochs`. | `lang`, and `pickLanguage()` already negotiates it against the visitor's phone. |
| **Card serial** | Had to come **out** of the duck payload. | It was never in it — the real work was making sure it never gets in. `card_id` is admin-only, the public read resolves the epoch, and a test greps for both. |

---

## 3. Build order

### Phase 1a — the Turso adapter *(half a day, on its own)*

Before any route is ported. This is where the port's real risk lives.

- A two-method interface the worker modules talk to, so the 42 tests keep
  running locally and `src/worker/*.ts` need not change.
- Map D1 shapes: `.prepare().bind().run()/first()/all()` and **`meta.changes`**,
  which the extinguish and rename paths depend on for correctness, onto
  libSQL's `execute` / `batch` / `transaction`.
- **`PRAGMA foreign_keys = ON` per connection.** SQLite defaults it *off* and
  it is per-connection, so a pooled Turso HTTP connection can arrive without
  it. **REVISED — this is no longer what the promise rests on.** See Phase 1b.
- Multi-statement writes become `batch`, not two awaits. The known offenders:
  bump insert + counter, extinguish + rescue credit, release + session claim +
  contact. Each currently has a window where a crash leaves a half-state.
  **Two of the three were deleted rather than batched** — see Phase 1b.

**Done when** the existing tests pass against real libSQL — including a test
that deletes a duck and asserts the contact row is gone. ✅

### Phase 1b — the port and the freeze ✅ *(built; deploy outstanding)*

- `src/worker/index.ts` becomes `handle(req, env)`, which knows nothing about
  Vercel; `api/[...path].ts` hands it a `Request`. A catch-all **by filename,
  not a rewrite** — a rewrite gives a function its destination path, and the
  router dispatches on the path.
- `api/sweep.ts` for the daily cron, behind the `CRON_SECRET` bearer check.
- Fire ignition moves into `GET /api/pond`.
- Apply the §2 contract changes.
- Replace the Wrangler/D1 scripts in `package.json`.
- Deploy. Add the CNAME. Confirm the certificate. ← **the only step left**

**Done when** `curl https://ducky.davidyang.work/api/pond` returns JSON *and*
`npm run db:verify` reports the contact gone.

> The old "half a day for the whole port" was wrong, and I had been told so
> once before publishing it. A day and a half was closer, and the shape of the
> time was not what the estimate assumed: the routing was mechanical, and the
> schema freeze was where the thinking went.

#### REVISED: the deletion promise is a trigger, not a cascade

The plan said `connect()` should assert the pragma and refuse to serve if it
was off. Building it made the flaw obvious: **that gate cannot be verified
without deploying, and if the answer were "off" the site would not boot.**
Downtime, in exchange for no safety — because the promise was resting on the
pragma either way.

So the promise moved into the schema. `ducks_before_delete` deletes the
contact, the bumps in both directions, the fires, the says and the reports,
and releases the references that would otherwise pin the row. **A trigger
fires whether or not foreign keys are on.** Every deletion test now runs
twice, once with the pragma deliberately off, and `npm run db:verify` proves
it against the real database in ten seconds.

It also covers every delete path that will ever exist — including the admin
screens in Phase 4 — without anyone having to remember this file.

#### The bug the freeze was for

`sessions.spent_duck` referenced `ducks(id)` with **no ON DELETE action**, so
it pinned the duck it pointed at. "Take my duck out", inside the 30-minute
session window, raised a foreign key violation and left the contact behind.
With foreign keys off it silently succeeded. Two environments, two behaviours,
and the failing one was the ordinary case: release a duck, change your mind.

Phase 1a's tests missed it because the fixture built ducks by hand rather than
through a session. **A fixture that skips the real write path is a test that
agrees with you.**

#### REVISED: two things deleted rather than built

- **The denormalised counters.** `ducks.wave_count` and `rescue_count` are
  gone; bumps and rescues are derived at read time. A stored total beside the
  per-pair table it is supposed to equal is a drift waiting to happen, and
  keeping them in step needed a second write with a window in the middle.
- **The `rescues` table.** Credit belongs to whoever won the `out_at IS NULL`
  race — one person — and `fires.out_by` already recorded exactly that. The
  table could only ever hold one row per fire saying the same thing.
  Deleting it collapsed `extinguish()` to a **single atomic statement** whose
  `meta.changes` is both "you won" and "you are credited".

Two of the three half-state windows §1a set out to close were closed by
removing the second write, not by wrapping it.

### Phase 2 — one real card *(a day, plus bench time)*

Firmware first: it is the part that can surprise us.

Provisioning is a **state machine**, not a script:

```
  UNPROVISIONED ──write record──► WRITTEN ──readback ok──► PROVISIONED
        ▲                            │
        └────────── mismatch ────────┘
```

- The flag is a **versioned magic plus CRC**, not one byte. A single byte can
  be corrupted mid-write into something that looks provisioned, stranding a
  card with a broken record and no way to notice.
- Write the whole NDEF record, read it back, compare, and only then set the
  flag. A card that fails verification retries next power-up.
- ~45 bytes at 6 ms per EEPROM cycle. Confirm it completes inside the boot
  window and survives a brownout mid-record.
- **Shared test vectors.** A fixture of `SERNUM → serial → token` that both
  the C code and the host script are tested against. This is the cheap
  insurance against the two derivations disagreeing.
- Write `tools/record-card.sh` — referenced by `PROVISIONING.md`, does not
  exist — and **import `cards.csv` into the `cards` table**, rejecting
  duplicates loudly.
- Update `config.h`: it documents a six-character `&c=` and the record is now
  longer by the serial, counter and token.

**Done when** the `&c=` in the tapped URL matches, character for character,
the row the flashing script wrote — on two cards flashed from one binary.
"Two cards open two pages" would pass with the derivations disagreeing.

### Phase 3 — the client *(the biggest piece)*

Nine screens against the real API. `src/client/` already holds the sprites,
the flame generator and the codec.

pond → arrival → studio → sign → contact → release → duck card → come back →
settings.

Build the contact screen's **scope picker** now, not in Phase 5 — keepers ship
in this build, so doing it later means building that screen twice. Build
against the **deployed** API from the first screen; the prototype proved the
UI, the seam is what is unproven.

### Phase 4 — admin *(a day)*

`/pondkeeper`. Ducks, Contacts, Cards. Hide/unhide, reply, postcard state, CSV
download. No spreadsheet sync — a CSV cannot drift out of step with a deleted
contact.

### Phase 5 — keepers *(a day, plus firmware)*

The blow gesture, the signed claim, `card_epochs`, Card setup. The schema and
API for this landed in Phase 1; this is the behaviour.

### Phase 6 — 繁體中文 *(half a day)*

~80 strings from `COPY.md`, the font stack, the `lang` attribute, the
untracked label variant.

---

## 4. Secrets

| | |
| --- | --- |
| `SESSION_SECRET` | HMAC key for session cookies and visitor hashes. |
| `ADMIN_PASSWORD` | The real lock on `/pondkeeper`. |
| `TURSO_URL` / `TURSO_TOKEN` | libSQL connection. |
| `CRON_SECRET` | Vercel sends this as a bearer token; reject anything else. |
| `CARD_SECRET` | The server's copy of `FIRMWARE_SECRET`, for verifying claim tokens. |

---

## 5. Known gaps, carried deliberately

- ~~**Rate limits are documented but not implemented.**~~ **Done in 1b.**
  `src/worker/limits.ts`, a fixed window in a single upsert. 60/day per card
  (a card gets passed round a table — that is the point) and 10/day per
  visitor. Both numbers are guesses and should be revisited after the first
  evening a card is actually used.
- **Payload at scale.** Every duck carries a 384-character paint layer, so a
  thousand ducks is ~400 KB. Fine at a hundred cards; the fix is fetch by
  region and recency. Written down, not built.
- **RF write protection on the ST25DV is not configured.** Anyone with an NFC
  writer can overwrite a tag. Out of scope, and the reason the keeper's custom
  link was dropped rather than secured.
