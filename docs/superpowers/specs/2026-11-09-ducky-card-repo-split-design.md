# Ducky Card repo split: design

Date: 2026-11-09
Status: approved by David on 2026-11-09

## Goal

One repo per card project. Each repo holds the hardware, the firmware and the
pond web app for one card, and can be built, flashed and deployed on its own.

- `ducky-card` is David's card with the **shared pond**.
- `ducky-card-spencer-collab` ("Ducky Card Spencer Collab") is the collab with
  Spencer, with the **personal pond**.
- Future collabs start as a copy of `ducky-card` (GitHub "Use this template").

Success looks like:

1. Each repo builds its own `.hex`, runs its own tests and deploys its own pond.
2. A card built from one repo is rejected by the other repo's pond.
3. Starting a new collab takes a template click and a short checklist, not a
   fork that keeps asking to sync.

## Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Unit of a repo | One card project (hardware + firmware + pond) | Simplest model for collaborators; a collab can change any layer without affecting the others |
| Who runs the ponds | David deploys both; Spencer contributes to the personal pond | From the conversation |
| `insert-coin` | Renamed to `ducky-card`, not recreated | Keeps history, PRs, issues and the Vercel link; GitHub redirects the old URL |
| Spencer's repo | New repo, seeded by pushing current `main` **with history** | Keeps Spencer's authorship on his three commits |
| Future collabs | GitHub template copy of `ducky-card` | Clean history, no fork link, no sync prompts |
| Shared code across repos | Copied, not linked | Accepted trade-off; see "Trade-offs" |

## Current state (verified in the repo)

