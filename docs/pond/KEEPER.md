# Keeping a card

A plan, not an implementation. Nothing in § 4 onwards is built yet.

The brief: a card should just work. Nobody should have to register one,
and the person who opens a new card should be able to say "this one is
mine" in a single tap — without knowing that blowing on it four times is
a thing.

---

## 1. In plain terms: what happens when you tap

Worth setting down first, because the rest only makes sense against it.

**The card is a sticker with a web address on it.** The address is written
once, when the card is flashed, and it looks like this:

```
https://ducky.davidyang.work/?d=2&c=7F3A9KQZ&g=0000&t=9a41c0be7d
                                │   │         │      │
                                │   │         │      └─ a signature
                                │   │         └──────── a counter
                                │   └────────────────── which card
                                └────────────────────── your fortune
```

Four things, and each does one job:

- **`d` — your fortune.** 1–4, meaning 大吉 · 小吉 · 末吉 · 凶. This is
  the *only* byte the card rewrites when you insert a coin: it rolls a
  number, patches that one character, and goes back to sleep. It is live
  for five minutes and then reads `d=0`, which is the card saying "no
  coin in me right now".
- **`c` — which card.** Eight characters derived from the chip's own
  serial number. Every card has a different one and it never changes.
- **`g` — a counter.** Starts at `0000`. Goes up by one each time somebody
  blows on the card four times.
- **`t` — a signature.** An HMAC over `c` and `g`, made with a key that
  only the firmware and the server know. This is the part that makes the
  card *unforgeable*: anyone can type a serial into a browser, nobody can
  produce a matching signature without the key.

**Everything the pond knows about a tap comes from those four values.**
There is no login, no account, no password anywhere in this product.

### Why there are two different "proofs"

A tap proves *someone is holding this card right now* — for five minutes,
that person can make one duck.

Blowing four times proves *deliberate physical control*. A card lying on a
bar can be tapped by anyone walking past; it cannot be blown on four times
by accident. That is why the four-blow gesture — and not an ordinary tap —
is what currently grants **keepership**.

### What a keeper actually is

This is the part worth knowing, because it is much smaller than it sounds.
A keeper is four columns in one row of `card_epochs`:

| what | why it exists |
|---|---|
| **`keeper_name`** | ducks from this card read *via Sam* in the pond |
| **`lang`** | the card's DEFAULT language — a visitor's phone still wins |
| **`keeper_duck`** | which duck is theirs, so the pond can whistle for it |
| *(one-time)* **adopt** | claim the ducks made from this card before they arrived |

That is the whole of it. **No email, no password, no account.** So the
answer to "what exactly does keeper info need?" is: **a name and a
language.** The duck link and the adoption are both things the pond can
work out for itself in the common case, which is what makes a one-tap
sheet possible rather than a form.

### A card has a succession of keepers, not an owner

Each claim opens an *epoch* and closes the previous one. Ducks and contacts
point at an epoch, never at a card. So when a card changes hands the new
keeper inherits **neither** — a contact shared with Sam was shared with
SAM, and Mika picking up the same card later sees none of it and does not
have to be trusted not to.

---

## 2. Why "FROM NO CARD" appears in admin

Two ducks in the pond — Dog and Billyboi, both from the card given to
Kariina — show **from no card**. That is not a display bug, and the card
does have a serial: every tag carries `&c=`, written at provisioning.

The cause is in `mintSession` (`src/worker/session.ts`):

```ts
let cardId: string | null = null;
if (opts.cardId) {
  const card = await env.DB.prepare(`SELECT id, disabled FROM cards WHERE id = ?1`)…
  cardId = card ? card.id : null;   // an unknown serial is stored as NULL
}
```

`sessions.card_id` is a foreign key and `?c=` is typed text, so a serial
the database has never heard of **cannot** be passed through — it would
turn `/?d=1&c=whatever` into an unhandled database error. Storing NULL is
the correct behaviour given what it knows.

What it did not know was the card. Kariina's card was never in `cards`,
because until now cards had to be recorded by hand and imported.

**That is already fixed and not yet live.** Commit `8d52cd1` adds
`ensureCard`: a tap whose signature verifies registers the card itself,
before the session is minted, so `mintSession` then finds it. It is pushed;
production is still running `8bcf885`. Once deployed, every card
introduces itself on its first tap and provenance follows automatically.

It cannot repair Dog and Billyboi — those rows already hold NULL. That is
the argument for **§ 7.3, attach a duck to a card** in admin.

---

## 3. What is wrong with the flow today

