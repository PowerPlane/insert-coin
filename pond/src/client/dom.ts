/**
 * The three DOM helpers every screen uses.
 *
 * Small on purpose. The point is not to abstract the DOM, it is to make the
 * safe thing the short thing: `el()` sets textContent, never innerHTML,
 * because every screen here renders somebody else's name and message.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML. A duck's name and message are somebody
  // else's text, and this is where they meet the DOM.
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  className: string,
  label: string,
  onClick: () => void,
  aria?: string,
): HTMLButtonElement {
  const b = el("button", className, label);
  // Without this, a button inside a form submits it. There is no form here
  // yet, and there will be, and the bug is silent until then.
  b.type = "button";
  if (aria) b.setAttribute("aria-label", aria);
  b.addEventListener("click", onClick);
  return b;
}

/** A labelled text field with a live character count. */
/**
 * About how long a phone keyboard takes to come up. Long enough that the
 * viewport has settled, short enough not to be seen as a delay.
 */
const KEYBOARD_SETTLE_MS = 320;

export function field(opts: {
  /** Omitted when a heading above already names the field. */
  label?: string;
  placeholder: string;
  max: number;
  value?: string;
  multiline?: boolean;
  /**
   * A field you read rather than fill in.
   *
   * Readonly, not disabled: a disabled field cannot be focused, copied or
   * read aloud, and the one place this is used — the private link — has to
   * be all three. It also drops the character counter, because a count is
   * a warning about running out of room and there is no room to run out of.
   */
  readonly?: boolean;
  onInput?: (value: string) => void;
}): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrap = el("label", "p-field");
  // An empty <span> still occupies a line box, which showed up as a gap
  // under "Link your duck" — a heading that names a field in one state and
  // a chip row in the other, so the field itself has no label of its own.
  if (opts.label) wrap.append(el("span", "p-field-label", opts.label));

  const input = opts.multiline ? el("textarea", "p-input") : el("input", "p-input");
  if (!opts.multiline) (input as HTMLInputElement).type = "text";
  input.placeholder = opts.placeholder;
  input.value = opts.value ?? "";
  // maxLength counts UTF-16 units and the server counts code POINTS, so an
  // emoji costs one there and two here. The server is the authority; this
  // is a courtesy that must not be stricter than it.
  input.maxLength = opts.max * 2;

  /*
   * ══ onInput FIRES ON INPUT, AND NOT BEFORE ══
   * This used to run the caller's handler once during construction, to
   * seed the character count. That handler almost always touches other
   * things in the same function — a hint, a scope picker, a preview — and
   * those are usually declared BELOW the field they belong to, so the call
   * landed in the temporal dead zone and threw.
   *
   * It happened three times: the contact screen, the pond's count, and
   * Card setup. Each was fixed by reordering the surrounding code, which
   * left the trap in place for the next screen.
   *
   * The initial count needs no handler — the caller passed the value in
   * and already knows it. So the count seeds itself and `onInput` means
   * what it says.
   */
  if (opts.readonly) {
    input.readOnly = true;
    // One tap arms the system Copy, instead of a long-press and a careful
    // drag across forty characters that must all be right.
    input.addEventListener("focus", () => input.select());
    wrap.append(input);
    return { wrap, input };
  }

  /*
   * ══ A FIELD YOU ARE TYPING IN HAS TO BE VISIBLE ══
   * The keyboard takes roughly half the screen, and any screen with a
   * header — a duck, a ring of bumpers — can have every one of its fields
   * below that line. Browsers mostly scroll a focused field into view, but
   * "mostly" is doing a lot of work: it varies by browser, by whether the
   * scroller is the page or an element, and by whether the visual viewport
   * changed at all.
   *
   * So it is done here, and only when it is actually needed — scrolling a
   * field that was already in view is a jump for no reason.
   *
   * After a beat, because the keyboard is still on its way in and the
   * viewport it is about to leave is not the one to measure against.
   */
  input.addEventListener("focus", () => {
    window.setTimeout(() => {
      if (document.activeElement !== input) return;
      const box = input.getBoundingClientRect();
      const room = window.visualViewport?.height ?? window.innerHeight;
      if (box.top >= 0 && box.bottom <= room) return;
      input.scrollIntoView({ block: "center" });
    }, KEYBOARD_SETTLE_MS);
  });

  const count = el("span", "p-field-count");
  const showCount = () => {
    const points = [...input.value].length;
    count.textContent = `${points}`;
    count.classList.toggle("over", points > opts.max);
  };
  input.addEventListener("input", () => {
    showCount();
    opts.onInput?.(input.value);
  });
  showCount();

  wrap.append(input, count);
  return { wrap, input };
}

