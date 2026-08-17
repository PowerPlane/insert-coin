# The pond — the camera

How the pond grows past the edge of the screen: zoom, pan, and the whistle
that finds your own duck.

What was built and why each part is the way it is. The shipped
implementation is `pond/src/client/pond-view.ts` and `camera.ts`; the
prototype is where it was worked out. Where this page and the code
disagree, the code wins.

---

## Zoom is `CELL`, and only integers

`CELL` is "device pixels per sprite pixel" — every draw is
`fillRect(x * CELL, y * CELL, CELL, CELL)`. Zoom is that constant:

```
2 · 3 · 4 · 6 · 8          4 is home
```

**Integers only, and this is the rule that protects the look.** At 4.7 px per
sprite pixel some pixels land on 4 and their neighbours on 5, so outlines
crawl. Every level is an exact multiple, so a duck is the same drawing,
larger.

Smooth motion between two integers is done by rendering at the **nearest**
integer and applying the leftover fraction as a CSS scale about the centre.
The remainder is at most ±25%, the canvas overscan covers it, and the render
is always on an integer grid. Crisp render, continuous motion.

## One motion, not two

Position and zoom interpolate **together**, every frame, in world space —
`easeInOutCubic`, one easing. An earlier version split them into "travel,
then zoom" to work around a bug, and it felt worse; the bug was the real
problem and splitting them was not the fix.

Two speeds:

| | | |
| --- | --- | --- |
| `CAM_UI` | 480 ms | anything answering a control — zoom buttons, home, whistle, opening a duck card |
| `CAM_MOMENT` | 1100 ms | the one thing watched rather than operated: a duck being released |

## The world wraps

**There are no edges.** Pan far enough in any direction and you come back
round to the same water.

This is not only a nicer feel. Clamping caused most of the camera trouble in
this project — a tween jumping when it hit a boundary, ducks jammed into a
corner by the whistle, "why can't I drag" at zoom levels where the world
happened to equal the frame. A boundary that does not exist cannot be hit
wrong.

Two things follow, and both must hold or the seam shows:

- **Distance** measures the short way round — separation, personal space, the
  whistle, the bump dart. Two ducks either side of the seam are neighbours.
- **Drawing** happens once per tile the viewport touches. The world floor is
  2.4× the frame, so it can straddle at most one seam per axis: four draws
  worst case, one almost always, with off-screen ducks culled in each.

Wrapping is a property of the **space**, not the engine. The pond wraps; the
arrival screen does not — it is a single-duck stage that has edges, and
wrapping sent its camera to the far side of the world.

## The world grows with the population

```
side = max(frame × 2.4, ceil(sqrt(ducks) × 34))
```

More cards means a bigger pond, never a more crowded one. The 2.4× floor
exists so there is somewhere to drag to even when the pond is nearly empty —
without it the world equalled the frame at default zoom and panning did
nothing, which reads as broken rather than as "you have seen it all".

## The canvas is overscanned

Drawn at 150% of its frame and clipped. A camera transform can translate as
well as scale, and a translate slides an edge into view no matter how large
the scale is; the margin means there is always real, rendered water outside
the visible edge to move into.

**Consequence worth remembering:** the camera addresses the *canvas*, but only
the middle two-thirds is ever seen. Centring is unaffected — the overscan is
symmetric — but any *fractional* framing must be measured against the visible
frame. `frameX/frameY/fw/fh/atFrame` exist for exactly this. Measuring "a
third of the way down" against the canvas put a duck 5% down the screen,
behind the notch.

## Two clocks, one render

The world ticks at ~12 fps because stop-motion is the look. The camera is
direct manipulation and must track a finger at display rate. So the camera
redraws on `requestAnimationFrame` while it is moving and not otherwise — an
idle pond still costs one draw per stop-motion frame.

And the world **holds still** for the length of a camera move. Otherwise the
ducks lurch two or three times underneath a smoothly gliding view, which
reads as the zoom stuttering even though the zoom is fine.

## Sprites quantise to canvas pixels

One rule, always. Snapping them to the world grid (`round(x) * CELL`) looks
marginally tidier at rest, because it locks ducks to the water's dither — but
it means a duck can only sit on multiples of `CELL`, so it jumps in
`CELL`-sized steps whenever the view moves. Worse, having *two* rules meant
every camera move ended with every duck snapping up to half a cell as the
rule changed. A rule that changes is worse than either rule.

## The whistle

In the Wii Mii Plaza you blow a whistle and every Mii runs over. The card is
already a thing you blow into, so the pond borrows the gesture. **The duck
count is the whistle** — tap "113 ducks", pick a keeper, and it reads "30 of
113" while active. No extra chrome over the water.

