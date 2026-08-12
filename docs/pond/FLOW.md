# The Pond — the flow

Ten screens. Everything from the tap to coming back a month later.

Reviewing this end to end is what exposed the one real gap: the flow was
complete in one direction and empty in the other. Screens 09 and 10 exist
because of that.

---

## The happy path

| # | Screen | What it does |
| --- | --- | --- |
| 01 | **Arrival** | The drop. Each fortune arrives differently — see below. |
| 02 | **Your duck** | Names the fortune. One clear CTA, plus an escape hatch to just browse. |
| 03 | **Studio** | Colour, 32 stickers, freehand paint. Live pond-scale preview. |
| 04 | **Sign it** | Name and message. Public visibility stated inline, not in a footer. |
| 05 | **Contact** | Optional, skippable. Privacy stated at the point of asking. |
| 06 | **Release** | The duck enters with its fortune's animation. |
| 07 | **Keep the link** | Text or email it to yourself. This is the only key that exists. |
| 08 | **The pond** | Everyone's ducks. Tap one for its card, wave, say something. |

Decorating comes *before* signing on purpose. By the time someone is asked
for their name they have already spent minutes making something, so the ask
lands as signing your own work rather than filling in a form.

## Coming back

| # | Screen | What it does |
| --- | --- | --- |
| 09 | **Your duck, later** | Days floating, who waved. The wavers orbit your duck, named. |
| 10 | **Message & settings** | Edit message and contact — or take the duck out entirely. |

Reached by the private link, or from the pond's settings control. There are
no accounts and no notifications: **you find out someone waved by coming
back**, which is the entire job of the link.

Redecorating routes into the same studio but saves quietly — the arrival
animation belongs to the first arrival only.

**"Take my duck out" is not optional.** People leave a name, a message and
sometimes a phone number on a stranger's website. There has to be a way to
undo that which isn't emailing David. Deleting the duck deletes its contact
row in the same statement.

## Edge states

| State | Trigger | Behaviour |
| --- | --- | --- |
| **Visitor** | `?d=0` — no coin was inserted | Read-only pond. Can still put out fires, which is the point: a visitor has something to do. |
| **Late tap** | Tapped more than 5 min after the show | Explains the window, offers the pond anyway. Never a dead end. |
| **Offline at release** | Network fails on submit | Draft held locally, retry. Nothing is cleared until the server confirms. |
| **Session spent** | Refresh after releasing | Lands on the duck you already made, not a second blank flow. |
| **Backgrounded tab** | iOS reclaims memory mid-decoration | Draft restored from `localStorage`, up to an hour. |

---

## Arrivals

Not new animation — the sparkle engine already on byproductlab.com, moved.
Every pixel is scheduled by its distance from the shape's centre, so a shape
builds outward and unbuilds outward, on `steps(1)`:

```
on   = d·36ms + jitter        builds centre → out
HOLD = 170ms                  the whole shape is always seen
off  = onMax + HOLD + d·42ms  unbuilds centre → out
```

That 170 ms hold is why the sparkles read as deliberate rather than
twinkly, and it is the thing a rewrite would have quietly lost.

| Fortune | Arrival | Leaves behind |
| --- | --- | --- |
| 大吉 | Pixel fireworks — seven shapes over 700 ms, two waves of radiating pixels. The loudest by a distance. | Nothing |
| 小吉 | Flowers bloom around the duck | **Petals**, for ~3 minutes. They drift, they're tappable, and they dither out rather than blinking away. |
| 末吉 | A sun rises, a cloud drifts over and covers it. Non-committal, which is the point of 末吉. | Nothing |
| 凶 | Arrives **already burning** — flames on the shadow before it lands. The water puts it out in a cloud of mist. | Nothing |

凶's arrival closes the loop with the object: on the card you watched a duck
catch fire, and the first thing the pond does is put it out. Nobody has to
be told that.

## In the pond

- **Tap a duck** → its card: fortune, name, card id, date, message, wave, report.
- **Wave** — once per person, not per tap.
- **Say something** — 60 characters, 45 s on screen, one per 10 minutes. The
  cooldown is the design: it keeps the pond ambient rather than a chat room,
  and makes every bubble worth reading.
- **Fires** — 凶 ducks occasionally ignite. Anyone can tap to put one out,
  including a visitor with no duck. Burns out on its own after 90 s, so the
  pond is never stuck in a bad state. Fire does not spread.

## Accessibility

A pond drawn on a canvas has one real problem: **you cannot tab to a duck.**
The ducks are not elements, so keyboard and screen-reader users get nothing.

The fix is a visually-hidden list of real buttons kept in sync with the
pond. Tab into it and you move duck to duck, hear "Mika's duck, little luck,
4 August", and press Enter to open the same card. The panel is a real
dialog, Escape closes it, and focus returns to the duck you came from.

`prefers-reduced-motion` holds a single frame rather than removing feedback
entirely — the arrivals still happen, they just don't animate.
