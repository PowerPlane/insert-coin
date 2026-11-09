# Starting a collab

A collab is its own repo: same kind of card, its own firmware build, its own pond. It starts as a copy of `ducky-card` and then goes its own way. Nothing syncs automatically; fixes are pulled across on purpose (step 7).

## Steps

1. **Make the repo.** On `PowerPlane/ducky-card`, click "Use this template". Name it `ducky-card-<collab>`.

2. **Record where it started.** Add one line near the top of the new README:
   "Started from ducky-card at `<sha>`." (`git rev-parse HEAD` on ducky-card at the time.)

3. **Pick the pond host first.** It is written into every card's NFC tag, so changing it later means reflashing every card. It must serve the pond at the root (`/?d=`). Change it in all six places that pin it. If any of the first five is missed, at least one test fails:
   - `firmware/lib/card-identity/ndef_record.h`: `NDEF_URL_PREFIX`
   - `firmware/production-pond/src/config.h`: `NDEF_DIGIT_OFFSET` (the new derived value)
   - `firmware/lib/card-identity/card-identity.json`: the URL `template`
   - `firmware/lib/card-identity/test_card_identity.c`: expected offset
   - `pond/test/card-identity.test.ts`: expected prefix and offset
   - `firmware/lib/card-identity/spec-header.json.part`: the URL `template`. `regenerate.sh` rebuilds `card-identity.json` from it, so missing it only shows up the next time someone regenerates.

   Check with:
   ```bash
   cd firmware/lib/card-identity && cc -std=c99 -Wall -Wextra -Werror -o /tmp/ci card_identity.c ndef_record.c test_card_identity.c && /tmp/ci
   ```
   ```bash
   cd pond && npm test
   ```

4. **Make the Vercel project.** Import the new repo, root directory `pond`. Set these production env vars, all with new values (never reuse ducky-card's):
   `TURSO_URL`, `TURSO_TOKEN`, `CARD_SECRET`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD`.
   ```bash
   openssl rand -hex 16
   ```
   gives a `CARD_SECRET`; put the same sixteen bytes in `firmware/production-pond/src/secrets.h`.

5. **Make the database.** Create a new Turso database, point `TURSO_URL` and `TURSO_TOKEN` at it, then:
   ```bash
   cd pond && npm run db:apply
   ```

6. **Only now flash cards.** A card flashed before steps 3 to 5 points at the wrong pond or carries the wrong key, and every tap fails.

7. **Pulling a fix from ducky-card.** See what changed in the shared pieces since you started:
   ```bash
   git remote add upstream https://github.com/PowerPlane/ducky-card.git
   ```
   ```bash
   git fetch upstream && git diff <start-sha> upstream/main -- firmware/lib pond/src/flasher pond/src/card
   ```
   Then apply what you need by hand or with `git cherry-pick`.
