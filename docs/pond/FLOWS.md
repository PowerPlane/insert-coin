# Every way in, and what happens

A map of the card and keeper state machine, written because it has been
wrong five separate times in one week and each time the fix was correct
about the case in front of it and silent about a neighbour.

The recurring shape: **one belief, two copies, and only one updated.**
`?t=` → `isClaimUrl` → `claimIsFresh` → `arrive` is the same gate
re-answered four times. This file exists so the next change can be
checked against the whole grid rather than the case that prompted it.

---

## 1. What a tap carries

Every tag carries all four, always. Only the digit is ever rewritten.

```
/?d=<fortune 0-4>&c=<serial>&g=<counter hex>&t=<hmac>
```

Two facts that most bugs here came from ignoring:

- **`&t=` is on every tag**, armed or not. "Has a signature" never meant
  "is claiming".
- **`&g=` is written once and never cleared.** A card that has ever been
  blown on serves the same armed URL for the rest of its life. "Counter
  above zero" never meant "is claiming *now*".

What claiming actually means: a counter **above the server's high-water
mark**. The client cannot see that mark, so it keeps its own record per
card (`claimIsFresh`) and treats anything it has already tried as spent.

---

## 2. The four things a tap can be

Resolved **before** the pond renders, and the answer is passed in as
`arrive` — the pond does not re-derive it.

| the tap | `d` | claim | outcome | screen |
|---|---|---|---|---|
| ordinary | ≥1 | none or spent | `none` / `refused` | arrival → studio |
| quiet | 0 | none or spent | `none` / `refused` | read-only pond |
| a claim on a free card | 0 | fresh | `claimed` | Card setup |
| a claim on a kept card | 0 | fresh | `takeover` | the question |

Plus the case that produced two separate bugs: **a coin AND a fresh
claim**, which happens because the tag stays armed. The question is shown
first; declining falls through to the arrival, because the tap turns out
to have been ordinary after all.

---

## 3. Becoming a keeper

Three routes in, and they exist because the four-blow gesture alone
reaches almost nobody.

**a. The offer.** Made a duck from a card nobody keeps → a third glyph in
the bar. Tapping it opens the sheet; the sheet's primary claims. Nothing
is committed before the explanation, and "No thanks" is a real answer
because there is still something to decline.

**b. Four blows.** The takeover path. On a free card it claims outright;
on a kept card it asks first and spends nothing until answered.

**c. Coming back later.** A fresh tap plus the private link of a duck
from that card. The session proves present possession; the key answers
which duck is theirs. Neither alone is enough — `ducks.card_id` is
durable provenance and would let a months-old link claim a card nobody is
holding.

### What a keeper is

Four columns of one `card_epochs` row: `keeper_name`, `lang`,
`keeper_duck`, and a one-time adoption. No email, no password, no account.

### Getting back in

`pond_keeper` lasts an hour. The durable credential is the keeper's own
duck's private link, which is why `keeper_duck` is set **at claim time**
by every route — a keeper who closes the sheet without saving still has a
way back.

---

## 4. The grid that keeps catching things

| state | four blows + tap | ordinary tap | private link |
|---|---|---|---|
| never claimed | claims, Card setup | fortune | settings, no card row |
| kept by you | **resumes**, your settings | fortune | settings + card row |
| kept by somebody else | **asks**, spends nothing | fortune | settings, no card row |
| kept, no name | asks (or resumes with your key) | fortune | as above |
| tag armed, claim spent | fortune | fortune | — |
| card disabled | refused | read-only pond | — |
| no `CARD_SECRET` | refused | fortune, no provenance | — |

Row four is the one that bit hardest: a keeper with no name and no linked
duck could not prove they were the keeper, so every re-blow replaced them
with themselves and wiped what they had set.

---

## 5. Edge cases, and where each is handled

**Two people claim at once.** The partial unique index on
`(card_id) WHERE ended IS NULL` decides it; the loser is told somebody
keeps it, not handed a 500.

**A claim is refused mid-flow.** Never blocks a fortune. If the tap dealt
a coin, the flow wins and the refusal is silent.

**The sheet's save fails after the claim succeeded.** The claim is latched
in the sheet, so pressing again retries only the save. Before this, every
press re-claimed and the second one reported a rival keeper who was the
person reading it.

**A double-tap on the primary.** The button is disabled while a save is in
flight.

**The prefilled name is reserved.** A duck signed "David" prefills a name
the server refuses. Shown against the field, and retryable — which needs
the latch above to be true.

**The session expires while choosing a name.** Thirty minutes. Reported as
expired, with "tap your card again" — not as a rival keeper.

**A keeper deletes their own duck.** The trigger nulls `keeper_duck`, so
the durable credential is gone. Recovery is four blows or admin.

**A card is power-cycled mid-window.** Firmware clears the tag at boot,
so a live fortune or an unspent claim cannot sit there readable.

**Somebody declines a takeover.** Nothing is spent and the card stays
armed, so they can change their mind by blowing again. The question is
asked once per counter per browser — a second tap of the same armed tag
goes straight to the fortune rather than asking twice.

**A duck from before cards registered themselves.** `card_id` is NULL and
nothing automatic can repair it; admin attaches it by hand.

---

## 6. What is deliberately not defended

- **A stranger holding the card can take it over.** That is what the
  gesture is for. Every takeover opens a NEW tenure, so no contact,
  consent or duck is inherited, and admin can reset a card in one tap.
- **Whoever holds a private link is that duck's owner.** There are no
  accounts; the link is the credential and is presented as one throughout.
- **The refused-claim sheet prints the serial.** Shown to the person
  holding that card, off the URL they arrived on.
