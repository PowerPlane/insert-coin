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
  schema/0001_init.sql     tables; read the comments before changing them
  src/worker/              the API
    index.ts               routes, security headers, the one-time ?d= exchange
    session.ts             tap → ticket. The single most important file.
    ducks.ts               public reads and writes. Must never name `contacts`.
    social.ts              waves, fires, speech. All atomic SQL, no read-modify-write.
    util.ts                text cleaning, ids, constant-time compare
  src/client/              the pond itself (canvas)
  test/                    contact isolation is enforced here, not promised
  tools/                   sprite generation + the approved prototypes
public/                    built client assets
```

## Running it

```bash
npm install
wrangler d1 create pond           # put the id in wrangler.toml
npm run db:local                  # apply the schema
wrangler secret put SESSION_SECRET
wrangler secret put ADMIN_PASSWORD
npm run dev
```

Then open `http://localhost:8787/p?d=1&c=TESTCARD`.

## Tests

```bash
npm test
```

`test/contacts-isolation.test.ts` is the one that matters. It fails the build
if the public read path ever learns the `contacts` table exists. If it starts
failing, the fix is almost never to loosen the test.

## The two decisions worth knowing

**Freshness is checked once.** The card's `?d=` digit is only live for 300
seconds, but decorating takes minutes. `session.ts` exchanges the digit for a
30-minute session on the *first* request and never looks at it again. Check
late and every duck dies on the submit button.

**`?d=` is forgeable.** Anyone can type `/p?d=1`. It proves a fortune was
requested, not that a coin was inserted. What actually holds the line is in
`docs/pond/SECURITY.md`, which is written to be honest rather than
reassuring.

## Related

- `docs/pond/BUILD-PLAN.md` — every part, and what state it's in
- `docs/pond/SECURITY.md` — threat model
- `variants/business-card-v1/firmware/production-pond/` — the firmware that
  points a card here