1. **Keepership is only reachable by a gesture nobody is told about.** Four
   blows during the boot window. A friend given a card will never discover
   it, so in practice every card David hands out stays unclaimed and every
   duck from it reads *via* nobody.
2. **Card setup asks for something it already knows.** It has a *paste your
   duck's private link* field — for a person who, nine times out of ten,
   made that duck ninety seconds ago in this same browser.
3. **It is a full screen for two questions.** Justified when it was reached
   by blowing on a card with no pond behind it. Not justified for somebody
   who has just watched their duck land.
4. **The keeper credential lasts one hour.** `pond_keeper` is a cookie with
   `Max-Age=3600`. After that there is no way back to card settings except
   blowing four times again.
5. **Nothing can be undone.** No way to hand a card on, stop keeping it, or
   reset one that the wrong person claimed.

---

## 4. The design

### 4.1 The principle

> The card proves *which card* it is on every single tap. The only open
> question is *whose* it is — and the person who opens a new card is
> almost always its keeper.

So: offer it, in the moment, to the person who just made the first duck
from an unclaimed card. Keep the four-blow gesture as the way to *take
over* a card that already has a keeper. Make every part of it reversible
from admin.

### 4.2 The offer

On the pond, after the duck has landed — the bar today has two states that
matter here:

```
  a fortune waiting          your duck is in
  ┌───────────────────┐      ┌─────────┬─────────┐
  │   DECORATE IT     │      │  💬     │   ⚙     │
  └───────────────────┘      └─────────┴─────────┘
```

The offer becomes a third row **above** the glyphs, not a third glyph
beside them:

```
  your duck is in, and this card has no keeper
  ┌───────────────────────────────────────┬───┐
  │        KEEP THIS CARD YOURS           │ × │
  ├─────────────────────┬─────────────────┴───┘
  │        💬           │        ⚙            │
  └─────────────────────┴─────────────────────┘
```

**Why a row rather than a third glyph.** A glyph is a *reminder* of
something you already know how to do — say something, open settings. This
is an invitation to do something nobody has heard of, and an invitation
needs words. Three unlabelled glyphs would be the worst of both: no
explanation, and the two familiar ones get smaller to make room.

It carries a **dismiss**, because the answer "no, I am just playing with
someone else's card" is a real answer and the bar must not nag. Dismissal
is remembered in `localStorage` and is **not final** — see § 5.

**When it appears.** All three must hold:

- the session's card is real (its signature verified — see § 6),
- that card has **no current epoch**,
- you have a duck.

**Decided (David, 16 Aug):** the offer goes to **anyone who makes a duck
while the card is unclaimed — first to accept wins**, not to the first
duck alone. In the ordinary case these are the same person; the
difference only shows when somebody shrugs, and one shrug should not
leave a card claimable only by a gesture nobody has been told about.

### 4.3 The sheet

One tap opens a sheet, not a screen. Two questions, both prefilled:

```
  ┌───────────────────────────────────────────┐
  │  Keep this card yours                     │
  │                                           │
  │  Ducks from this card will say “via Sam”. │
  │  You can change it or hand it on later.   │
  │                                           │
  │  YOUR NAME                          3/18  │
  │  ┌─────────────────────────────────────┐  │
  │  │ Sam                                 │  │
  │  └─────────────────────────────────────┘  │
  │                                           │
  │  THIS CARD SPEAKS                         │
  │  ┌──────────┐ ┌──────────┐                │
  │  │ English  │ │ 繁體中文  │                │
  │  └──────────┘ └──────────┘                │
  │                                           │
  │  ☐ Also count the 2 ducks already made    │
  │    from this card                         │
  │                                           │
  │  ┌─────────────────────────────────────┐  │
  │  │             KEEP IT                 │  │
  │  └─────────────────────────────────────┘  │
  │              Not now                      │
  └───────────────────────────────────────────┘
```

- **Name** prefills from the name they just signed their duck with. It is
  the same question — *what should people call you* — asked twice, and
  answering it twice is the kind of thing that makes software feel like
  paperwork.
- **Language** prefills from the language they are reading in right now.
- **Their duck** is linked automatically from the edit key already in this
  browser. The paste field disappears entirely.
- **Adopt** appears only when there are orphans, and states the number.

`cardSetup` becomes one component with two presentations: **compact** when
the pond already knows their duck, **full** when it does not (the
four-blow path, where there may be no session and no duck at all).

### 4.4 The durable way back

`pond_keeper` expires in an hour, which is fine for a bootstrap and no good
as the only key to the door. The durable credential is one they already
have: **their duck's private link.**

