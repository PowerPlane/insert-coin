# The pond — UI reference

The rules every screen in `ducky.davidyang.work` follows, and a log of what
changed. If a new screen disagrees with something here, one of the two is
wrong — fix it before shipping, don't add a special case.

Canonical implementation: `pond/tools/prototype-flow.html` (review prototype)
and `pond/src/client/` (the real thing). Both must agree.

---

## 1. The standing constraint

**Mobile first, always.** Every decision optimises for a phone held one-handed
by someone who just tapped a card in a bar. Desktop is the courtesy case.

Practical consequences that are not negotiable:

- **44px minimum tap target.** Anything pressable. No exceptions for "small"
  controls — a 20px-tall text button is the single most common bug here and
  it has already been fixed twice.
- **16px minimum font-size on inputs.** iOS Safari zooms the page when you
  focus an input smaller than 16px and never zooms back out.
- **Nothing load-bearing in the bottom 90px.** Safari's URL bar sits there.
  Use `env(safe-area-inset-bottom)`.
- **No hover-only affordances.** There is no hover.

---

## 2. Colour

Pond surface tokens (light UI on water):

| Token | Value | Use |
| --- | --- | --- |
| `--p-ink` | `#0b3d52` | All small text, labels, button text. 11.1:1 on surface. |
| `--p-soft` | `#2d6076` | Body text only. 6.6:1. |
| `--p-faint` | `#5b8699` | Decoration and disabled only. **Never** small text — 3.5:1 fails. |
| `--p-surface` | `#f2fbfe` | Sheets, cards, panels. |
| `--field-500` | `#3fb5d8` | The pond blue. Focus rings, accents. |
| `--field-900` | `#16718f` | Deep water. |
| `--duck` | `#ffca00` | The primary action, and the duck. |
| `--duck-shadow` | `#c08508` | The 3D shadow under `--duck`. |

Sprite colours are fixed and are **not** theme tokens — a duck is the same
duck everywhere:

- beak `#EF9F4E` · eye `#2B2B24` · burning body `#FF8953`
- flame `#FF4B4B` (core) and `#FF8953` (tips)

**Rule:** labels and small text take `--p-ink`. Reaching for `--p-soft` or
`--p-faint` on a label is how the studio nav ended up unreadable.

---

## 3. Corners — one language

Every pressable rectangle is cut with the same **two-step 3px staircase**,
exposed as `--px-corner` and applied with `clip-path`.

```css
clip-path: var(--px-corner);
```

**Why:** a 99px pill next to a 24×24 sprite is the only shape in the product
that could not have been drawn on the grid. Pixel-cutting some elements and
rounding others reads as a mistake, so it is all or nothing.

Applies to: `.btn`, `.p-btn`, `.icon-btn`, `.say-btn`, `.s-nav button`,
`.s-tabs button`, `.swatches button`, `.field input`, `.field textarea`,
`.hud span`, `.p-bumper`, `.priv`, `.s-strip`.

Two consequences of `clip-path` that bite every time:

1. **It clips `box-shadow`.** The 3D buttons draw their face on `::before`
   and their shadow on `::after`, offset 4px, both clipped. Never put a
   `box-shadow` on a clipped element expecting it to show outside.
2. **It clips the focus ring.** Clipped controls use
   `box-shadow: inset 0 0 0 3px var(--field-500)` instead of `outline`.
   An `outline` on a clipped element is invisible.

---

## 4. Type

| Role | Face | Notes |
| --- | --- | --- |
| Display | Young Serif → Georgia | Headings only. |
| Body | InterVar → system-ui | Running text. |
| Utility | IBM Plex Mono | Labels, chrome, data, counters. |
| Japanese display | Dela Gothic One | 大吉 etc. at heading size **only**. |
| Japanese small | Zen Kaku Gothic New | Dela fills in and becomes a blob below ~14px. |

Both Japanese faces are subset to nine glyphs (`大吉小末凶おみくじ`). They
cannot render Chinese — see §8.

**Label style:** mono, uppercase, `letter-spacing:.1em`, `--p-ink`.
Minimum `.64rem`. The screen title in a nav row must outrank its buttons —
title bold at `.8rem`, buttons `.68rem`.

---

## 5. Motion

Everything is stop-motion. Nothing eases smoothly except position lerps.

| Thing | Duration | Curve |
| --- | --- | --- |
| Stop-motion tick | `DWELL = [180, 380, 280, 180]` ms | the card's own uneven walk |
| Ripple | 480 ms | ease-out, discrete rings — **not** a wave sim |
| Bump dart | 420 ms | ease-out cubic, fixed regardless of distance |
| Sheet / panel | 220–280 ms | `steps(4)` / `steps(5)` |
| Sparkle | `on = d·36ms`, hold 170 ms, `off = d·42ms` | `steps(1)` |
| Fire flicker | ~14 Hz | drops **pixels**, never brightness |

**Rules:**

- A wave *simulation* always lingers, because dissipating energy takes time.
  Ripples are discrete events with a hard end. This was reverted once already.
