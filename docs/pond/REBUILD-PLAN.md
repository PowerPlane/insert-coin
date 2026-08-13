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