`keeper_duck` points at their duck; that duck's `edit_key` is already the
credential for editing it. So `/api/keeper` gains a second way in — an edit
key whose duck is the `keeper_duck` of a current epoch — and the duck's
settings screen gains a row:

```
  THIS CARD IS YOURS
  via Sam · English                    CARD SETTINGS →
```

which opens the same sheet, plus § 4.5.

The consequence to accept: whoever holds that private link is the keeper.
That is already true of the duck itself, the link is presented as a
credential throughout, and admin can reset a card in one tap.

### 4.5 Handing it on, and stopping

Two different intentions, and they deserve two different actions rather
than one called "delete":

- **Take my name off** — `keeper_name = ''`. You are still the keeper; the
  ducks stop saying *via*. For somebody who wants the card without the
  byline.
- **Someone else keeps it now** — end the epoch. The card becomes
  claimable: the next person to make a duck from it gets the offer, or the
  new owner blows four times. Your ducks stay in the pond and keep their
  *via*, because history is not a lie — and the confirm says so plainly.

Both confirm before acting. Neither deletes a duck; nothing here can.

---

## 5. Every way in, and what happens

| you arrive at | meaning | what happens |
|---|---|---|
| `/` | typed, or the home-screen app | the pond. Your duck's glyphs if you have one |
| `?d=1..4&c&g=0000&t` | ordinary tap, coin inserted | card registers · session · arrival → studio → sign → contact → keep · **offer if unclaimed** |
| `?d=0&c&g=0000&t` | tap with no coin in it | card registers · read-only pond · no offer (no duck to attach) |
| `?d=N&c&g=NNNN&t` | tapped after four blows | **claim** → card setup, full presentation (the takeover path) |
| `/d/<slug>` | a duck someone shared | that duck's public page |
| `/e/<key>` | your private link | your duck's settings · **+ card settings row if you keep it** |

The tap URL is stripped from the address bar on arrival (`main.ts:1616`)
whenever `t` is present, so the serial and signature never sit in history
or a screenshot. That already happens today.

### Edges

- **They tap "Not now".** Dismissal is remembered so the bar stops asking.
  The offer stays reachable from the duck's settings screen for as long as
  the card is unclaimed — a decision made in three seconds while watching a
  duck land should not be permanent.
- **They delete their own duck.** The trigger nulls `keeper_duck`. They are
  still the keeper, but the durable credential is gone: the way back is
  four blows, or David in admin. Worth stating in the confirm on *Take my
  duck out* when that duck is a keeper duck.
- **A stranger taps David's card first.** They get the offer and can take
  it. This is the intended trade and the reason § 7 exists — David resets
  the card in one tap. The mitigation on David's own cards is to claim them
  before handing them over, which he does anyway.
- **Two people race.** The partial unique index
  `(card_id) WHERE ended IS NULL` decides it in the database. The loser
  gets "somebody already keeps this card", not a 500.
- **The prefilled name is reserved.** A duck signed *David* prefills a name
  `saveKeeper` refuses. The sheet renders that refusal inline against the
  field. It must not swallow it.
- **`CARD_SECRET` is not configured.** No card can register and no offer
  can ever appear. Today that fails silently, which is the worst shape
  available. Admin should say so at the top of the Cards tab.

---

## 6. The change that makes this safe

**This is load-bearing and must ship with it.** In `mintFromQuery`
(`src/worker/index.ts:125`):

```ts
await ensureCard(env, safeToken(url.searchParams.get("c"), 12), …);
…
const minted = await mintSession(env, {
  cardId: safeToken(url.searchParams.get("c"), 12),   // ← unverified
  …
});
```

`ensureCard` returns whether the signature was real — its own comment says
"so callers can tell a genuine tap from somebody typing `?d=1`" — and the
return value is **discarded**. The serial is then bound to the session
straight from the query string.

Today that is minor: `mintSession` refuses a serial it has never seen, so
the worst case is attributing your own duck to a card that is already
known. **Under this design it is keepership theft.** Anyone who once saw a
serial could type `?c=SERIAL&d=1`, make a duck, and take an unclaimed card
they have never touched — which is exactly what the signature scheme
exists to prevent.

The fix is one line: bind the card only when it verified.

```ts
const cardId = safeToken(url.searchParams.get("c"), 12);
const real = await ensureCard(env, cardId, url.searchParams.get("g"), url.searchParams.get("t"));
…
const minted = await mintSession(env, { cardId: real ? cardId : null, … });
```

