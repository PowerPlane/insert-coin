# The pond — hosting

`ducky.davidyang.work` runs on Vercel. `davidyang.work` stays exactly where it
is, on Cargo — nothing about the apex changes, and no nameservers move.

That last point is why this is Vercel and not Cloudflare Workers: a Workers
custom domain needs the whole zone on Cloudflare, which would have meant
moving the apex off Cargo. Vercel takes a plain CNAME from a DNS host it does
not control, so the subdomain is the only thing that moves.

---

## 1. DNS at Cargo

One record. The same shape as `invoice.davidyang.work`.

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `ducky` | `cname.vercel-dns.com` |

Add the domain in Vercel first (Project → Settings → Domains →
`ducky.davidyang.work`), then add the record at Cargo. Vercel issues the
certificate automatically once it resolves; propagation is usually minutes.

**Do not** add an A record, and do not touch the apex or `www`.

---

## 2. Plan: Hobby, and why it is legitimate

The card is David's personal project, not something sold, so Vercel's
[fair-use rule](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
restricting Hobby to non-commercial use is satisfied. **If BY-002 ever
becomes a product people buy, this needs to move to Pro ($20/mo)** — the
companion site for a sold product is commercial use.

Included on Hobby, against what this actually needs:

| | Hobby gives | The pond needs |
| --- | --- | --- |
| Edge requests | 1,000,000 / mo | hundreds |
| Function invocations | 1,000,000 / mo | hundreds |
| Domains per project | 50 | 1 |
| Function duration | 300 s | milliseconds |

### The one real constraint: crons

Hobby cron jobs **run once per day**, and a more frequent expression
**fails at deploy time** — it is not a silent degradation. So the pond has no
minute-scale scheduled work:

- **Fire ignition happens on read.** `GET /api/pond` runs the ignition as one
  atomic `INSERT … SELECT` in the same request. Nobody sees a fire that starts
  while nobody is looking, so a timer was never doing real work.
- **Fires go out by arithmetic.** `burning` is `now - lit_at < 90s`, computed,
  not stored — so nothing has to run to extinguish one.
- **The daily cron** (`0 4 * * *`) only sweeps expired sessions, nonces and
  spent rate-limit windows, which genuinely does not care about latency. It
  sits behind a `CRON_SECRET` bearer check: without one it is a public
  endpoint that deletes rows, and its path is in `vercel.json` for anyone to
  read.

---

## 3. Database

Vercel Hobby includes Blob storage only, so the database is external.

**Turso** (libSQL), because it is SQLite: the schema in `pond/schema/` and
every query in `pond/src/worker/` port across unchanged, including the atomic
`INSERT … SELECT` patterns that depend on SQLite's single writer. A Postgres
host would mean rewriting those, and they are the load-bearing part of the
concurrency design.

Confirm Turso's current free-tier limits when wiring it up rather than
trusting a number written here.

**Apply the schema with `npm run db:apply`, not a shell pipeline.** The
schema contains a trigger, and a trigger body is `BEGIN … ; … ; END` — a
`split on semicolon` cuts the deletion promise into fragments that fail to
parse, and the failure mode is a database that looks fine until someone asks
to be removed. `src/db/schema.ts` splits it properly and has a test.

**Then run `npm run db:verify` once.** It writes a duck with a contact and a
live session, deletes the duck, and checks the contact is gone — against the
real database, which is the only place that question can be answered. Phase
1a ended with exactly this unresolved; the script is how it gets resolved.

---

## 4. Secrets

Set in Vercel → Settings → Environment Variables, Production scope:

| Name | What it is |
| --- | --- |
| `SESSION_SECRET` | HMAC key for short-lived session cookies and card claims. 32 random bytes. |
| `ADMIN_PASSWORD` | The actual auth on `/pondkeeper`. The path is obscurity, this is the lock. |
| `TURSO_URL` | libSQL connection URL. |
| `TURSO_TOKEN` | libSQL auth token. |
| `CRON_SECRET` | Vercel sends this as a bearer token on cron invocations; reject anything else. |

None of these belong in the repo, and none are needed to run the prototype.

---

## 5. What the firmware writes

The NDEF record is unchanged by any of this:

```
https://ducky.davidyang.work/?d=0&c=XXXXXX
                              ^
                              0x0023, the one patched byte
```

`&c=` is appended after the digit precisely so the patch offset never moves.
See `docs/pond/PROVISIONING.md`.

---

## 6. Deploy

```bash
cd pond
npx vercel link          # once — this creates the project on the account
npx vercel --prod
```

Cron jobs only become active on a production deployment.

**There is no build step and no `public/index.html`.** `public/` is served
verbatim by the CDN, and the HTML for `/`, `/d/<slug>` and `/e/<key>` is
rendered by functions. That is not a stylistic choice: the CDN answers a
static file before any function runs, so an index.html would mean `/` could
never exchange a tap for a session — and that exchange gets exactly one
chance. `public/` is therefore committed, not generated, and not gitignored.

### app.js and app.css are `no-cache`, and that is deliberate

They are the application. They change on every deploy and their names never
do, so a long `max-age` means a deploy is invisible for that long — to a
returning visitor, and to whoever is trying to check the deploy worked.

This was found the hard way: `max-age=3600` was set on `.js`, a fix was
deployed and verified with `curl`, and the browser kept running the old
bundle for another fifty minutes. Two subsequent "fixes" were written for
symptoms that had already been fixed.

`no-cache` does not mean "do not cache" — it means revalidate first. An
unchanged file costs a 304, not a download.

**Note for the next time this bites:** a response already stored under the
OLD policy stays fresh until it expires, whatever the new header says. To
check a deploy immediately, use a private window or a fresh browser profile.

### Checking it worked

```bash
curl https://ducky.davidyang.work/api/pond     # → {"ducks":[],"now":…}
npm run db:verify                              # → the promise holds
```

Then open **`/?d=1`** in a browser. It must say *"you have a fortune
waiting"*. That sentence is the only proof that the rewrite `/` →
`/api/shell` preserved the query string and let the `Set-Cookie` through —
which no test can check from outside a deployment, and which is the one
failure that would kill every duck at the submit button.

A plain `/` showing a duck count proves the rest: the database is reachable
and the API is answering.
