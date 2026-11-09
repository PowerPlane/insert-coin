# Ducky Card Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `insert-coin` into `ducky-card` (one card project: hardware, firmware, shared pond) and seed `ducky-card-spencer-collab` (same card, personal pond).

**Architecture:** Path moves with `git mv` so history follows the files; the shared pond comes back by checking out `pond/` from `d939f87`, which is exactly what production already runs. Spencer's repo is `main` at `8e1ab56` plus the same layout commits, cherry-picked.

**Tech Stack:** Git, PlatformIO (megaTinyCore, ATtiny1616), C99 host tests, Node 22 + Vitest + TypeScript (pond), Vercel, Turso.

**Spec:** `docs/superpowers/specs/2026-11-09-ducky-card-repo-split-design.md`

## Global Constraints

- Work on branch `claude/optimistic-albattani-yq43lf`; PR is PowerPlane/insert-coin#15.
- Shared pond source of truth: commit `d939f87`. Personal pond source: commit `8e1ab56`.
- Spencer's repo: `PowerPlane/ducky-card-spencer-collab`, public.
- No firmware logic or NFC host changes in this plan; `NDEF_URL_PREFIX` stays `"ducky.davidyang.work/?d="` in both repos until David's local firmware session.
- `docs/pond/history/` is a historical record: leave its old paths alone.
- No em dashes in new prose (David's style rule).
- Baseline before any change: native test `111 checks, 0 failures`; `cd pond && npx vitest run` gives 27 files, 483 tests passing.

## Review Focus

1. **David's ignored local files stay at old paths after `git pull`.** `secrets.h` and `cards.csv` are untracked, so `git mv` does not move them; the next build would fail with a missing header. Expect a clear message telling him where to move them (Task 3, guard in `build-hex.sh`) plus the checklist step (Task 7).
2. **Vercel production branch still points at the deleted `backup/shared-pond`.** A merge to `main` would then deploy nothing to production. Expect the checklist to set it to `main` before merging (Task 7).
3. **PlatformIO library discovery after deleting `lib_extra_dirs`.** `firmware/lib/card-identity` must still be found and `test_card_identity.c` must still be excluded from the AVR build. Expect the same flash size as before (Task 3, David's local build).
4. **Restoring the shared pond silently drops the flasher.** Expect `git diff d939f87 -- pond` to be empty and the flasher tests to pass (Task 2).
5. **Spencer's cards flashed before his host exists** would point at David's pond and fail signature checks. Expect his README and `COLLABS.md` to say "do not flash until the host is set" (Tasks 5, 6).

---

### Task 1: Safety tags

**Files:** none (git refs only)

- [ ] **Step 1: Create tags**

```bash
git tag -a shared-pond-final d939f87 -m "Shared pond + web flasher, as deployed to ducky.davidyang.work"
git tag -a personal-pond-final 8e1ab56 -m "Personal pond (Spencer) + web flasher, main before the split"
```

- [ ] **Step 2: Board rev tag** (spec: board revs are marked by tag): `git tag -a hw-0.2 8e1ab56 -m "Ducky business card, KiCad rev 0-2"`.
- [ ] **Step 3: Verify** `git show --no-patch shared-pond-final personal-pond-final hw-0.2` prints all three.
- [ ] **Step 4: Push tags** only with David's go-ahead: `git push origin shared-pond-final personal-pond-final hw-0.2`.

### Task 2: Restore the shared pond

**Files:**
- Restore from `d939f87`: `pond/`, `docs/pond/HOSTING.md`
- Delete: `pond/schema/0003_personal_pond.sql`, `internal-docs/2026-08-27-personal-pond-and-internet-sculptures.md`

- [ ] **Step 1: List files added after `d939f87`** with `git diff --name-status --diff-filter=A d939f87 8e1ab56 -- pond docs internal-docs`. Expected: exactly the two files listed under Delete.
- [ ] **Step 2: Restore and delete**

```bash
git checkout d939f87 -- pond docs/pond/HOSTING.md
git rm pond/schema/0003_personal_pond.sql internal-docs/2026-08-27-personal-pond-and-internet-sculptures.md
```

- [ ] **Step 3: Verify identical to production:** `git diff d939f87 -- pond docs/pond internal-docs` prints nothing.
- [ ] **Step 4: Run** `cd pond && npm ci && npm run verify`. Expected: typecheck clean, client builds, all tests pass (flasher tests included).
- [ ] **Step 5: Commit** `git commit -m "Bring the shared pond back to main, matching what production serves"`

### Task 3: One card, one repo: flatten the layout

**Files (moves):**
- `variants/business-card-v1/hardware/` to `hardware/`
- `variants/business-card-v1/firmware/` to `firmware/`
- `variants/business-card-v1/enclosure/` to `enclosure/`
- `variants/business-card-v1/README.md` to `docs/board.md`
- `shared/firmware/card-identity/` to `firmware/lib/card-identity/`
- `shared/tools/build-hex.sh` and `shared/tools/README.md` to `tools/`
- Delete: `shared/firmware/README.md`, `shared/kicad/{symbols,footprints,3d}/.gitkeep`

**Files (reference updates), from `git grep` on 2026-11-09:**
- `firmware/platformio.ini:108-112`: delete `lib_extra_dirs = ../../../shared/firmware`; rewrite the comment to say the library lives in `lib/card-identity/`, PlatformIO's default library folder.
- `tools/build-hex.sh:5-6,22`: usage lines say `tools/build-hex.sh`; `FW="$HERE/../firmware"`.
- `pond/test/card-identity.test.ts:41,76,215` and `pond/test/flasher-target.test.ts:13`: `join(__dirname, "..", "..", "firmware", ...)` with `lib/card-identity/` for the two identity files.
- Comments naming old paths: `firmware/*/src/pins.h`, `firmware/production-pond/src/{config.h,main.cpp,provision.h,secrets.h.example}`, `pond/src/card/identity.ts`, `pond/src/flasher/{digest.ts,target.ts}`, `firmware/lib/card-identity/{spec-header.json.part,card-identity.json}` ("Regenerate with: firmware/lib/card-identity/regenerate.sh").
- Docs: `firmware/**/README.md` (`cd ducky-card/firmware`), `docs/flasher/README.md`, `docs/nfc-ducky/README.md`, `docs/pond/{PROVISIONING,README}.md`, `pond/README.md`, `docs/design-notes.md:3`.
- `.gitignore:70`: `variants/business-card-v1/cards.csv` becomes `/cards.csv`.

**Interfaces:**
- Produces: the paths above, used by Tasks 5 and 6. The commit from this task is cherry-picked in Task 6, so it must touch only moves and path text, nothing pond-specific.

- [ ] **Step 1: Move** with `git mv` for each line in the moves list; `git rm` the deletions.
- [ ] **Step 2: Run** `cd pond && npx vitest run test/card-identity.test.ts test/flasher-target.test.ts`. Expected: FAIL with `ENOENT` on the old paths.
- [ ] **Step 3: Update the four test paths**, rerun Step 2's command. Expected: PASS.
- [ ] **Step 4: Update `platformio.ini`, `build-hex.sh`, `.gitignore`, comments and docs** from the reference list.
- [ ] **Step 5: Add a stranded-secret guard** to `tools/build-hex.sh`, before the existing placeholder-key check: if `"$HERE/../variants/business-card-v1/firmware/production-pond/src/secrets.h"` exists and `"$FW/production-pond/src/secrets.h"` does not, print `secrets.h is still at the old path. Move it: mv variants/business-card-v1/firmware/production-pond/src/secrets.h firmware/production-pond/src/secrets.h` and exit 1.
- [ ] **Step 6: Test the guard** in a scratch copy: create the old-path file, run `bash tools/build-hex.sh`, expect exit 1 and the move command printed; delete it, expect the guard to stay silent.
- [ ] **Step 7: Native test from the new path**

```bash
cd firmware/lib/card-identity
cc -std=c99 -Wall -Wextra -Werror -o "$TMPDIR/ci" card_identity.c test_card_identity.c && "$TMPDIR/ci"
```

Expected: `111 checks, 0 failures`.

- [ ] **Step 8: No stale paths:** `git grep -nE "variants/|shared/(firmware|tools|kicad)|lib_extra_dirs|insert-coin/(shared|variants)" -- ':!docs/superpowers' ':!docs/pond/history'` prints nothing.
- [ ] **Step 9: Run** `cd pond && npm run verify`. Expected: all pass.
- [ ] **Step 10: Firmware build.** Try `pip install platformio && cd firmware && cp production-pond/src/secrets.h.example production-pond/src/secrets.h && pio run -e production-pond`, then delete the copied `secrets.h`. If the toolchain download is blocked, mark this step for David's local check and record the flash size he gets against the size from `main`.
- [ ] **Step 11: Commit** `git commit -m "One card, one repo: hardware, firmware and tools at the top level"`

### Task 4: Untrack generated and per-user files

**Files:**
- Untrack: `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`, `pond/audit-out.txt`, `hardware/Insert-Coin-Business-Card.kicad_prl`
- Modify: `.gitignore` (add `/node_modules/`, `*.kicad_prl`, `pond/audit-out.txt`)

- [ ] **Step 1:** `git rm --cached` the three files; add the three ignore lines under matching sections.
- [ ] **Step 2: Verify** `git status --short` shows the three as deleted from the index and `git check-ignore -v` matches each.
- [ ] **Step 3: Commit** `git commit -m "Stop tracking test caches, an audit dump and KiCad view state"`

### Task 5: Ducky Card README and collab guide

**Files:**
- Rewrite: `README.md`
- Create: `COLLABS.md`
- Modify: `docs/board.md` (title `# The board`, drop the variant framing)

README sections, in order: what the card is (from the old README tagline and `docs/board.md`); layout tree from the spec's "Target layout"; build and flash (`firmware/README.md`, `tools/build-hex.sh`, `/flash`); deploy (`docs/pond/HOSTING.md`); collabs (one line linking `COLLABS.md`); datasheets for ATtiny1616 and ST25DV04K.

`COLLABS.md` steps, in order:
1. GitHub "Use this template" on `PowerPlane/ducky-card`; name `ducky-card-<collab>`.
2. Record the starting commit in the new README: "Started from ducky-card at `<sha>`."
3. Pick the pond host first. Change it in the five pinned places from the spec section "Spencer's repo: firmware change"; both test suites must pass.
4. New Vercel project, root directory `pond`, env vars `TURSO_URL`, `TURSO_TOKEN`, `CARD_SECRET`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`, all with new values (`openssl rand -hex 16` for `CARD_SECRET`, which must match `secrets.h`).
5. New Turso database, then `cd pond && npm run db:apply`.
6. Do not flash cards until steps 3 to 5 are done.
7. Pulling a fix from ducky-card: `git remote add upstream https://github.com/PowerPlane/ducky-card.git && git fetch upstream && git diff <start-sha> upstream/main -- firmware/lib pond/src/flasher pond/src/card`.

- [ ] **Step 1: Write both files.**
- [ ] **Step 2: Link check:** `for f in README.md COLLABS.md docs/board.md; do grep -oE '\]\([^)#:]+' "$f" | cut -c3- | while read -r t; do test -e "$(dirname "$f")/$t" || echo "$f -> $t missing"; done; done` prints nothing.
- [ ] **Step 3: Verify** `grep -c "—" README.md COLLABS.md docs/board.md` prints `0` for each.
- [ ] **Step 4: Commit** `git commit -m "Ducky Card: a README for one card, and how a collab starts"`
- [ ] **Step 5: Push** the branch and update PR #15's title and body to cover Tasks 2 to 5.

### Task 6: Seed `ducky-card-spencer-collab`

**Blocked on:** David creating the empty public repo (Task 7, step 7). Then `add_repo` with push access.

**Interfaces:**
- Consumes: the commits from Task 3 and Task 4 (`<flatten-sha>`, `<untrack-sha>`).

- [ ] **Step 1:** `git switch -c spencer-seed 8e1ab56 && git cherry-pick <flatten-sha> <untrack-sha>`. Expected: applies cleanly (Task 3 touches no personal-pond files).
- [ ] **Step 2: Write `README.md`** for "Ducky Card Spencer Collab": started from `insert-coin` at `8e1ab56`; personal pond, see `internal-docs/2026-08-27-personal-pond-and-internet-sculptures.md`; pond host pending, cards must not be flashed until it is set; pages in `docs/pond/` about keepers and bumps describe the shared pond and are out of date here. Copy `COLLABS.md` step 7 for pulling fixes.
- [ ] **Step 3: Run** the native test and `cd pond && npm ci && npm run verify`. Expected: all pass.
- [ ] **Step 4: Commit** and `git push https://github.com/PowerPlane/ducky-card-spencer-collab.git spencer-seed:main`.
- [ ] **Step 5: Verify** the new repo's `main` log shows Spencer's three commits with his authorship.

### Task 7: David's checklist (GitHub, Vercel, Turso, local machine)

Not code. Claude posts this list in the PR body; David ticks it off.

1. **DB check:** `turso db shell <pond-db> "SELECT COUNT(*) FROM ducks WHERE visitor IS NOT NULL;"`. "no such column" or `0` means nothing to move. Anything else: stop and tell Claude.
2. **Vercel:** project `pond`, Settings, Git, Production Branch: `main`.
3. **Merge PR #15.** Then confirm a production deploy of `main` is Ready, `ducky.davidyang.work` and `/flash` load, and a tap from a real card lands on the shared pond.
4. **Local machine, after `git pull`:**
   ```bash
   mv variants/business-card-v1/firmware/production-pond/src/secrets.h firmware/production-pond/src/secrets.h
   mv variants/business-card-v1/cards.csv cards.csv
   rm -rf variants shared
   ```
   Then `cd firmware && pio run -e production-pond` and compare flash size with the last build from `main`.
5. **GitHub:** rename `insert-coin` to `ducky-card`; tick "Template repository"; locally `git remote set-url origin https://github.com/PowerPlane/ducky-card.git`; confirm Vercel still shows the repo linked.
6. Push the safety tags (Task 1, step 4) if not done.
7. **GitHub:** create empty public repo `PowerPlane/ducky-card-spencer-collab` (no README), add Spencer as collaborator, tell Claude (unblocks Task 6).
8. **After Task 6:** new Vercel project from that repo, root `pond`; new Turso DB plus `npm run db:apply`; six env vars with new values.
9. **Later, local Claude Code:** pick Spencer's host and make the firmware change.