- `main` (8e1ab56) is the **personal pond** (PR #13, Spencer) plus the **web
  flasher** (PR #14).
- Commit `d939f87` is exactly **shared pond + web flasher**. Its parent is
  `67f4796`, the last shared-pond commit. No branch points at it today.
- The personal pond changes 20 files against `d939f87`, all under `pond/`,
  `docs/pond/HOSTING.md` and `internal-docs/`. It adds migration
  `pond/schema/0003_personal_pond.sql` (`ducks.visitor` column + index).
- Hardware and firmware are identical for both ponds. A card is tied to a
  pond by two things:
  - the NFC URL host, `NDEF_URL_PREFIX` in
    `shared/firmware/card-identity/ndef_record.h:35`
    (`"ducky.davidyang.work/?d="`)
  - `CARD_SECRET`: `production-pond/src/secrets.h` on the card (gitignored)
    must equal the pond server's env var.
- The host is also pinned in tests and the spec file: `config.h`
  (`NDEF_DIGIT_OFFSET = 0x0023`), `card-identity.json` (URL template),
  `pond/test/card-identity.test.ts:231-233`, `test_card_identity.c:152`.
- Two generated files are tracked by mistake:
  `node_modules/.vite/vitest/.../results.json` and `pond/audit-out.txt`.

## Target layout (same in every card repo)

The `variants/` level goes away: one repo is one card, so there is nothing to
choose between.

```
ducky-card/
├── README.md              what the card is, how to build, flash, deploy
├── COLLABS.md             how to start a collab repo from this one
├── hardware/              KiCad project + production/ fab outputs
├── firmware/              PlatformIO project (bringup, production,
│   │                      production-nfc, production-pond envs)
│   └── lib/card-identity/ was shared/firmware/card-identity
├── enclosure/
├── tools/build-hex.sh     was shared/tools/build-hex.sh
├── pond/                  web app (Vercel), including the /flash page
└── docs/
```

Notes:

- `firmware/lib/` is PlatformIO's default library folder, so
  `lib_extra_dirs = ../../../shared/firmware` is deleted, not rewritten.
- The empty `shared/kicad/` placeholders are deleted. If a custom KiCad library
  appears, it goes in `hardware/lib/` with a `${KIPRJMOD}` relative path.
- Board revisions stay in `hardware/`, marked by the KiCad title block rev
  and a git tag (`hw-0.2`). A new rev of the same card does not need a new
  folder; old firmware stays buildable from its tag.
- `.kicad_prl` (per-user view state) is untracked and added to `.gitignore`.

Path references to update (from `grep business-card-v1`): `build-hex.sh`,
`pond/src/flasher/target.ts`, `pond/test/card-identity.test.ts`,
`pond/test/flasher-target.test.ts`, `platformio.ini`, the firmware
`main.cpp`/`pins.h` header comments, and the READMEs under `docs/`.

## What each repo owns

| | `ducky-card` | `ducky-card-spencer-collab` |
| --- | --- | --- |
| Pond | Shared (restored from `d939f87`) | Personal (current `main`) |
| NFC host | `ducky.davidyang.work` | Its Vercel `*.vercel.app` domain for now (see Decisions) |
| `CARD_SECRET` | Existing value | New value, generated for this repo |
| Vercel project | Existing one | New |
| Database | Existing Turso DB | New Turso DB |
| `cards.csv` | Existing cards | Spencer's cards only |
| Migrations | `0001`, `0002` | `0001`, `0002`, `0003` |
| `internal-docs/2026-08-27-personal-pond-...md` | Removed | Kept |

## Spencer's repo: firmware change

Change the host in one place and update every place that pins it:

1. `firmware/lib/card-identity/ndef_record.h`: `NDEF_URL_PREFIX`.
2. `firmware/production-pond/src/config.h`: `NDEF_DIGIT_OFFSET` to the new
   derived value.
3. `card-identity.json`: the URL `template` line.
4. `test_card_identity.c` and `pond/test/card-identity.test.ts`: the expected
   prefix and offset.

Both test suites fail if any of these disagree, so a missed spot cannot ship.
A longer host adds roughly 6 ms of first-boot EEPROM write per extra byte
(`NDEF_EEPROM_WRITE_MS`); fine for a short host, worth a bench check if the
host grows past ~10 bytes.

## Database split

Unknown today: whether the personal pond was deployed to
`ducky.davidyang.work`, so whether the live Turso DB has migration `0003` and
rows with `visitor` set. The shared pond code does not know the `visitor`
column, so any personal rows would show up in its public lookups.

Before the shared pond is deployed again:

1. Run `SELECT COUNT(*) FROM ducks WHERE visitor IS NOT NULL;` on the live DB.
2. If 0: nothing to move. The unused column stays; it is harmless.
3. If more than 0: export those rows into Spencer's new DB, check the counts
   match, then set `hidden = 1` on them in the shared DB. Hiding is
   reversible; deleting is not, so nothing is deleted.

## Physical cards

- Cards already flashed with `production-pond` carry the
  `ducky.davidyang.work` URL and David's `CARD_SECRET`. They stay with
  `ducky-card`.
- Cards for Spencer's pond are built from his repo and flashed through his
  pond's `/flash` page (each pond serves its own flasher).

## Steps and who does them

| # | Step | Who |
| --- | --- | --- |
| 0 | Safety tags: `shared-pond-final` at `d939f87`, `personal-pond-final` at `8e1ab56` | Claude |
| 1 | Create empty public repo `ducky-card-spencer-collab`, add Spencer as collaborator | David (GitHub UI) |
| 2 | Push current `main` history to it; flatten layout; README notes "started from insert-coin at 8e1ab56" | Claude, once the repo is added to the session |
| 2b | Firmware NFC host change (section "Spencer's repo: firmware change") | David, in a local Claude Code session after the move, once the host is known |
| 3 | In this repo, on the working branch: restore `pond/` and `docs/pond/HOSTING.md` from `d939f87`, remove the personal-pond doc, flatten layout, delete tracked junk, rename README to Ducky Card, write `COLLABS.md` | Claude, as a draft PR |
| 4 | Merge the PR; rename repo to `ducky-card`; tick "Template repository"; confirm Vercel is still linked; update local remotes | David |
| 5 | Run the DB check above and move rows if needed | David, with Claude drafting the SQL |
| 6 | New Vercel project + Turso DB + `CARD_SECRET` + DNS for Spencer's pond | David |

Step 1 to 2 can run before or after step 3; history is preserved either way.

## Testing

In each repo, before its PR is merged:

- `cd pond && npm test` (Vitest; includes card-identity, flasher and
  deploy-shape tests).
- Native card-identity test: compile and run `test_card_identity.c` with `cc`.
- `pio run -e production-pond` builds. If PlatformIO is not installable in the
  cloud session, David runs this locally and the PR says so.
- `grep -r "variants/\|shared/firmware\|shared/tools"` returns nothing.

After deploy (David): tap a real card on each pond and check it lands on the
right one; tap a card from one pond on the other's URL by editing the host and
check it is rejected.

## Trade-offs

- **Copied code drifts.** `card-identity`, the UPDI flasher and the signing
  code exist once per repo. A security fix is applied to each repo by hand.
  Fine for 2 or 3 collabs. `COLLABS.md` records the commit each collab started
  from so a diff against `ducky-card` is one command. If this becomes painful,
  extract those parts into a package then, not now.
- **Hardware is copied too.** If David revises the board, Spencer's repo keeps
  rev 0-2 until someone copies the new KiCad files over. This is intended: a
  collab's card does not change under it.

## Decisions from review (2026-11-09)

1. **Spencer's pond host: pending.** Host it on Vercel under the project's
   default `*.vercel.app` domain for now. The host is baked into every card's
   NFC tag, so moving to a custom domain later means reflashing Spencer's
   cards (possible through the `/flash` page, but every card). Pick a short
   Vercel project name: each extra character is one more byte written at
   first boot. Do not flash Spencer's cards until the host is final.
2. **Repo name:** `ducky-card-spencer-collab` ("Ducky Card Spencer Collab").
3. **Visibility:** both public. Git history was scanned on 2026-11-09: only
   `secrets.h.example` (all-zero template) and a test fixture string were ever
   committed; no real `CARD_SECRET`, tokens or database URLs. `secrets.h`,
   `cards.csv` and `.env*.local` stay gitignored.
4. **Firmware edits** happen in David's local Claude Code session after the
   repo move, where PlatformIO and the programmer are available.

## Out of scope

- Pond recovery credentials and signed play ids (Spencer's doc, future work).
- Extracting shared code into a package.
- Rewriting `docs/pond/` in Spencer's repo; several pages (KEEPER, bumps)
  describe shared-pond features and will be stale there. Flagged in his
  README.