Safe to require, because **every tag carries `&c=`, `&g=` and `&t=`** —
`config.h` writes all three at provisioning and only the digit is ever
patched. There is no such thing as a real tap without a signature.

Two consequences to state rather than discover:

- A card flashed with the placeholder all-zero key never verifies, so its
  ducks get no provenance and it can never be kept. That is correct — the
  KS0KEKBX class of mistake becomes visible instead of quietly producing
  ducks with forgeable tokens — but it means fixing such a card is
  reflash-and-erase, not a database edit.
- Provenance for every future duck now depends on `CARD_SECRET` being
  right in production. Hence the admin warning above.

---

## 7. Admin: making a card new again

Three separate operations, separate because one of them destroys things.

**7.1 Reset the keeper** *(safe)* — end the current epoch. The card becomes
claimable. Every duck stays exactly where it is and keeps its *via*, since
those point at the epoch that has ended, not at the card. This is the
answer to "the wrong person claimed it" and to "I want to set it up for
Kariina myself".

**7.2 Unlink the ducks** *(safe, and the real "make it new")* — set
`epoch_id = NULL` on the ducks from this card. They stay in the pond and
lose their *via*, and because `card_id` is kept they become adoptable again
by whoever keeps the card next. This is the answer to "somebody added one
by accident".

**7.3 Attach a duck to a card** *(new, and needed today)* — the inverse.
Pick a duck, pick a card, set `card_id`. This is what repairs Dog and
Billyboi. Without it those two are stuck at *from no card* forever.

**7.4 Delete the ducks from this card** *(destructive)* — behind a typed
confirmation of the card's label, and routed through the same delete path
as everything else so the `ducks_before_delete` trigger fires and the
contacts go with them. **The deletion promise is not negotiable and no
bulk path may bypass it.**

Worth telling David rather than building: **"I want to redo my fortune"
already works without admin.** A person takes their duck out from their own
settings screen and taps the card again. The only thing admin is needed for
is a duck whose owner has lost the private link.

---

## 8. What would make this fail

- **Asking for a name twice.** If the sheet does not prefill from the duck,
  it is a form, and the whole argument for a sheet collapses.
- **Making the offer permanent furniture.** It appears once, it dismisses,
  and after that it lives in settings. A bar that keeps asking is a bar
  people stop reading.
- **Letting the offer appear on somebody else's claimed card.** The check
  is *no current epoch*, never *no keeper name* — a keeper who left the
  name blank has still claimed it.
- **Treating "hand it on" as a delete.** Nothing in § 4.5 may remove a
  duck, a contact, or a *via* that was true at the time.
- **Shipping § 4 without § 6.** The offer without the verification fix is a
  worse security posture than having no offer at all.

---

## 9. Order of work

1. **§ 6 first**, on its own, with tests: bind the card only when it
   verified. It is independent, it is a fix regardless, and everything else
   is unsafe without it.
2. `POST /api/claim/first` — claim by session. Refuses unless the card is
   verified, has no current epoch, and the caller has a duck from it.
   `/api/session` gains `keeperOffer: boolean` so the bar can ask once.
3. The sheet: `cardSetup` gains a compact presentation, prefilled, with the
   paste field gone and the reserved-name refusal rendered inline.
4. The bar row, with dismissal.
5. `/api/keeper` accepts an edit key whose duck is a `keeper_duck`; the
   duck's settings screen gains the card row.
6. § 4.5 — take my name off, someone else keeps it now.
7. Admin § 7.1–7.4, destructive one last.
8. `CARD_SECRET` warning in admin, and resolve which serial Kariina's card
   actually reports (todo #49).

---

## 10. Decisions and what is still open

**Settled, 16 Aug:**

1. **Who gets offered the card** — anyone who makes a duck while the card
   is unclaimed, first to accept wins. Recorded in § 4.2.
2. **Where the offer lives** — a labelled, dismissible row *above* the
   say/settings glyphs, not a third glyph beside them. The brief asked for
   a third button in that row; the argument that won is that a glyph is a
   reminder of something you already know how to do, and this is an
   invitation to something nobody has heard of. Recorded in § 4.2.

**Still open, and neither blocks the work:**

3. **Should ending a tenure be one action or two?** § 4.5 argues two —
   *take my name off* and *someone else keeps it now* — because they are
   genuinely different intentions. Building it as two; collapsing them
   later is cheap, splitting them later is not.
4. **Does the four-blow gesture still earn its place?** It remains the only
   way to take over a card that already has a keeper, so it stays. It could
   later be retired in favour of admin-only transfer, once there is any
   evidence about whether a real person ever performs it.