/**
 * A sheet that rises from the bottom, over the water.
 *
 * The pond stays visible above it — that is what makes the duck being
 * decorated feel like it is going somewhere specific rather than being
 * configured in a form. The first version replaced the whole viewport with
 * a flat panel, which looked tidy and lost the entire idea.
 *
 * The three strips are a dithered edge at 25%, 50% and 75% coverage, so
 * the panel dissolves into the water on the same 4px grid everything else
 * is drawn on instead of meeting it on a hard line.
 */
/**
 * The dithered edge: three 4px strips at 25%, 50% and 75% coverage.
 *
 * Anything that rises out of the water wears one, so a panel does not meet
 * the pond on a hard line — it dissolves into it on the same 4px grid the
 * ducks are drawn on. Its own function because the duck's card needs it
 * too, and a card that meets the water on a straight edge is the one shape
 * on screen that could not have been drawn on the grid.
 */
export function ditherEdge(): HTMLElement {
  const edge = el("div", "p-edge");
  edge.append(el("i", "p-d25"), el("i", "p-d50"), el("i", "p-d75"));
  return edge;
}

export function sheet(centred = false): { root: HTMLElement; body: HTMLElement } {
  const root = el("div", `p-screen${centred ? " p-centre" : ""}`);
  const edge = ditherEdge();
  const body = el("div", `p-sheet-body${centred ? " p-centre" : ""}`);
  root.append(edge, body);
  return { root, body };
}

/**
 * A full screen — the container almost everything in this flow belongs in.
 *
 * ══ A SHEET IS NOT A SCREEN ══
 * These were bottom sheets over the live pond, which looked right and was
 * the wrong container. The prototype has NINE full views and exactly one
 * modal, and the reason shows up the moment somebody types: a sheet with a
 * text field in it, on a phone with the keyboard open, has almost no room
 * left. Reading and filling in are what these screens are FOR.
 *
 * The padding is the prototype's, including its own note about it — 20px
 * at the sides rather than 16, because at 16 the text runs to the bezel and
 * every screen reads as crowded.
 *
 * `spacer()` between the content and the actions is what puts the buttons
 * at the bottom of the screen instead of under the last paragraph.
 */
export function view(): { root: HTMLElement; body: HTMLElement } {
  const root = el("div", "p-view");
  const body = el("div", "p-view-pad");
  root.append(body);
  return { root, body };
}

/** Eats the space between what you read and what you press. */
export function spacer(): HTMLElement {
  return el("div", "p-spacer");
}

/**
 * The back / title / forward strip at the top of a working screen.
 *
 * Its own element rather than three buttons in a row: the title has to be
 * centred against two controls of different widths, which only works if
 * something owns the whole line.
 */
export function nav(
  back: { label: string; onClick: () => void },
  title: string,
  forward?: { label: string; onClick: () => void },
): HTMLElement {
  const strip = el("div", "p-nav");
  strip.append(
    button("p-nav-btn", back.label, back.onClick),
    el("span", "p-nav-title", title),
  );
  if (forward) strip.append(button("p-nav-btn", forward.label, forward.onClick));
  return strip;
}

/**
 * Render a screen, and never leave a blank page behind.
 *
 * Every screen starts with `replaceChildren()`, so a throw ANYWHERE after
 * that point empties the root and renders nothing — no error text, no
 * fallback, nothing to search for and nothing a person could report beyond
 * "it went white". That is the worst way for a bug to present, and it
 * happened: a temporal-dead-zone reference in the contact screen.
 *
 * This does not make the bug not happen. It makes it VISIBLE, which is the
 * part that was missing.
 */
export function screen(root: HTMLElement, render: () => void): void {
  try {
    render();
  } catch (err) {
    console.error("[pond] screen failed", err);
    root.replaceChildren();
    const s = sheet(true);
    s.body.append(
      el("p", "p-title", "Something went wrong"),
      el("p", "p-body", "Nothing you made has been lost. Reload to pick it back up."),
      button("p-btn", "Reload", () => location.reload()),
    );
    root.append(s.root);
  }
}
