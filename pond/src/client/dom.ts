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
export function field(opts: {
  /** Omitted when a heading above already names the field. */
  label?: string;
  placeholder: string;
  max: number;
  value?: string;
  multiline?: boolean;
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
