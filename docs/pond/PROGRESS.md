# Progress

The tracker. Tick things off here as they land; `BUILD-PLAN.md` is the
detail behind each line.

**Branch** `pond` · **PR** [#11](https://github.com/PowerPlane/insert-coin/pull/11)
· **Tests** 49 passing · **Deployed** no

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
| **1a** | Turso adapter | ✅ **done** | D1-shaped interface, FK assertion, batch. 7 tests. |
| **1b** | Port to Vercel | ⬜ next | Routes → `api/*.ts`, contract freeze, deploy, CNAME. |
| **2** | One real card | ⬜ | Firmware serial + full NDEF write, `record-card.sh`, import. |
| **3** | The client | ⬜ | Nine screens against the deployed API. The biggest piece. |
| **4** | Admin | ⬜ | `/pondkeeper` — ducks, contacts, cards, CSV. |
| **5** | Keepers | ⬜ | Blow gesture, signed claim, `card_epochs`, Card setup. |
| **6** | 繁體中文 | ⬜ | ~80 strings, font stack, `lang`, untracked labels. |

---

## Phase 1a — done

`pond/src/db/` + `pond/test/foreign-keys.test.ts`.

- D1-shaped interface (`prepare().bind().first()/run()/all()`, `meta.changes`)
  so `src/worker/*.ts` need not change.
- **Foreign keys turned on, read back, and asserted.** Turso defaults them
  *off*, which would make `ON DELETE CASCADE` from ducks to contacts silently
  do nothing — the deletion promise failing with no error. `connect()` refuses
  to return a database that is not enforcing them.
- `batch()` for the multi-statement writes, **proved to roll back** when one
  statement fails.
- `meta.changes` proved to report rows *changed*, not matched — `extinguish()`
  credits a rescue on exactly that.

Verified against real libSQL in memory. **Still unproven:** whether the pragma
survives Turso's HTTP mode on a remote primary. That needs a real database and
is the first thing to check in 1b.

---

## Phase 1b — next, in order

1. `pond/src/db/` wired into the worker in place of `Env.DB` (`types.ts` has
   `D1Database` today).
2. **Freeze the contract** — §2 of the plan. Edit `0001_init.sql` directly;
   nothing is deployed, so there is no migration to write.
   - bumps replace waves, per-pair, cap server-side
   - `card_epochs`, and `epoch_id` on ducks and contacts
   - keeper name + language on the epoch
   - contact scope column
   - report reason + note
   - card serial **out** of the duck payload
3. `api/*.ts` from `src/worker/index.ts`; `api/sweep.ts` for the daily cron.
4. Fire ignition into `GET /api/pond`.
5. Rate limits — documented in `SECURITY.md`, not implemented.
6. `package.json` scripts off Wrangler.
7. Deploy, add the CNAME at Cargo, confirm the certificate.

**Done when** `curl https://ducky.davidyang.work/api/pond` returns JSON *and*
a deployed delete-a-duck test shows the contact row gone.

---

## Open questions

None blocking. Everything below has a decision; these are the ones worth
revisiting once something is running.

- `CARD_SECRET` is one secret across all cards. Fine for a hundred among
  friends; needs a per-card key if these are ever sold.
- Payload at scale: ~400 KB at a thousand ducks. Fix is fetch-by-region.
- RF write protection on the ST25DV is not configured.

---

## Log

| Date | |
| --- | --- |
| 2026-08-12 | Design complete. Prototype at nine screens, copy deck, UI rules. |
| 2026-08-12 | Plan reviewed twice — internally, then adversarially by Codex. Claim counter replaced with a signed token; Turso FK trap caught; port estimate corrected. |
| 2026-08-12 | **Phase 1a landed.** 49 tests. |
