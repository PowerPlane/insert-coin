# Hosting the pond at ducky.davidyang.work

The short version: **you have to move `davidyang.work`'s DNS to Cloudflare.**
The Cargo site keeps working exactly as it does now — it just gets its DNS
answered by Cloudflare instead of by Cargo.

You have already done this once, for `byproductlab.com`. Same procedure.

---

## Why a subdomain and not `davidyang.work/p`

A Cloudflare Worker can only claim a path if Cloudflare is answering DNS for
that whole domain. Right now:

```
davidyang.work        →  ns1.cargo.site, ns2.cargo.site   (Cargo)
byproductlab.com      →  ivan/iris.ns.cloudflare.com      (Cloudflare)
```

So `davidyang.work/p` is not available until the domain moves. And even
after moving, putting the pond at a *path* means Cloudflare sits in front of
the Cargo site for every request — more moving parts, more ways for the
portfolio to break.

A subdomain is cleaner: `ducky.davidyang.work` is entirely Cloudflare's,
`davidyang.work` is entirely Cargo's, and neither can break the other.

---

## The steps

**1 · Add the zone.** Cloudflare dashboard → Add a site → `davidyang.work`
→ Free plan. Cloudflare scans the existing DNS.

**2 · Check the scan caught everything.** This is the only risky step, so do
it carefully. Compare against what Cargo currently serves:

```bash
dig +short davidyang.work            # 3.215.100.79, 3.234.189.133
dig +short www.davidyang.work
dig +short TXT davidyang.work        # domain verifications
dig +short MX davidyang.work         # email, if any
```

Every record that exists today must exist in Cloudflare before you switch.
**Missing MX records is how people accidentally turn off their email.**

**3 · Set the Cargo records to DNS-only.** Click the orange cloud next to
the apex and `www` records so they go grey. Cargo terminates its own TLS;
proxying through Cloudflare would give you two certificate authorities
arguing about the same hostname.

**4 · Change the nameservers at your registrar** to the two Cloudflare gives
you. Propagation is usually minutes, occasionally a few hours. The Cargo
site stays up throughout — you are changing who *answers* for the name, not
where it points.

**5 · Deploy the Worker.**

```bash
cd pond
wrangler d1 create pond          # put the id into wrangler.toml
npm run db:remote                # apply the schema
wrangler secret put SESSION_SECRET
wrangler secret put ADMIN_PASSWORD
wrangler deploy
```

`custom_domain = true` makes Cloudflare create the `ducky` DNS record and
issue its certificate. Nothing to add by hand.

**6 · Check both.**

```bash
curl -sI https://davidyang.work        | head -1   # Cargo, unchanged
curl -sI https://ducky.davidyang.work  | head -1   # the pond
```

---

## If you would rather not move the domain

Two alternatives, both worse:

- **`ducky.byproductlab.com`** — works today, zero risk, no DNS change. But
  the card is a *personal* card and the silkscreen says `WWW.DAVIDYANG.WORK`,
  so the URL wouldn't match the object.
- **`pond.pages.dev`** — a free Cloudflare subdomain. Fine for testing,
  wrong on a business card.

---

## What this changes in the firmware

The URL is longer, so **the patched digit moves**:

```
before   https://davidyang.work/p?d=0        digit at 0x001E
after    https://ducky.davidyang.work/?d=0   digit at 0x0023
```

`NDEF_DIGIT_OFFSET` in `production-pond/src/config.h` is already `0x0023`.

The constant and the text a phone writes to the tag are two halves of one
layout — **change them together or the patch lands in the middle of the URL
and corrupts it.** `docs/pond/PROVISIONING.md` has the read-back check; do
it on one card before flashing a batch.

Note there is no `/p` any more: the pond owns the whole subdomain, so the
tag URL is `ducky.davidyang.work/?d=0&c=XXXXXX`.
