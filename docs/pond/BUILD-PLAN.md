# The Pond — build plan

Every part that has to exist for `davidyang.work/p` to work, what state each
is in, and the order to build them. Companion to `DESIGN.md` (why) and
`FLOW.md` (what the screens do).

**Mobile-first is not a preference here, it's the only context.** Every
visitor arrives by tapping a card with a phone. Desktop is a courtesy.

---

## 1 · Firmware — `production-pond`

New PlatformIO environment. **`production` and `production-nfc` are never
touched**; any card already flashed keeps working exactly as it does today.

| Item | State | Notes |
| --- | --- | --- |
| `production-pond/src/config.h` | to build | New URL, new digit offset, 300 s expiry |
| `production-pond/src/ndef.cpp` | to build | Adds I²C write retry — the current version ignores a failed write |
| `production-pond/src/main.cpp` | to build | Same show, new post-reveal patch |
| Shared drivers (`leds`, `anim`, `mic`, `pwm`, `rng`, `sleepy`, `flame`) | copy | Unchanged from `production-nfc` |
| `platformio.ini` | to edit | Add one `[env:production-pond]` block |

**The one constant that matters.** `ndef_patch_fortune()` writes to a fixed
absolute offset, so the digit's position depends only on the bytes *before*
it. `https://` is a 1-byte NDEF prefix code, so:

```
0x000B  "davidyang.work/p?d="   19 bytes
0x001E  the digit                ← NDEF_DIGIT_OFFSET
0x001F  "&c=XXXXXX"              per-card, varies, moves nothing
```

Every card runs identical firmware. Only the NDEF text written once by a
phone tag-writer differs.

---

## 2 · Database — Cloudflare D1

| Item | State | Notes |
| --- | --- | --- |
| `schema/0001_init.sql` | to build | Tables, indexes, constraints |
| `ducks` | to build | Public. Everything drawn in the pond. |
| `contacts` | to build | **Private. No public query ever joins it.** |
| `cards` | to build | One row per physical card, for rate limits and analytics |
| `nonces` | to build | Optional; enforces one duck per coin insert |
| `waves`, `rescues` | to build | Idempotent per person, not per tap |
| `says` | to build | Speech bubbles, 10-minute cooldown |

Storage per duck is ~310 bytes because the base sprite is *code, not data* —
`fortune` is one integer and the artwork ships with the site. Improve the
duck art later and every duck already in the pond improves with it.

---

## 3 · Worker — the API

| Route | Method | Purpose |
| --- | --- | --- |
| `/p` | GET | The app. Reads `?d=`/`?c=`, mints the session, then never re-checks. |
| `/p/api/pond` | GET | Public duck list. Structurally cannot return a contact. |
| `/p/api/duck` | POST | Release a duck. Requires a valid session. |
| `/p/api/duck/:id` | PATCH/DELETE | Edit or remove. Requires the private key. |
| `/p/api/wave` | POST | Idempotent per visitor |
| `/p/api/fire/:id/out` | POST | Extinguish. Idempotent; first writer wins. |
| `/p/api/say` | POST | 10-minute cooldown, server-enforced |
| `/p/d/:key` | GET | The private link — your duck, later |
| `/p/admin` | GET | Secret path + password. Hide/unhide, contacts, CSV export. |

Cross-cutting: signed-cookie sessions, per-card and per-IP rate limits,
input validation on every field, and a test that asserts the public pond
response can never contain a contact.

---

## 4 · Client — the pond itself

| Item | State | Notes |
| --- | --- | --- |
| `sprites.ts` | generated | Four 24×24 flat ducks, derived from `docs/nfc-ducky/assets/*.svg` |
| `stickers.ts` | generated | 32 accessories with slots |
| `pond.ts` | to build | Canvas engine — dithered water, ripples, stop-motion tick |
| `sparkle.ts` | to build | Ported from byproductlab.com with its constants intact |
| `studio.ts` | to build | Colour, stickers, freehand paint |
| `codec.ts` | to build | Paint layer ↔ base64, 4 bits/px |
| `a11y.ts` | to build | The hidden per-duck button list — canvas alone is unreachable |

---

## 5 · Tools and docs

| Item | State | Notes |
| --- | --- | --- |
| `tools/gen-sprites.py` | to build | Re-derives sprite data from the SVGs; art stays single-source |
| `tools/provision-card.md` | to build | Writing a card's NDEF, and the ID scheme |
| `docs/pond/DESIGN.md` | to build | Why it looks and behaves this way |
| `docs/pond/FLOW.md` | to build | The ten screens |
| `docs/pond/EDGE-CASES.md` | to build | Everything enumerated, with the handling |
| `docs/pond/SECURITY.md` | to build | Threat model, honest about what is and isn't defended |
| Root `README.md` | to edit | Point at the pond |

---

## Build order

1. **Schema** — everything else is shaped by it.
2. **Worker**, with the session model and the contact isolation test first.
3. **Sprite generation**, so the client has real art from the start.
4. **Client**: pond → studio → flow.
5. **Firmware**, last, because it's the only part that can't be revised after
   a card is handed out.

## Deliberately not in v1

- Real-time presence. Polling every 20 s is enough; a Durable Object only
  earns its place if people should see each other's ducks arrive live.
- Accounts. The private link is the only credential, on purpose.
- Fire spreading. Decided against — funny once, then a chore.
