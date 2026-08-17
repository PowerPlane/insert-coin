# The pond

The web half of BY-002 "Insert Coin", a business card with an NFC chip in it.

Tap the card with a phone. It deals you a fortune, you decorate the duck you
were dealt, sign it, and leave it floating in a pond with everyone else's.

**Live at [ducky.davidyang.work](https://ducky.davidyang.work).**

---

## The words

These come up everywhere. Worth reading once.

| Word | What it means |
|---|---|
| **card** | The physical business card. It has a tiny computer, a coin battery, LEDs, a microphone and an NFC tag. |
| **serial** | Eight characters that identify one card, like `5BKZH69H`. The chip derives it from its own factory ID, so no two cards share one and it can never be changed. |
| **tag** | The NFC part. It holds a web address that the phone opens. The card rewrites parts of that address as things happen. |
| **fortune** | One of four luck levels: 大吉 great, 小吉 little, 末吉 uncertain, 凶 bad. A 凶 duck arrives on fire and anyone can put it out. |
| **duck** | What a visitor makes and leaves behind. |
| **keeper** | Whoever owns a card. Their name shows on every duck from it, as "via Sam". |
| **claim** | Becoming a card's keeper. You blow on the card four times while it is booting. |
| **claim counter** | A number the card stores and raises each time you blow four times. The server accepts a claim only if the number is *higher* than the last one it saw, so an old address cannot be reused. |
| **epoch** | One keeper's turn with a card. Cards can change hands; each turn is separate, so contacts given to one keeper are never inherited by the next. |
| **private link** | The secret address for one duck, like `/e/abc123…`. Whoever has it can rename, redraw or remove that duck. There are no accounts, so this link is the only key. |

---

## Which document answers what

**Start here if you want to know…**

| …what a visitor actually sees | [SCREENS.md](SCREENS.md) — every screen from the tap onward, and the edge cases each has to survive. |
|---|---|
| **…how a card decides who owns it** | [CARD-STATES.md](CARD-STATES.md) — the card and keeper state machine, written because it was wrong five times in one week. |
| **…how to make the cards** | [PROVISIONING.md](PROVISIONING.md) — flash, battery, tap. Every card is identical; it gives itself an identity. |
| **…where it runs** | [HOSTING.md](HOSTING.md) — Vercel, the DNS at Cargo, and the secrets. |
| **…what is and is not safe** | [SECURITY.md](SECURITY.md) — honest rather than reassuring, including what is deliberately undefended. |

**Design records — why something works the way it does:**

| [UI.md](UI.md) | The rules every screen follows: spacing, colour, motion, corners. If a screen disagrees with this, one of the two is wrong. |
|---|---|
| [COPY.md](COPY.md) | Every word the product says. Generated — run `python3 pond/tools/extract-copy.py`, never edit by hand. |
| [KEEPER.md](KEEPER.md) | Claiming a card, handing it on, and the private link as a credential. |
| [ADMIN.md](ADMIN.md) | The `/pondkeeper` screen David runs the pond from. |
| [POND-CAMERA.md](POND-CAMERA.md) | How the pond grows past the edge of the screen: zoom, pan, the whistle. |
| [MOBILE.md](MOBILE.md) | iOS Safari and Android Chrome specifics, including in-app browsers. |
| [SOUND.md](SOUND.md) | A proposal. **Not built.** |

[history/](history/) holds the original build plans and the progress tracker.
They record how the pond got made, not how it works, and are kept because the
reasoning in them is sometimes still the answer to "why is it like this".

---

## Running it

```bash
cd pond
npm install
npm run verify      # types, then bundle, then 449 tests
```

There is no dev server. Two ways to see the interface:

- **The pond itself** — `https://ducky.davidyang.work/?d=1` deals a fortune
  without a card. `d=1` to `d=4` picks which one.
- **The admin bench** — serve the folder and open the harness. It fills the
  screen with generated cards and ducks, so layouts can be judged at real
  batch size without a password or a database:
  ```bash
  cd pond && python3 -m http.server 8899
  # http://localhost:8899/tools/admin-harness.html
  ```

Deploy with `npm run ship` (verify, then Vercel).

---

## Where the code is

```
pond/
  schema/       The database, as SQL. The comments are the design reasoning,
                not decoration — read them before changing a table.
  src/worker/   The server. Every page is a function; there is deliberately
                no public/index.html (HOSTING.md explains why).
  src/client/   The pond, the studio, the admin. Canvas sprites and rendering.
  public/       Served straight to the world by the CDN. Anything dropped in
                here is published, so bench pages live in tools/ instead.
  test/         449 tests. The contact-isolation ones are load-bearing.
  tools/        The prototype, the admin bench, the copy extractor and the
                sprite generators.
```

The firmware is a separate PlatformIO environment at
`variants/business-card-v1/firmware/production-pond/`. The older `production`
and `production-nfc` environments are never touched.
