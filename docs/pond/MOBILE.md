# The pond — mobile constraints

Everyone arrives by tapping a card with a phone. Almost all of them will be
in **iOS Safari** or **Android Chrome**, often inside an in-app browser
(Instagram, WhatsApp) that behaves like neither.

This is the checklist the client has to meet. Each item is something that
looks fine on a desktop and breaks on a phone.

---

## 1 · The viewport is a lie

`100vh` on iOS Safari is the height **with the address bar hidden**, which
is not the height you get on load. Use `100vh` as a fallback and let `100dvh`
win where supported:

```css
.app { height: 100vh; height: 100dvh; }
```

Otherwise the bottom of every screen — which is where every button lives —
sits under the address bar until the user scrolls.

## 2 · Safe areas

The home indicator and the notch overlap content unless you ask them not to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
padding-top:    calc(16px + env(safe-area-inset-top, 0px));
```

`viewport-fit=cover` is required or `env()` returns zero. Applied to the
arrival sheet, the duck card, and the pond's bottom bar.

## 3 · Inputs must be ≥16px

**iOS Safari zooms the entire page when you focus an input smaller than
16px, and does not zoom back out.** The user is then stuck at 1.4× on a
canvas app.

This is the single most common mobile-web bug and it is completely invisible
on a desktop. The name and message fields are `font-size: 16px` for exactly
this reason — not because 16px is the right visual size, but because
anything less is a trap.

## 4 · Tap targets

44 × 44 px minimum (Apple HIG, and WCAG 2.5.8 asks for 24 with spacing).
Everything interactive has `min-height: 44px`.

The one real tension is the **studio's paint grid at 24×24**, which puts
cells at about 12 px. Mitigated three ways rather than by growing the grid:
drag-painting instead of tapping, a 2× brush, and stickers that need no
precision at all. David tested this on his own phone and confirmed it works.

## 5 · Don't let the page move under a tap

- `touch-action: manipulation` on everything interactive kills the 300 ms
  double-tap-zoom delay.
- `touch-action: none` on the pond canvas so dragging a sticker doesn't
  scroll the page.
- `overscroll-behavior: contain` so pulling at the top of the pond doesn't
  bounce the whole document.
- **`focus({ preventScroll: true })`** when opening the duck card. A plain
  `.focus()` scrolls the focused element into view, which drags the page
  and makes the pond appear to jump. This was a real reported bug.

## 6 · Performance: the pond is the whole app

The pond is a full-screen canvas repainting continuously, on a phone, on
battery.

- **Water is drawn into a 1px-per-cell `ImageData` buffer** and scaled up
  with smoothing off. The obvious per-cell `fillRect` loop is 63,640 calls
  per frame — 17.8 ms measured on a *desktop*, most of the frame budget gone
  before a duck is drawn. The buffer is **0.7 ms**. Same pixels, 25× cheaper.
- **The stop-motion tick is a performance feature as well as a design one.**
  Eight to twelve repaints a second instead of sixty is most of the battery
  cost of this page gone, which matters for something people leave open on a
  table.
- Pause the render loop on `visibilitychange`. A backgrounded tab painting a
  canvas is pure waste.

## 7 · The tab will be killed

iOS reclaims backgrounded Safari tabs under memory pressure, silently. If
someone is picking a hat and switches apps to answer a message, they can
come back to a fresh page load.

- Every studio change writes a draft to `localStorage` (`api.ts`).
- The draft is restored for an hour.
- Nothing is cleared until the server confirms the release.

## 8 · Storage can throw

Private mode, quota limits, and locked-down in-app browsers all make
`localStorage` throw on write. Every access is wrapped — losing a draft is
bad, taking the whole flow down for it is worse.

## 9 · In-app browsers

Instagram and WhatsApp open links in a webview with quirks: sometimes no
`localStorage`, sometimes a broken back gesture, sometimes a different UA.

Detect and offer "open in browser" **before** the studio, not after — losing
work at the submit button is unforgivable.

## 10 · Accessibility, which is not separate from this

- **You cannot tab to a duck on a canvas.** The pond keeps a visually-hidden
  list of real `<button>`s in sync, so keyboard and screen-reader users can
  move duck to duck, hear "Mika's duck, little luck, 4 August", and press
  Enter for the same card.
- The duck card is a real `dialog`; Escape closes it; focus returns to where
  it came from.
- **Contrast is measured, not eyeballed:** panel name 11.1:1, message 6.6:1,
  both well past AA. This matters most outdoors, which is exactly where
  someone taps a card.
- **Dither is texture. Text always sits on a solid fill.** No exceptions.
- `prefers-reduced-motion` holds a single frame rather than removing
  feedback — the arrival still happens, it just doesn't animate.
- Flames flicker by **shape, never brightness**, over a tiny area. 70 ms is
  ~14 Hz, inside the band WCAG 2.3.1 restricts, and it is only safe because
  the luminance never swings.

## 11 · Colour is never the only carrier

Fortunes read by silhouette; the fortune is also written on the duck card.
This matters twice over: for colour-blind visitors, and because people
recolour their ducks, which would destroy the meaning if colour carried it.

---

## Checklist before shipping

- [ ] Real iPhone, Safari, outdoors, one-handed
- [ ] Real Android, Chrome
- [ ] Opened from inside Instagram's browser
- [ ] Rotate to landscape mid-decoration
- [ ] Background the tab for 10 minutes, come back
- [ ] Airplane mode at the release button
- [ ] VoiceOver: reach a duck, open its card, close it
- [ ] Reduced motion on
- [ ] Direct sunlight — is the water still readable behind the ducks?
