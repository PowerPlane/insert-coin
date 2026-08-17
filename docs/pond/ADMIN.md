# The pond — the admin screen

**What this is:** the design record for `/pondkeeper`, the one page David uses
to run the pond. Written as a plan before the rebuild, and kept as the record
of why the screen works the way it does.

**Built and shipped, 17 Aug 2026.** Everything under *Decisions* is live.

**Who reads the screen:** one person, on a phone and on a laptop, in English.

---

## Words used here

| Word | Means |
|---|---|
| **serial** | The eight characters that identify a physical card, like `5BKZH69H`. Comes from the chip itself and can never be changed. |
| **keeper** | The person whose name shows on ducks from their card, as "via Sam". |
| **claim counter** | A number stored on the card. Blowing four times raises it. The server accepts a claim only if the number is *higher* than the last one it saw. |
| **epoch** | One keeper's turn with a card. A card can pass to a new keeper; each turn is a separate epoch so contacts given to one keeper are never inherited by the next. |
| **orphan** | A duck made from a card before anyone claimed it, so it belongs to no epoch. |
| **edit key** | The secret in a duck's private link. Whoever holds it can rename, redecorate or delete that duck. |

---

## What the screen has to do

Six jobs, in the order they come up:

1. **Watch the pond.** New ducks, and anything reported.
2. **Answer people.** Read contacts, reply, post a postcard, tick them off.
3. **Run the card batch.** ~100 physical cards: which are free, which are
   claimed, which are broken.
4. **Set a card up.** Name its keeper, set its language, label it.
5. **Repair things.** Attach a duck that lost its card, hand a private link
   back to someone who lost theirs.
6. **Remove things.** Hide a duck, delete one, empty a card, switch a card off.

---

## What was wrong

All of this was measured on the real bundle at 393 x 852 (iPhone 15) against
a fixture of 30 cards and 40 ducks — roughly a third of the real batch. It is
written in the present tense because that is how it was found; every item is
now fixed.

### It is too long to use

- The Ducks tab is **12.5 phone screens** tall. The Cards tab is **4.7**.
- At the real batch it is triple that, and the duck list grows forever.
- **There is no search.** Finding one duck means scrolling past all of them.

Every row is fully expanded all the time, showing four to six buttons that
are almost never pressed. Reading is the common act; acting is rare. The
layout has it backwards.

### The dangerous buttons are the easiest to hit

- **Delete** sits exposed on every single duck row, at the bottom, exactly
  where a thumb lands while scrolling.
- Inside a card's Edit panel, **"Delete all 12 ducks"** sits *above*
  "Save card" in reading order. The most destructive control on the page
  comes before the most ordinary one.

### You cannot scan a column

On the Cards tab the big text on each row is a keeper name, *or* a label,
*or* a state like "kept · no name" — different kinds of thing depending on
the row. A column you cannot scan is a list you have to read.

Meanwhile the **serial** — the only identity that never changes, and the one
thing printed on the card in your hand — is small grey metadata.

### Counts that do not do anything

The header says "1 reported". You cannot tap it to see which. Same for
contacts that are still waiting for a reply: the screen knows, and does not
offer to show you.

### Three outright bugs

1. An empty **"Label — admin only"** field is invisible: a label followed by
   blank space. It only looks like a field once it has text in it.
2. **"no ducks yet"** is bare text jammed against the Edit button on a
   mismatched baseline. It reads as broken layout.
3. Buttons that do very different things look identical. "Save card",
   "Switch off", "Reset keeper" and "Unlink 9 ducks" are four grey chips in
   one row. One saves your typing; the others change who owns what.

### The explanations exist but are not on screen

The source explains clearly what "Reset keeper", "Unlink ducks" and "Empty
card" each do, and how they differ. That text is in code comments, where the
person deciding which button to press cannot read it.

---

## Decisions

