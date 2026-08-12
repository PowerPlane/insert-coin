# A pond that grows

**Short answer: yes, and it is a small change.** The renderer already has
exactly one scale constant, and a camera is a translate. The reason this is
cheap is worth stating up front, because it is also the reason it will stay
clean.

---

## 1. Zoom is `CELL`, and only integers

`CELL` is already "device pixels per sprite pixel" — every draw call in the
scene is `fillRect(x * CELL, y * CELL, CELL, CELL)`. So:

```
zoom out   CELL = 2    four times the water on screen
default    CELL = 4    what the pond looks like today
zoom in    CELL = 6    reading distance
```

**Integers only. This is the rule that protects the look.** Pixel art scaled
by 2.7× shimmers: some sprite pixels land on 2 screen pixels and their
neighbours on 3, so the duck's outline crawls as you pinch. Every zoom level
here is an exact integer multiple, so a duck is pixel-perfect at every step
and looks like the same drawing, larger.

A pinch gesture is continuous, so it drives a *pending* scale and snaps to
the nearest level on release, with a 160 ms `steps(3)` settle. You get the
smooth gesture; the screen never renders a fractional pixel.

## 2. The world grows, the density does not

The world is measured in sprite units and sized from the population:

```
WORLD = clamp(144, ceil(sqrt(ducks) * 34), 2000)
```

At 14 ducks it is the pond you have now. At 400 it is about 680 units across
— a much bigger pond, with **the same number of ducks per screenful**. That
is the property to hold on to: handing out more cards should make the pond
bigger, never more crowded.

## 3. The camera is two lines

Because every draw already multiplies by `CELL`, panning is a translate in
device pixels around the existing draw block:

```js
ctx.save();
ctx.translate(-cam.x * CELL, -cam.y * CELL);
  // ... every existing duck / ripple / particle / effect draw, unchanged
ctx.restore();
```

Nothing inside changes. Ducks, ripples, flames, bump darts and petals are all
already in world units, so they all come along for free.

**The water stays outside the transform**, drawn screen-locked. It is a
uniform dither field, so scrolling it would be nearly invisible and would
cost a full re-tile every frame. Keeping it fixed also means the vertical
depth gradient stays anchored to the viewport, which reads as light on the
water rather than a texture sliding under the ducks.

## 4. Cost goes down, not up

Today every duck is drawn every frame. With a camera, only ducks inside the
viewport are drawn:

```js
if (d.x < cam.x - N || d.x > cam.x + W / CELL + N) continue;
```

So a 400-duck pond costs the same to render as today's 14-duck pond, because
the same number fit on screen. The water buffer is already one `ImageData`
blit per frame regardless of size.

The payload is the part that does not自动 scale — see §7.

## 5. The whistle

In the Wii Mii Plaza there is a whistle: blow it and every Mii runs over and
lines up. That is the interaction to borrow, and it fits this product better
than it fit Nintendo's, because **the card is already a thing you blow into**.
Four blows claims a card; a whistle gathers the pond. Same gesture vocabulary.

Tapping the whistle offers whatever the pond can group by — the card keepers,
your own circle, a fortune. Choose one and the matching ducks *swim together*
rather than the others disappearing:

```js
// one extra force term in the existing step(); no new rendering
if (gather && matches(d)) {
  const dx = gx - d.x, dy = gy - d.y;
  d.vx += dx * 0.004;
  d.vy += dy * 0.004;
}
```

Non-matching ducks are not hidden — they drift and fade to about 45 %. Hiding
them would make the pond feel like a filtered list; dimming keeps it a place
where the others are still swimming, which is the whole point of it being a
pond and not a feed.

The camera eases to the cluster as it forms. Clearing the whistle releases the
force and everyone drifts apart again on their own — no return animation to
write, because the existing drift does it.

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| World smaller than the viewport | Centre it and disable panning. Never show void. |
| Pan past the edge | Camera clamped to `[0, WORLD − viewport]` on both axes. |
| Pinch below / above the range | Clamped to `CELL ∈ [2, 6]`; rubber-band during the gesture, snap back on release. |
| Tap vs pan | A pointer that moves more than 8 px before release is a pan, not a tap. Below that it is a tap, so ripples and duck cards still work. |
| Pinch fighting the browser | `touch-action: none` on the canvas, or Safari page-zooms instead. |
| "Find my duck" | Eases the camera to your duck and zooms in to `CELL = 4` if further out. It is now a camera move, not a highlight. |
| Labels at low zoom | `YOU` tags and speech bubbles only render at `CELL ≥ 3`. Zoomed out you read the shape of the crowd, not names — and a 4 px tall label is not text anyway. |
| A duck bumps someone off-screen | Allowed. The dart runs in world space and you see the tail of it if you are looking elsewhere. |
| A duck catches fire off-screen | Allowed, and the duck count chip gains a small flame marker so you know to go look. |
| Reduced motion | Camera moves are instant; the whistle gather still gathers, without the ease. |
| Keyboard / screen reader | The hidden duck list already exists. Focusing an entry pans the camera to that duck, so the two views stay in step. |
| Double tap | One zoom step in, centred on the tap point. |
| Momentum after a flick | **Deliberately not built.** Inertia needs velocity tracking, friction and its own clamping, and it is where this kind of code usually starts to rot. A hard stop is honest and one line. |

## 7. The one thing this does not fix

Rendering scales. **The payload does not.** Every duck carries a 384-character
paint layer, so a thousand ducks is roughly 400 KB of JSON before anyone has
seen anything.

The fix is the same camera idea applied to the API: fetch ducks by region and
by recency, not all of them. That is not needed at 100 ducks and is a real
piece of work at 1,000, so it is written down here rather than built now.

## 8. What stays exactly the same

Worth being explicit, since the requirement was that this not change what we
have already settled:

- the sprites, the palette, the dither, the stop-motion tick
- ripples, arrivals, fire, bumps, petals — all in world units already
- the pond at `CELL = 4` with a small population is pixel-identical to today

The change is a camera and a force. Nothing about how a duck looks moves.
