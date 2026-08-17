# Rebuild — bringing the pond back to the prototype

Agreed 2026-08-13. Reference: `pond/tools/prototype-flow.html` (rev F), which
is byte-identical to the signed-off artifact apart from 15 trailing bytes.

## Context

The live client drifted from the prototype in four ways, one of them a real
bug that only appears on a phone. Reviewing both side by side at 390×844:

1. **The pond is visually broken on iOS Safari.** Ducks and water dither are
   stretched vertically into smears.
2. The camera sits far too close, and the water's 8-shade depth ramp is
   spread across a world so large it reads as horizontal banding.
3. The pond's chrome lost the pixel-staircase treatment, and three elements
   are missing outright.
4. Six screens that are full views in the prototype became sheets over the
   pond.

Decisions taken: full screens per the prototype; keep inertia but rebuild it
mobile-first with tunable constants; land everything in one pass and ship
once.

---

## A. The stretch — why it only happens on a phone

`PondView.resize()` (`src/client/pond-view.ts:371`) sizes the backing store
from `getBoundingClientRect() × dpr`. That is correct when it runs. It is
wired to exactly one trigger, `src/client/main.ts:151`:

```ts
window.addEventListener("resize", fit);
```

`.p-canvas` is `height: 150%` of a viewport-sized stage (`app.css:106`). When
Safari's URL bar collapses or expands the stage changes height — but Safari
does not reliably fire `resize` for it, it moves `visualViewport`. The CSS box
grows, the bitmap does not, and the browser stretches it. X is unaffected, Y
smears. Desktop Chrome at a fixed viewport never reproduces it, which is
exactly why the test pass missed it and a real phone found it in one tap.

**Fix.** Observe the element, not the window:

- `ResizeObserver` on the canvas — fires on any box change whatever caused it.
- `visualViewport` `resize`/`scroll` as a second signal for iOS toolbar moves.
- Re-fit when `devicePixelRatio` changes (moving between displays).
- Keep the existing early-return so a no-op change stays free.

**Guard.** A test asserting the backing-store aspect ratio equals the CSS box
aspect ratio after a simulated height change. That is the invariant that broke,
so that is the thing to assert — not the listener list.

## B. Camera, zoom, and the infinite canvas

Rebuilt around one tunable block at the top of `camera.ts`, so feel can be
changed without reading the logic:

- Velocity from a short trailing sample window, not the last two events.
- Rubber-band resistance at the world edge, with a spring release.
- Pinch anchored in **device** pixels (the earlier 24.75px drift was CSS
  pixels handed to a device-pixel API).
- Double-tap to zoom about the tap point.
- Integer zoom ladder `{2,3,4,6,8}` kept — it is what keeps pixels square.

The world and the default zoom get fixed together: the water ramp must read
across roughly one screen, not one world, or the bands show. Prototype
values to match: `CELL`, `OVERSCAN = 1.5`, `ZOOMS = [2,3,4,6,8]`,
`CAM_UI = 480`, `CAM_MOMENT = 1100`, `DUCK_ABOVE_SHEET = 0.32`.

## C. The pond's chrome

`--px-corner` is defined (`app.css:51`) and applied to sheets, buttons, inputs
and cards — but not to `.p-count` or `.p-zoom button`, which is why they are
plain rectangles. Apply it, add the missing pieces, and fix the voice:

| | prototype | live now |
| --- | --- | --- |
| count chip | `13 DUCKS`, uppercase mono, letterspaced, pixel corner | `6 ducks`, lowercase, square |
| zoom | 44×44, pixel corner, `#ffffffee` | square, flat |
| top-right | `BY-002` chip | missing |
| bottom | full-width CTA | missing |
| footer | `ducky.davidyang.work` | missing |

## D. Screens

The prototype switches nine `.view` elements through one `go(name)`. Rebuild
as real views with a header bar and a water strip above, replacing the sheet:
**studio, sign, contact, mine, manage, keeper**. The duck card and the report
box stay as overlays — they are glances, not tasks.

`app.css:715` documents the sheet model as deliberate. It was, and it drifted
from the prototype; this reverses it on purpose rather than by accident.

## Verification

Chrome at 390×844 dpr 3, `isMobile` — and specifically **with the viewport
height changed mid-session**, which is the case that reproduces A. Each screen
compared against the same screen in the prototype at 326×740. Then `npm run
verify` (currently 224 tests) and a real-device pass before the single deploy.

## Order

A → C → B → D, then ship once. A is small and unblocks honest visual
comparison; C makes the diff legible; B and D are the large pieces.

---

## E. Messages, duck variants, animation — added 2026-08-13

Second reference: artifact `fafccdf9` — **The Pond — rev E**, an earlier and
smaller revision than rev F. Where they disagree, rev F wins on layout; rev E
is the reference for the three systems below.

### Messages ("say")

The server side already matches rev E exactly and needs nothing:
`SAY_VISIBLE_SEC = 45` (`src/worker/ducks.ts:174`) and
`SAY_COOLDOWN_SEC = 10 * 60` (`src/worker/social.ts:17`). Older says are not
sent to the client at all.

Missing is the client: the compose row (`say-open` / `say-in` in rev E) and
the speech bubble drawn over a duck for its 45 seconds. Bubbles are part of
the canvas, not DOM — they have to pan and zoom with the duck they belong to.

### Duck variants

Four fortunes — 大吉 / 小吉 / 末吉 / 凶 — each with its own sprite, times the
tint palette, times stickers, times the paint layer. `FORTUNES` and the
sprite rows already exist in `src/client/sprites.ts`; what needs checking is
that every variant is reachable and that the burning state still composites
over each of the four rather than only over `little`.

### Animation — the gap the CSS shows plainly

rev E animates DOM with **stepped** easing, never smooth:

```
transition: transform .22s steps(4, end);
transition: opacity  .18s steps(3, end);
.btn:active { transform: translateY(3px) }   /* face onto its shadow */
```

`public/app.css` currently contains **no `transition` declarations at all**
and one use of `steps()`. So every DOM movement in the live client is either
instant or browser-default smooth — both wrong. Stop-motion is not only the
canvas's discipline; rev E applies it to sheets, scrims and buttons too, and
that is a large part of why the prototype feels made and the live client
feels generic.

Canvas timings already correct and to be left alone: `HOLD = 170`,
`RIPPLE = 480`, `CELL = 4`, `PETAL_LIFE = 3 min`, 12fps with the `DWELL`
table.

**Work:** a stepped-transition scale in the stylesheet, applied to sheet
entry, scrim fade, button press, chip changes and tab switches — with
`prefers-reduced-motion` honoured, as rev E does via its `reduce` flag.

### Sticker slots must fit all four ducks

Both artifacts place stickers at fixed sprite coordinates:

```
SLOTS = { hat:[15,2], face:[15,5], neck:[13,10], body:[10,15], float:[5,7], held:[7,…] }
```

One table, four different duck outlines. A hat anchored for 小吉 sits in the
air on 凶 if their heads are at different heights, and "Surprise me" places
into the same slots, so it produces a wrong-looking duck rather than a
random one. The four sprites have to be checked slot by slot — and where a
slot genuinely differs, the offset belongs **per fortune** rather than one
table stretched over all of them.

This applies equally to the random decoration path and to hand placement.
