# Progress

The tracker. Tick things off here as they land; `BUILD-PLAN.md` is the
detail behind each line.

**Branch** `pond` · **PR** [#11](https://github.com/PowerPlane/insert-coin/pull/11)
· **Tests** 90 passing · **Deployed** not yet — needs a Turso database and
the CNAME

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
| **1b** | Port to Vercel | ✅ **done, undeployed** | Contract frozen, routes ported, 90 tests. Deploy is the one step left and it needs credentials. |
| **2** | One real card | ⬜ next | Firmware serial + full NDEF write, `record-card.sh`, import. |
| **3** | The client | ⬜ | Nine screens against the frozen API. The biggest piece. |
| **4** | Admin | ⬜ | `/pondkeeper` — ducks, contacts, cards, CSV. |
| **5** | Keepers | ⬜ | Blow gesture, signed claim, Card setup. Schema is already in. |
| **6** | 繁體中文 | ⬜ | ~80 strings. `lang` negotiation already works. |

---

## What is left of 1b, and it is only this

Everything buildable is built. What remains needs an account and a DNS
record, so it is one sitting with the credentials to hand:

```bash
# 1 · a database
turso db create pond
turso db show pond --url            # → TURSO_URL
turso db tokens create pond         # → TURSO_TOKEN

# 2 · the schema, once
cd pond && TURSO_URL=... TURSO_TOKEN=... npm run db:apply

# 3 · secrets, in Vercel → Settings → Environment Variables (Production)
#     TURSO_URL  TURSO_TOKEN  SESSION_SECRET  ADMIN_PASSWORD  CRON_SECRET
#     SESSION_SECRET: openssl rand -hex 32

# 4 · deploy
npx vercel link                     # creates the project — do this knowingly
npx vercel --prod

# 5 · the domain
#     Vercel → Settings → Domains → ducky.davidyang.work
#     THEN at Cargo: CNAME  ducky → cname.vercel-dns.com
#     Do not touch the apex. Do not add an A record.

# 6 · prove it
curl https://ducky.davidyang.work/api/pond          # → {"ducks":[],"now":…}
TURSO_URL=... TURSO_TOKEN=... npm run db:verify     # → the promise holds
#     then open https://ducky.davidyang.work/?d=1 in a browser
#     it must say "you have a fortune waiting"
```

**Done when** all three pass. Step 6 is the whole phase; the rest is
plumbing.

**The browser check is not decoration.** The 90 local tests call
`pondPage()` directly, so the one link they structurally cannot reach is
Vercel's rewrite layer: whether `/?d=1&c=X` → `/api/shell` keeps the query
string, and whether the `Set-Cookie` survives it. Both curl checks can pass
while `/` silently fails to mint — and a `/` that cannot mint is the failure
that kills every duck at the submit button, which is the single most
important thing in this app.

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