- The fire flicker is inside the 3–60 Hz band WCAG 2.3.1 restricts. It is only
  acceptable because the area is one duck and **the luminance never swings**.
  Never flicker brightness, never flicker the background.
- `prefers-reduced-motion` never removes information. A reduced-motion bump
  still bumps, it just doesn't travel; a reduced-motion fire is steady, not
  absent.

---

## 6. Dither

**Texture for surfaces and edges. Text always on a solid fill.** Measured:
11.1:1 on solid, and dithered text falls below AA immediately.

Water is Bayer-dithered brand blues, never a gradient.

---

## 7. Components

| Component | Rules |
| --- | --- |
| `.btn` | Primary. Full width, `--duck`, 44px min, 4px pixel shadow, `translateY(3px)` on press. `.btn.g` is the quiet variant. |
| `.icon-btn` | 44×44, icon only, sits beside what it acts on — never in a row of equal-weight buttons competing with the primary action. |
| `.s-nav` | Back / **title** / forward. Title is the largest, darkest thing in the row. Buttons are chips, 44px tall. |
| `.hud span` | Floating labels over water. Pixel-cut, solid white fill, `--p-ink`. |
| `.p-bumper` | 40×40 tile, duck sprite at 32px, count in the corner. Ranked, max 5. |
| Glyphs | `iconCanvas(name, sizeInCssPx)`. The size argument is the **displayed** size, never a pixel scale, so changing a glyph's grid cannot change how big it lands. Canvas is `margin:0 auto` — `text-align:center` does not centre a block. |

---

## 8. Language

- Default comes from the **card keeper's** setting; the **visitor's browser
  wins** if it asks for a language we have. A keeper sets a default, not a lock.
- `lang` must be set correctly on the document. Several characters are drawn
  differently in Japanese and Traditional Chinese; with a Japanese face in the
  stack and no `lang`, a Chinese reader gets Japanese letterforms.
- CJK uses **system faces** (PingFang TC, Noto Sans CJK TC, Microsoft JhengHei).
  A full Traditional Chinese webfont is megabytes and this is a phone that just
  tapped a card.
- The label style does not survive translation: Chinese has no uppercase, and
  `letter-spacing` on CJK pulls characters apart. Chinese labels get the same
  size and colour with **no tracking and no transform**.
- 大吉 · 小吉 · 末吉 · 凶 read correctly in Traditional Chinese unchanged. In
  English they sit next to a gloss; in Chinese the gloss is redundant and drops.
- User-written content is **never** translated.

---

## 9. Privacy surfaces

- A duck's card never shows the card serial. It shows `via <keeper>`, or
  nothing. Publishing the serial hands out half of what a card claim is keyed on.
- Contact scope is stated in **names**, on every row, everywhere it appears —
  "shared with Sam and you", not "scope: 2".
- "Take my duck out" deletes the duck and its contact in one transaction.
  Nothing is retained, and no other person's duck is ever cascaded away.

---

## 10. Changelog

| Date | Change | Why |
| --- | --- | --- |
| 2026-08-12 | Copy deck added ([COPY.md](COPY.md)) | Every string in one reviewable place. Its first run caught "waved" surviving the bump rename, and the keep sheet handing out /d/<slug> as the private link. |
| 2026-08-12 | Card setup trimmed 169 → 124 words | It was nearly double the next longest screen. |
| 2026-08-12 | Keeper links their own duck | Claiming a card and having a duck are different things; either can come first, so neither is a precondition. Optional, and the link is how two cards say they belong to one person. |
| 2026-08-12 | 44px audit across all nine screens | Writing this file down found six violations, three pre-existing: text inputs and studio tabs at 40px, the duck card's close at 28px, Bump/Report at 34px. |
| 2026-08-12 | Card setup + Admin screens added | The keeper flow and moderation now exist as screens, not just a proposal. |
| 2026-08-12 | Bump replaces wave | A wave was a number; a bump is an event you watch. Reuses the splash impulse. |
| 2026-08-12 | Bump capped at 10 unreturned | The poke dynamic — it forces reciprocity instead of one-way spam. |
| 2026-08-12 | One corner language | Pixel-cut two chips and rounding the rest read as a mistake. |
| 2026-08-12 | `iconCanvas` takes a display size | Growing the art from 9 to 27 grew the glyph past its button and clipped it. |
| 2026-08-12 | Glyphs centred with `margin:0 auto` | `display:block` in a `text-align:center` button pinned every glyph left. |
| 2026-08-12 | Gear + chat use the reference art | The redraws read as a mandala and a sun. |
| 2026-08-12 | Studio nav rebuilt | 10px labels, 20px hit area, no surface — unreadable and unhittable. |
| 2026-08-12 | Flames actually render | The `burning` flag existed with no renderer; ducks caught fire invisibly. |
| 2026-08-12 | Duck card drops the card serial | It published half of a card-claim credential. |
| 2026-08-12 | Slug ≠ name ≠ edit key | A readable URL must not be the edit credential. |
| 2026-08-12 | Fortune gloss drops in Chinese | The kanji already say it. |