**Keep the three tabs.** Ducks, Contacts and Cards are real, separate things.
This is a reorganisation, not a new look.

**Keep the existing visual language** — the same chips, the same stepped
corners, the same colours as the pond. The code already says the admin should
not invent a second vocabulary, and that is right.

### 1. A row is a summary. Details unfold.

Each row shows identity, one line of context, and any badge that demands
attention. Everything else hides behind one tap. Cards already do this with
their Edit chip; ducks and contacts get the same treatment.

**Nothing destructive is ever visible at rest.** Delete lives inside the
unfolded panel, behind its own confirmation.

### 2. Search on every tab

One box, filtering as you type. It searches names, serials, slugs, messages
and contacts together, because when you are looking for something you
usually remember *one* of those and not which kind it was.

All the data already arrives in a single request, so this needs no server
change.

### 3. Counts become filters

"3 reported" shows you the three. "5 waiting" shows you the five. A number
that describes a problem should take you to it.

The Cards tab gets one summary line — total, free, disabled — and each part
filters.

### 4. One stable shape per row type

**Cards.** The serial is the heading, in monospace, always in the same place.
The keeper name and state sit underneath as context. Now the column scans:
every row starts with eight characters in the same format, which is exactly
how you match a row to the card in your hand.

**Ducks.** The name is the heading, with the fortune beside it. Where it came
from stays one tap away.

**Contacts.** The contact itself — the email or the phone number — is the
biggest thing on the row, because it is the whole point of the tab. The
message drops to context.

### 5. Say what a button does, next to the button

The explanations move out of the comments and onto the screen as one-line
captions. "Reset keeper — ends this keeper's turn. Ducks stay, and keep
their via." Written for someone deciding, not someone maintaining.

### 6. Order by danger

Inside an unfolded panel, always the same order:

```
fields you can type in
Save
------------------------- a rule
things that change state    (switch off, reset keeper, unlink)
------------------------- a rule
things that cannot be undone  (delete)
```

Destructive actions keep their existing confirmations: two taps for a duck,
typing the serial to empty a card.

### 7. On a laptop, one left edge

Above 760px the rows flow into as many columns as fit, and the tabs and the
search sit together on a single toolbar row. That last part was learned the
hard way: capping the controls without giving them a shared parent left each
one centred independently, so the page ended up with three widths on three
different left edges and looked worse than before. The toolbar is one
element so it inherits the container's edge once.

### 8. Sort so the newest is first

Ducks and contacts newest first — you are usually looking at what just
happened. Cards by serial, so the order matches nothing external and is
therefore stable and predictable.

---

## What is deliberately not changing

- **The password gate.** One field, and a wrong answer says "No." A wrong
  password gets a 404 elsewhere in the system, so this stays vague on
  purpose.
- **English only.** One reader.
- **The three tabs.**
- **CSV download.** It appears on Contacts when there is something to
  download, which is right.
- **The `CARD_SECRET` banner.** It stays at the top of every tab. Without
  that key nothing verifies and nothing errors — the pond just quietly stops
  recognising cards, which is the hardest kind of breakage to notice.

---

## How this gets checked

- Screenshots of all three tabs, an unfolded panel and an active search, at
  393 x 852 and 1512 x 900, against the 30-card fixture — not a handful of
  rows.
- `npm run verify` (types, bundle, tests).
- A Codex review afterwards.

All three were done. The Ducks tab went from 12.5 phone screens to 7.3, and
the review found four defects — the most serious a stale contact scope that
could have been shared wider than the screen offered — all fixed before the
merge.

The bench lives at `pond/tools/admin-harness.html`. Serve the `pond`
directory and open it:

```
cd pond && python3 -m http.server 8899
# then http://localhost:8899/tools/admin-harness.html
```

It stubs the admin API with a generated batch, so the real bundle renders
real layouts without a password or a database. It is in `tools/` and not in
`public/` because everything in `public/` is uploaded to the CDN.
