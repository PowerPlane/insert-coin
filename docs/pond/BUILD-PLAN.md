# Build plan

Every decision that has been made, and the order to build in. This is the
document to work from; where it disagrees with an older doc, this wins.

Status: **design complete, nothing deployed.** The prototype is the reference
for anything below that reads ambiguously.

---

## 1. Decisions, settled

### Platform

| | | Why |
| --- | --- | --- |
| **Vercel, Hobby plan** | `ducky.davidyang.work` | Personal card, not sold, so the non-commercial rule is satisfied. **The day BY-002 is something people buy, this needs Pro.** |
| **DNS: one CNAME at Cargo** | `ducky` → `cname.vercel-dns.com` | The apex never moves. This is the whole reason it is not Cloudflare Workers, whose custom domains need the entire zone. |
| **Turso (libSQL)** | the database | It is SQLite. The schema and every query port unchanged — including the atomic `INSERT … SELECT` patterns, which are correct *because* SQLite has one writer. Postgres would mean rewriting them with explicit locking, and getting that subtly wrong means duplicate fires and double rescue credit. |
| **No minute-scale cron** | Hobby crons are daily only, and a more frequent expression fails at deploy | Fire ignites **on read**; `burning` is computed as `now - lit_at < 90s` so nothing runs to extinguish one. The daily cron only sweeps expired sessions and nonces. |

### Routes

```
/                 the pond
/d/<slug>         public duck page — SERVER-RENDERED, for link previews
/e/<key>          private edit page — noindex
/pondkeeper       admin — password, noindex
/api/*            everything else
```

`/d/` is server-rendered so a duck pasted into a group chat previews as a
duck. Cheap now, awkward to retrofit.

### Card identity

**The MCU's serial.** `SIGROW.SERNUM[9:0]` on the ATtiny1616 — ten bytes,
factory-programmed, read-only. Not the ST25DV's UID, even though that is the
more natural identity, because **the programmer already reads SIGROW while
flashing**, so the flashing script can record every serial with no extra step.
That lets the server accept only serials it has seen. The NFC chip's UID lives
where the programmer cannot see it, and `&c=` is typeable, so without a
recorded list anyone could conjure cards.

Consequence: a board reworked with a new MCU becomes a new card. Acceptable at
this scale; admin can merge two rows if it ever happens.

**An unknown serial degrades, it does not fail.** The serial is derived twice
— in C on the ATtiny and in the flashing script on the host — so a byte-order
or bit-range disagreement between them would make *every* card present a
serial the server has never seen. If that happens the visitor must still get
their fortune and a working pond: the tap succeeds, the duck is simply
unattributed, and the card appears flagged in admin. A allowlist that can
brick every card on a naming disagreement is worse than no allowlist.

### Firmware

One binary, flashed identically onto every board. On first boot it:

1. reads `SIGROW.SERNUM`, derives 8 characters (Crockford base32 of the low
   40 bits — no I, L, O or U, so nothing reads as a typo),
2. writes the **whole** NDEF record over I2C, not a patch,
3. reads it back and compares,
4. only then sets a "provisioned" flag in its own EEPROM.

A card that fails verification retries on the next power-up rather than
believing it succeeded.

After that the card writes in only two situations: the fortune digit at
`0x0023` on every coin insert, and the claim counter `&g=NN` when the
four-blow gesture succeeds (see keepers, below).

`config.h` currently documents a six-character `&c=XXXXXX` at `0x0024`. The
serial is **eight** characters — that comment and the offset arithmetic after
it need updating in Phase 2.

`production` and `production-nfc` are never touched. All of this lives in
`production-pond`.

### The pond

- **It wraps.** No edges: pan far enough and you come back round. This deletes
  clamping, which caused most of the camera trouble in this project. Every
  distance measures the short way round.
- **No scenery for now.** No beach, no reeds, no houses. Later, maybe.
- Zoom is the `CELL` constant restricted to `{2, 3, 4, 6, 8}`, **4 is home**.
  Integers only: fractional cells make pixel art shimmer.
- Position and zoom interpolate **together**, one motion, rendered per frame;
  the sub-integer remainder is a CSS scale on an overscanned canvas.
- Two speeds: `CAM_UI` 480ms for controls, `CAM_MOMENT` 1100ms for a release.
- **Bump**, not wave. Ten unreturned bumps and it is their turn.
- The **whistle** is the duck count: tap it to gather a keeper's ducks.

### Card keepers — in the first build

Four blows into the mic during the battery-insert boot window arms config
mode; the next tap opens Card setup.

- A claim counter in EEPROM, emitted as `&g=NN` **after** the digit so the
  patch offset never moves. The server accepts a counter it has not seen,
  which kills replay: reading someone's URL does not let you claim their card.
- `card_epochs` — a card has a *succession of keepers*, not an owner. Ducks
  and contacts carry `epoch_id`, **`ON DELETE SET NULL`, never CASCADE.**
  A keeper deleting their claim must never delete other people's ducks.
- A keeper can: name the card, link their own duck, set the language, and
  adopt the ducks that came from the card before they claimed it.
- **No custom link.** Dropped deliberately: anyone who wants their card to
  point at their own site can rewrite the tag. That deletes an open-redirect
  risk on this domain, the interstitial that existed only to make it safe, and
  a moderation surface.
- Contact scope is **nobody / the keeper / the keeper and David**, named as
  people, and scoped to the epoch — consent was given to Sam, so Mika never
  inherits it.

### Language — in the first build

English and 繁體中文. The keeper sets the card's default; **the visitor's own
phone wins** if it asks for a language we have. A default, not a lock.

