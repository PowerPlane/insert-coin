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
  label: string;
  placeholder: string;
  max: number;
  value?: string;
  multiline?: boolean;
  onInput?: (value: string) => void;
}): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const wrap = el("label", "p-field");
  wrap.append(el("span", "p-field-label", opts.label));

  const input = opts.multiline ? el("textarea", "p-input") : el("input", "p-input");
  if (!opts.multiline) (input as HTMLInputElement).type = "text";
  input.placeholder = opts.placeholder;
  input.value = opts.value ?? "";
  // maxLength counts UTF-16 units and the server counts code POINTS, so an
  // emoji costs one there and two here. The server is the authority; this
  // is a courtesy that must not be stricter than it.
  input.maxLength = opts.max * 2;

  const count = el("span", "p-field-count");
  const sync = () => {
    const points = [...input.value].length;
    count.textContent = `${points}`;
    count.classList.toggle("over", points > opts.max);
    opts.onInput?.(input.value);
  };
  input.addEventListener("input", sync);
  sync();

  wrap.append(input, count);
  return { wrap, input };
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
    const wrap = el("div", "p-screen p-centre");
    wrap.append(
      el("p", "p-title", "Something went wrong"),
      el("p", "p-body", "Nothing you made has been lost. Reload to pick it back up."),
      button("p-btn", "Reload", () => location.reload()),
    );
    root.append(wrap);
  }
}
