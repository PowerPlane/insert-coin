# Build plan

Where this actually stands, and the order to build the rest in. Honest about
what is designed versus what runs.

---

## Done

| | |
| --- | --- |
| **Design** | Nine screens, settled and reviewed. `pond/tools/prototype-flow.html`. |
| **Copy** | All 434 words, reviewed and cut by about a third. Generated deck in [COPY.md](COPY.md). |
| **UI rules** | [UI.md](UI.md), with a changelog. Its first audit found six tap-target violations, three of them pre-existing. |
| **Schema** | `pond/schema/0001_init.sql`. Contacts isolated in their own table; `ON DELETE CASCADE` from ducks is load-bearing. |
| **Server logic** | `pond/src/worker/` — sessions, ducks, slugs, bumps, fire, reports. Every high-frequency action is one atomic statement. |
| **Client rendering** | `pond/src/client/` — sprites, flames, water, codec. |
| **Tests** | 42, passing. Contact isolation is enforced by test, not by convention. |
| **Firmware** | `production-pond` env builds. NDEF single-byte patch, `sleep_seconds_t` guard, bounded clear-on-exit. |

## Not done

### 1. Port the server from Cloudflare to Vercel — *half a day*

The logic is written and tested; only the shell changes.

- `src/worker/index.ts` (one `fetch` handler) → `api/*.ts` files.
- D1 bindings → Turso client. **SQL is unchanged** — both are SQLite, and the
  atomic `INSERT … SELECT` patterns depend on SQLite's single writer.
- **Move fire ignition into `GET /api/pond`.** Hobby crons are daily-only and
  a `*/2` expression fails at deploy. This is not a workaround: nobody sees a
  fire that starts while nobody is looking.

### 2. Build the client for real — *the biggest piece*

The prototype is one 400 KB HTML file with everything inlined. The real client
is the same screens against the real API. `src/client/` already holds the
rendering; what is missing is the screen shell, routing and state.

### 3. Admin — *designed, not built*

Three tabs, in the prototype as screen 09. Ducks (hide/show), Contacts (reply,
postcard state), Cards (keepers). Plus CSV export.

### 4. Card keepers — *designed, not built*

See the artifact. Needs `card_epochs`, the claim counter in firmware, and the
Card setup screen. **Do the one-line fix first regardless:** the duck card
must stop printing the card serial, because it publishes half of what a claim
would be keyed on.

### 5. Traditional Chinese — *designed, not built*

About eighty strings, a CJK system-font stack, a correct `lang` attribute, and
a non-tracked variant of the label style. The fortunes need no translation.

---

## Order

1. Port to Vercel with the existing logic; deploy something that answers.
2. DNS at Cargo; confirm the certificate.
3. Build the client screens against it.
4. Provision two cards and tap them for real.
5. Admin.
6. Keepers, then Chinese.

## Open questions

Listed in the handover — hosting and platform are settled, the rest are
product calls that do not block starting.
