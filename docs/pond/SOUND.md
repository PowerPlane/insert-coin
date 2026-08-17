# Sound

A plan, not an implementation. Nothing here is built yet.

The brief: *unique yet familiar and fun.* This document argues that the
familiar half is already decided — the card in your hand made a noise
first — and that the unique half comes from refusing almost everything.

---

## The rule everything else follows

**The pond is stop-motion. The sound is too.**

Nothing here interpolates. Ducks hard-switch between frames on an uneven
12fps dwell, the water is dithered rather than shaded, ripples are discrete
rings, a pixel is on or it is off. A smooth, reverberant, sample-based
sound design would be the one thing in the product that gives away that it
is a web page — the same argument the stylesheet already makes about
easing:

> Stepped, never smooth. Everything in the pond is stop-motion, and a
> smoothly easing panel beside a duck that walks at 12 fps is the one thing
> on screen that gives away that this is a web page.

So: short, dry, low-bit, no tails. Square and triangle waves. Nothing
longer than about 300ms except the two arrivals that earn it. If a sound
needs a reverb to feel good, it is the wrong sound.

**And the card got there first.** BY-002 has a real speaker and a real LED
show. The web half should sound like the same object continuing, not like a
different product that happens to be about the same duck. Where the card
has a motif — the coin, the reveal, the four-blow gesture — the site should
quote it rather than invent beside it.

---

## Where sound belongs, and where it does not

Sound is for **things the pond does**, never for things you do to a form.
Tapping a text field, opening the settings, switching tabs in the studio —
silent. These are furniture, and furniture that chirps is a toy.

The moments worth a sound are the ones that are already animated, because
those are the ones where something happened *in the world*:

| moment | what it is | shape |
|---|---|---|
| **coin / first tap** | the card revealed a fortune; the page opens on it | the unlock (see below) |
| **the fortune** | 大吉 · 小吉 · 末吉 · 凶 | four distinct stings, see below |
| **the drop** | your duck falls and hits the water | one short *plip*, pitch falling |
| **the splash** | the ring that follows the drop | a shorter, quieter *tick* layered under it |
| **a ripple** | tapping the water | the *tick* alone, quieter still, pitch varied by ±2 semitones so repeated taps do not machine-gun |
| **a bump** | your duck crosses and knocks another | two soft knocks, the second lower — a nudge, not a hit |
| **dousing a fire** | tapping a burning 凶 duck | a hiss cut to ~180ms, then nothing |
| **the whistle** | gathering one keeper's ducks | two notes rising, the only *melodic* sound in the pond |
| **a say bubble** | somebody's message appears | one soft blip, once, never for your own |
| **release** | the duck is in | the drop, then the keep card — the sequence IS the reward |

Deliberately silent: the studio's every tap, all navigation, all saves, all
errors. An error sound is a punishment for something that is usually the
product's fault.

### The four fortunes

This is where "unique" lives, and where the card's vocabulary matters most.

- **大吉** — the loud one. The only sound allowed to be a small tune:
  three ascending notes and a scatter of high ticks under the fireworks.
  Nobody else got this duck today; it should feel like the machine noticed.
- **小吉** — two notes, warm, a third apart. Petals fall after; a soft tick
  per petal, thinned so twenty petals are not twenty ticks.
- **末吉** — one note, neutral, no resolution. The fortune is "uncertain"
  and the sound should not decide for it.
- **凶** — no sting at all. It arrives **alight**, and the only sound is
  the fire: a low crackle that stops the moment the water takes it. On the
  card you watched a duck catch fire; the first thing the pond does is put
  it out. Nobody has to explain that, which is exactly why it must not also
  be scored.

---

## The constraints, which are unusually tight

**1. Safari will not make a sound until you touch something.** Audio is
unlocked by a user gesture and not before. The natural unlock is the first
deliberate press in the flow — **"Decorate it"** — which is also the first
moment somebody has chosen to be here. The arrival that plays *before* that
press therefore cannot be scored on a first visit, and should not try: it
would be silent on exactly the taps that matter and noisy on the rest.

Consequence worth accepting: **the very first fortune a person ever sees is
silent.** Fighting that produces a worse product than accepting it.

**2. The pond gets opened in public.** Bars, offices, a queue. A site that
plays a fanfare from a stranger's phone is a site they close. So the
default is **off**, and sound is opt-in — with the invitation placed where
it costs nothing: a small speaker glyph beside the count, remembered in
`localStorage`, and never asked about twice.

That is the opposite of the usual default, and it is right here for the
same reason the say cooldown exists: this is meant to be ambient.

**3. No build step, one committed bundle.** There is no asset pipeline and
`public/` is served as-is. Two options, and the first is better:

- **Synthesise it.** WebAudio oscillators and a noise buffer, written as
  code. Every sound above is a few oscillators with an envelope. Costs
  **zero bytes**, is trivially tweakable, and matches the project's habit
  of generating art rather than shipping it (the ducks are code, the glyphs
  are code, the water is code).
- Ship tiny WAVs. Simpler to author, but adds files, a fetch, and a
  decode — and it would be the first binary asset in the product.

Synthesis, then. `sound.ts` beside `sparkle.ts`, pure functions taking an
`AudioContext`, with the same testability: an envelope is arithmetic and
can be checked without a speaker.

**4. Reduced motion is a signal, not a rule about motion.** Somebody who
asks for less movement is usually asking for less *stimulus*. Sound should
default off there too, even if they later turn it on — and it must never be
the thing that reintroduces what the motion setting removed.

---

## What would make this fail

- **Scoring everything.** The fastest way to make a pond feel like a slot
  machine. The list above is already close to too long; the first
  implementation should ship the drop, the splash, and the four fortunes,
  and nothing else.
- **Sounds longer than their animation.** The splash is ~480ms; a splash
  sound with a 1s tail is still ringing when the water is flat.
- **Volume as the only control.** Off must be genuinely off — no ducking,
  no "quiet mode". A person who muted it has decided.
- **Sound that carries meaning nothing else carries.** Everything above is
  a second telling of something already visible. That is what makes it safe
  to turn off, and it is a hard requirement rather than a nicety.

---

## Suggested order

1. `sound.ts` with an unlock, a mute that persists, and one sound — the
   drop. Prove the gesture-unlock and the mute before authoring anything.
2. The splash and the water tick, which share an envelope with the drop.
3. The four fortunes, authored together so they are a family rather than
   four separate ideas.
4. The bump and the douse.
5. Stop. Review whether the whistle and the say blip earn their place
   after living with the rest.

Open questions for David:

- Should the card's own speaker motif be sampled/transcribed first, so the
  web half can quote it exactly? That would settle "familiar" properly, and
  it needs the firmware's tone table.
- Is the speaker glyph beside the count the right home for the mute, or
  does it belong in settings — where it is discoverable once and then never
  seen again?