Called ducks each aim at their own spot on a loose ring and arc in, because a
crowd converging on one point packs into a hexagonal lattice and reads as a
crystal rather than a flock. Everyone else is **pushed clear of the frame**,
not dimmed — a faded duck still reads as being in the way — and fans around
the rim rather than jamming into a corner. Clearing the whistle pulls the
shoved ducks back, so the pond refills.

## Ducks keep their distance

Two zones, because not-overlapping and not-clumping are different problems:

- **contact** at `N × 0.86` — a hard push, so two ducks are never in the same
  place
- **elbow room** at `N × 1.75` — much weaker, and it is what actually keeps
  the water evenly occupied

Both run on a uniform grid bucketed to the larger radius, so it stays O(n).
New ducks are placed by best-candidate sampling: even coverage without a
grid's regularity, because plain random clumps.

Headings **wander** rather than holding a fixed drift. A fixed heading is a
straight line and a straight line ends at a wall, which is why ducks used to
collect along the edges before the pond wrapped.

## What is deliberately not built

- **Momentum after a flick.** It needs velocity tracking, friction and its own
  interaction with wrapping, and it is where this kind of code starts to rot.
- **Double-tap to zoom.** It would force every water tap to wait ~300 ms to
  find out whether a second one was coming, and the ripple's snappiness is the
  first thing anyone notices. The zoom buttons cover it, and they also work
  one-handed, which pinch does not.
- **Scenery.** No beach, no reeds, no houses. Later, maybe.

## The one thing this does not fix

Rendering scales; **the payload does not**. Every duck carries a 384-character
paint layer, so a thousand ducks is ~400 KB of JSON before anything is drawn.

The fix is the same idea applied to the API — fetch by region and recency, not
all of them. Not needed at 100 cards, real work at 1,000, so it is written
down rather than built.


---

## Inertia and pinch

**The first camera behaviour with no prototype behind it**, so this section
is the only place the reasoning lives. Added on request: dragging should
follow the force of the finger rather than stopping dead.

### A flick coasts, and slows down

Exponential decay, which is what every platform converged on:

```
v *= exp(-dt / 325ms)
```

UIScrollView expresses the same curve as a per-millisecond
`decelerationRate`; 0.998 is a time constant of ~325 ms, which reads as
normal rather than icy or sticky. The travel is integrated in CLOSED FORM
(`tau * (1 - decay)`) rather than accumulated per frame, so a phone dropping
frames does not also lose distance.

| | |
| --- | --- |
| `FLING_TAU` | 325 ms |
| `FLING_REST` | 0.004 sprite px/ms — below this it has stopped |
| `FLING_MAX` | 4 screen px/ms, so a wild flick cannot teleport across a small world |

**Velocity is measured across a ~120 ms buffer, not from the last event.**
A single delta is mostly sensor noise — and, more importantly, a finger
that slides across and then *pauses* before lifting would otherwise fling
with the velocity of the slide. Over a buffer a deliberate stop yields
almost nothing, so it does not fling, with no special case for it.
Confirmed on the deployed site: a pause-then-lift coasts 0 pixels.

**There is no rubber-banding, and there never will be.** The world wraps,
so there are no edges to bounce off — which deletes the hardest part of
scroll physics. Do not add it back.

**Reduced motion turns inertia off.** UI.md § 5 says reduced motion never
removes *information*; a coast carries none.

### Two fingers pan and zoom at once

The centroid's movement pans, the distance between the fingers zooms, and
the zoom is anchored on the centroid so the water between them stays
between them. Treating those as separate modes makes a pinch feel like
operating two controls badly rather than holding one thing.

**The anchor is in DEVICE pixels.** `CELL` is defined as *device* pixels per
sprite pixel, so passing CSS pixels under-corrects by exactly the
device-pixel ratio. On a 2× screen that is half, and it presents as the
water sliding under the fingers rather than as an obvious bug — measured at
24.75 world pixels of drift for a 200-pixel anchor zooming 4→6, which is
`200 × (2−1) × (1/8)` to the decimal. Now 0.04. There is a test pinned to
that arithmetic.

A pinch is CONTINUOUS while the fingers are down — which is a legal render
state, because the remainder is a CSS scale — and eases onto the nearest
rung when they lift (`SETTLE_TAU` 90 ms). At rest the zoom is always
integral, which is what stops outlines crawling.

### A finger on the glass counts as camera movement

`moving` includes dragging, flinging and settling, not just gliding. It
drives both the display-rate redraw and the world freeze.

Before it did, a drag fell through to the 83 ms stop-motion path and
tracked a thumb at twelve frames a second — the exact thing the two-clocks
rule exists to prevent, and invisible in a screenshot.

### Screen to world uses the continuous cell

Every screen→world conversion — taps, drags, anchors — uses `cam.cell`, not
`renderCell`. They are equal at rest and differ by up to 25% mid-pinch, so
using the render cell would put taps on the wrong duck and make drags
outrun the finger for the length of every zoom.
