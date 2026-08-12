# Build plan

Every decision, and the order to build in. This is the document to work from;
where it disagrees with an older doc, this wins.

Status: **design complete, nothing deployed.** Reviewed twice — once for
internal contradictions, once adversarially by Codex. What follows already
incorporates both.

---

## 1. Decisions, settled

### Platform

| | | Why |
| --- | --- | --- |
| **Vercel, Hobby** | `ducky.davidyang.work` | Personal card, not sold. **The day BY-002 is something people buy, this needs Pro.** |
| **One CNAME at Cargo** | `ducky` → `cname.vercel-dns.com` | The apex never moves. That is the whole reason this is not Cloudflare Workers. |
| **Turso (libSQL)** | the database | It is SQLite, so the schema and SQL dialect carry over. **The client API does not** — see §3. |
| **Remote primary only. No embedded replicas.** | | Embedded replicas read locally and write remotely, so a fire ignited during one request can be invisible to the next. Read-your-writes is load-bearing here, not a nicety. |
| **No minute-scale cron** | Hobby crons are daily, and a finer expression fails at deploy | Fire ignites **on read**; `burning` is `now - lit_at < 90s`, computed, so nothing runs to put one out. The daily cron only sweeps sessions and nonces. |

### Routes

```
/                 the pond
/d/<slug>         public duck page — SERVER-RENDERED, for link previews
/e/<key>          private edit page — noindex
/pondkeeper       admin — password, noindex
/api/*            everything else
```

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
  inherits it.

### Language — in the first build

English and 繁體中文. Keeper sets the default; **the visitor's phone wins**.
`lang` must be correct or Chinese readers get Japanese letterforms. CJK uses
system faces. The uppercase-and-tracked label style needs a parallel rule.
大吉 · 小吉 · 末吉 · 凶 need no translation. **User content is never
translated.**

### Privacy, non-negotiable

- The duck card **never** shows the card serial.
- Contacts live in their own table the public read module never names,
  enforced by test.
- "Take my duck out" deletes the duck and its contact **in one transaction** —
  see the foreign-key note in §3, because this promise depends on it.

---

## 2. Freeze the contract before the client starts

Phase 3 builds nine screens against this. Changing it afterwards means
changing them twice. **Nothing is deployed, so `0001_init.sql` gets edited
directly — no migration file.** Writing a migration against a database that
has never existed is cargo cult.

| Area | What is missing today |
| --- | --- |
| **Bumps** | `waves` table and `wave` in `social.ts` are wave-shaped. Needs per-pair `(from_duck, to_duck)` counts, the ten-unreturned cap **server-side**, and "bump back" derivable from the pair. |
| **Keepers** | `card_epochs` does not exist. Ducks and contacts need a nullable `epoch_id`. |
| **`via <keeper>`** | `PublicDuck` has no keeper field. |
| **Contact scope** | `contacts` has only `duck_id`, `value`, `created`. Needs a scope column; the client API sends only `contact?: string`. |
| **Reports** | Schema stores neither reason nor note; the prototype collects both. |
| **Language** | No column on `card_epochs`. |
| **Card serial** | Must come **out** of the duck payload. One line, and it closes a live hole. |

---

## 3. Build order

### Phase 1a — the Turso adapter *(half a day, on its own)*

Before any route is ported. This is where the port's real risk lives.

- A two-method interface the worker modules talk to, so the 42 tests keep
  running locally and `src/worker/*.ts` need not change.
- Map D1 shapes: `.prepare().bind().run()/first()/all()` and **`meta.changes`**,
  which the extinguish and rename paths depend on for correctness, onto
  libSQL's `execute` / `batch` / `transaction`.
- **`PRAGMA foreign_keys = ON` per connection.** Turso defaults it *off* for
  SQLite compatibility. `ON DELETE CASCADE` from ducks to contacts is what
  makes "take my duck out deletes everything" true — without this the privacy
  promise fails silently, with no error. **Assert it at startup and refuse to
  serve if it is off.**
- Multi-statement writes become `batch`, not two awaits. The known offenders:
  bump insert + counter, extinguish + rescue credit, release + session claim +
  contact. Each currently has a window where a crash leaves a half-state.

**Done when** the existing tests pass against a real Turso database with FKs
provably on — including a test that deletes a duck and asserts the contact row
is gone.

### Phase 1b — the port *(a day)*

- `src/worker/index.ts` (`fetch` + `scheduled`) → `api/*.ts`. Static serving
  loses `env.ASSETS.fetch`.
- `api/sweep.ts` for the daily cron — declared in `vercel.json`, does not exist.
- Fire ignition moves into `GET /api/pond`.
- Apply the §2 contract changes.
- Replace the Wrangler/D1 scripts in `package.json`.
- Deploy. Add the CNAME. Confirm the certificate.

**Done when** `curl https://ducky.davidyang.work/api/pond` returns JSON.

> The old "half a day for the whole port" was wrong, and I had been told so
> once before publishing it. `Env.DB` is typed `D1Database`, `Env.ASSETS` is a
> Worker `Fetcher`, and Phase 1 also carries four product changes. A day and a
> half total, and only if the worker modules are left alone.

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

- **Rate limits are documented but not implemented.** `SECURITY.md` describes
  per-card and per-visitor limits; `mintSession()` has no check. Needed before
  the claim endpoint exists, so: Phase 1b.
- **Payload at scale.** Every duck carries a 384-character paint layer, so a
  thousand ducks is ~400 KB. Fine at a hundred cards; the fix is fetch by
  region and recency. Written down, not built.
- **RF write protection on the ST25DV is not configured.** Anyone with an NFC
  writer can overwrite a tag. Out of scope, and the reason the keeper's custom
  link was dropped rather than secured.