- `lang` must be set correctly or a Chinese reader gets Japanese letterforms.
- CJK uses **system faces**. A full Traditional Chinese webfont is megabytes.
- The label style does not survive translation: no uppercase in Chinese, and
  `letter-spacing` on CJK looks broken. Chinese labels get a parallel rule.
- 大吉 · 小吉 · 末吉 · 凶 need no translation; the English gloss simply drops.
- **User-written content is never translated.**

### Privacy, non-negotiable

- The duck card **never** shows the card serial. `via Sam`, or nothing.
- Contacts live in their own table the public read module never names,
  enforced by a test rather than by convention.
- "Take my duck out" deletes the duck and its contact in one transaction.
- Reports carry a reason and an optional note, and both appear in admin next
  to what the duck actually says.

---

## 2. Build order

Each phase ends somewhere real. Do not start the next until the last one is
genuinely working.

### Phase 1 — something answers *(half a day)*

Port the existing worker to Vercel. The logic is written and tested; only the
shell changes.

> The half-day holds **only if this is a shell swap**. Leave `src/worker/*.ts`
> alone, write thin `api/*.ts` adapters, and put the database behind a
> two-method interface so the 42 tests keep running locally. The moment the
> port turns into "improving" those modules, half a day becomes three.

- `src/worker/index.ts` (one `fetch` handler) → `api/*.ts`.
- D1 bindings → Turso client. **SQL unchanged** — but see the next point;
  "unchanged" means the dialect, not the design.
- Move fire ignition into `GET /api/pond`.
- **Port wave → bump.** This is real work hiding under "SQL unchanged": the
  schema still has a `waves` table, `social.ts` still implements `wave`, and
  `PublicDuck` still carries `waves` with no keeper field. The settled design
  needs per-pair `(from_duck, to_duck)` counts, the ten-unreturned cap
  enforced **server-side**, "bump back" derivable from the pair, and `via
  <keeper>` in the pond payload. Deploying a wave-shaped API here would leave
  Phase 3 building a bump-shaped client against it.
- **Stop the duck payload carrying the card serial.** One line, and it closes
  a live hole.
- Deploy. Add the CNAME. Confirm the certificate.

> **Nothing is deployed, so edit `0001_init.sql` directly.** No migration
> file. Pre-deploy is the one moment schema changes are free, and writing a
> migration against a database that has never existed is cargo cult.

**Done when** `curl https://ducky.davidyang.work/api/pond` returns JSON.

### Phase 2 — one real card *(a day, plus bench time)*

Firmware first, because it is the part that can surprise us.

- Read `SIGROW.SERNUM`; derive the serial.
- Write the full NDEF record on first boot; read back and verify.
- The flashing script appends the serial to `cards.csv`.
- **Import `cards.csv` into the Turso `cards` table.** Without this the
  allowlist is a file on a laptop.
- Update the `&c=` length comment and offset arithmetic in `config.h`.
- Flash two boards and tap them with a real phone.

**Done when** the `&c=` in the tapped URL matches, character for character,
the row the flashing script wrote to `cards.csv`. "Two cards open two
different pages" would pass even if the host and the firmware derive the
serial differently — which is exactly the failure worth catching here.

### Phase 3 — the client *(the biggest piece)*

The prototype is one 400 KB file with everything inlined. The real client is
the same nine screens against the real API. `src/client/` already holds the
sprites, the flame generator and the codec.

Order within the phase: pond → arrival → studio → sign → contact → release →
duck card → come back → settings.

**Build the contact screen's scope picker now, not in Phase 5.** Keepers turn
the contact ask from one free-text field into *nobody / the keeper / the
keeper and David*. Since keepers ship in this build, doing it later means
building that screen twice.

Build against the **deployed** API from the first screen, not a mock. The
prototype already proved the UI; what is unproven is the seam.

**Done when** you can tap a card, make a duck, release it, and find it again
from a different phone.

### Phase 4 — admin *(a day)*

`/pondkeeper`. Ducks, Contacts, Cards. Hide/unhide, reply, postcard state,
CSV download. No spreadsheet sync — a CSV cannot drift out of step with a
deleted contact.

### Phase 5 — keepers *(a day, plus firmware)*

The blow gesture, the counter, `card_epochs`, Card setup.

**Do the one-line fix first, in Phase 1, regardless:** stop the duck card
printing the card serial. It publishes half of what a claim is keyed on.

### Phase 6 — 繁體中文 *(half a day)*

About eighty strings from `COPY.md`, the font stack, the `lang` attribute, and
the untracked label variant.

---

## 3. Secrets

Vercel → Settings → Environment Variables, Production:

| | |
| --- | --- |
| `SESSION_SECRET` | HMAC key for session cookies and visitor hashes. 32 random bytes. |
| `ADMIN_PASSWORD` | The real lock on `/pondkeeper`. |
| `TURSO_URL` / `TURSO_TOKEN` | libSQL connection. |
| `CRON_SECRET` | Vercel sends this as a bearer token; reject anything else. |

---

## 4. What could still bite

- **The first-boot NDEF write.** ~45 bytes instead of one. Confirm it finishes
  inside the boot window and survives a brownout mid-write. Retry, verify, and
  only then set the flag.
- **`SERNUM` uniqueness across one reel.** Check a handful of real chips, not
  just the datasheet's promise.
- **Payload at scale.** Every duck carries a 384-character paint layer, so a
  thousand ducks is ~400 KB of JSON. Not a problem at 100 cards; the fix is to
  fetch by region and recency, the same idea as the camera. Written down, not
  built.
- **The LED "done" signal.** It is the only indication a card is finished, so
  it has to be unmistakable.
