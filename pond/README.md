# The Pond

`ducky.davidyang.work` — the web half of the BY-002 Insert Coin card.

Tap the card after a coin insert and you land here holding the duck the
machine dealt you. Decorate it, sign it, leave it in the water with everyone
else's. Ducks live forever.

**Mobile-first is not a preference.** Every visitor arrives by tapping a card
with a phone. Desktop is a courtesy.

---

## Layout

```
pond/
  schema/0001_init.sql     THE FROZEN CONTRACT. Read the comments first.
  api/                     Vercel entry points. Three lines each, on purpose.
    router.ts              everything under /api, via a rewrite
    sweep.ts               the daily cron, behind CRON_SECRET
    shell.ts               /            duck-page.ts  /d/<slug>
    duck-edit.ts           /e/<key>
  src/db/                  the D1-shaped adapter. The whole port lives here.
  src/worker/              the API, knowing nothing about Vercel
    index.ts               handle(req, env) — routes and security headers
    session.ts             tap → ticket. The single most important file.
    ducks.ts               public reads. Must never name `contacts`.
    release.ts             the one write that may. Duck + contact, one batch.
    social.ts              bumps, fires, speech, reports. Atomic SQL only.
    limits.ts              rate limits, because SECURITY.md promised them
    shell.ts / pages.ts    the server-rendered HTML
    util.ts                text cleaning, ids, constant-time compare
  src/client/              the pond itself (canvas)
  test/                    contact isolation is enforced here, not promised
  tools/                   db-apply, db-verify, sprites, the prototypes
  public/                  served verbatim by the CDN. NOT generated, not ignored.
```

## Running it

```bash
npm install
export TURSO_URL=file:local.db    # a real Turso URL works the same way
export SESSION_SECRET=dev-secret
export ADMIN_PASSWORD=dev-admin
npm run db:apply                  # apply the schema
npm run dev                       # vercel dev
```

Then open `http://localhost:3000/?d=1&c=TESTCARD`.

`npm run db:verify` proves, against whatever `TURSO_URL` points at, that
deleting a duck really does take its contact with it. Run it once after the
first deploy: it is the one thing about a hosted database that cannot be
checked from here.

## Tests

```bash
npm test
```

`test/contacts-isolation.test.ts` is the one that matters. It fails the build
if the public read path ever learns the `contacts` table exists. If it starts
failing, the fix is almost never to loosen the test.

## The three decisions worth knowing

**Freshness is checked once.** The card's `?d=` digit is only live for 300
seconds, but decorating takes minutes. `session.ts` exchanges the digit for a
30-minute session on the *first* request and never looks at it again. Check
late and every duck dies on the submit button.

**`?d=` is forgeable.** Anyone can type `/?d=1`. It proves a fortune was
requested, not that a coin was inserted. What actually holds the line is in
`docs/pond/SECURITY.md`, which is written to be honest rather than
reassuring.

**The deletion promise is a trigger, not a cascade.** The contact screen
promises, in writing, that taking your duck out deletes the contact.
`ON DELETE CASCADE` would do that — if foreign keys were being enforced, and
the pragma is per-connection and off by default. So `ducks_before_delete` in
the schema does the deleting instead, and the tests run every deletion twice:
once with foreign keys on, once with them off.

## Related

- `docs/pond/README.md` — **start here.** What the words mean, and which
  document answers which question.
- `docs/pond/CARD-STATES.md` — how a card decides who owns it
- `docs/pond/PROVISIONING.md` — making the cards
- `docs/pond/HOSTING.md` — Vercel, Turso, and the CNAME at Cargo
- `docs/pond/SECURITY.md` — threat model
- `variants/business-card-v1/firmware/production-pond/` — the firmware that
  points a card here
