/**
 * The shared screen primitives.
 *
 * ══ WHY THIS FILE EXISTS ══
 * `field()` used to run the caller's `onInput` once during construction, to
 * seed its character count. Handlers passed to it reference their siblings —
 * a hint, a scope picker, a preview — and siblings are usually declared
 * BELOW the field they belong to, so that call landed in the temporal dead
 * zone and threw. It happened on the contact screen, on the pond's count,
 * and on Card setup, each time fixed by reordering the caller and each time
 * leaving the trap armed for the next screen.
 *
 * None of it was caught by a test, because until now nothing rendered a DOM.
 * `verify` stayed green through every one of them.
 *
 * The first test here is the one that matters: it builds a field exactly the
 * way the broken screens did — a handler closing over a `const` declared
 * after it — and it throws under the old behaviour.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import { button, el, field, screen, sheet } from "../src/client/dom.js";

describe("field()", () => {
  it("does not call onInput while it is being built", () => {
    const onInput = vi.fn();
    field({ label: "Name", placeholder: "Sam", max: 18, value: "David", onInput });
    // The caller passed "David" in. Telling them about it is not news, and
    // the telling is what used to run their code too early.
    expect(onInput).not.toHaveBeenCalled();
  });

  it("survives a handler that closes over a const declared after it", () => {
    /*
     * The exact shape of the bug, three times over. Under the old
     * behaviour this threw ReferenceError before `hint` was ever assigned;
     * the screens that did it went blank, because the throw landed after
     * their replaceChildren().
     */
    expect(() => {
      const f = field({
        label: "Name",
        placeholder: "Sam",
        max: 18,
        value: "David",
        onInput: (v) => {
          hint.textContent = v;
        },
      });
      const hint = el("p", "p-hint", "");
      return f;
    }).not.toThrow();
  });

  it("seeds the count from the value it was given", () => {
    const f = field({ label: "Name", placeholder: "Sam", max: 18, value: "David" });
    expect(f.wrap.querySelector(".p-field-count")?.textContent).toBe("5");
  });

  it("counts what a person sees, not UTF-16 units", () => {
    // The server counts code POINTS. An emoji costs one there, so it costs
    // one here — a courtesy that must never be stricter than the authority.
    const f = field({ label: "", placeholder: "", max: 10, value: "🦆🦆" });
    expect(f.wrap.querySelector(".p-field-count")?.textContent).toBe("2");
    expect((f.input as HTMLInputElement).maxLength).toBe(20);
  });

  it("reports and marks going over, and stops marking on the way back", () => {
    const count = () => f.wrap.querySelector(".p-field-count")!;
    const f = field({ label: "", placeholder: "", max: 3, value: "" });
    f.input.value = "abcd";
    f.input.dispatchEvent(new Event("input"));
    expect(count().textContent).toBe("4");
    expect(count().classList.contains("over")).toBe(true);

    f.input.value = "ab";
    f.input.dispatchEvent(new Event("input"));
    expect(count().classList.contains("over")).toBe(false);
  });

  it("passes the value on input, and only then", () => {
    const onInput = vi.fn();
    const f = field({ label: "", placeholder: "", max: 18, value: "", onInput });
    f.input.value = "Mika";
    f.input.dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith("Mika");
  });

  it("renders no label element when it has no label", () => {
    // An empty <span> still occupies a line box. It showed as a gap under
    // "Link your duck", where a heading above already names the field.
    const without = field({ placeholder: "Paste duck link", max: 200 });
    expect(without.wrap.querySelector(".p-field-label")).toBeNull();

    const withLabel = field({ label: "Card name", placeholder: "Sam", max: 18 });
    expect(withLabel.wrap.querySelector(".p-field-label")?.textContent).toBe("Card name");
  });

  it("is a <label>, so tapping the words focuses the input", () => {
    const f = field({ label: "Name", placeholder: "Sam", max: 18 });
    expect(f.wrap.tagName).toBe("LABEL");
    expect(f.wrap.contains(f.input)).toBe(true);
  });

  it("makes a textarea when asked, and a text input otherwise", () => {
    expect(field({ placeholder: "", max: 90, multiline: true }).input.tagName).toBe("TEXTAREA");
    const single = field({ placeholder: "", max: 18 }).input as HTMLInputElement;
    expect(single.tagName).toBe("INPUT");
    expect(single.type).toBe("text");
  });
});

describe("screen()", () => {
  it("shows something a person can act on when a render throws", () => {
    const root = el("div", "");
    // A screen that has already emptied itself, which is when this matters.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    screen(root, () => {
      root.replaceChildren();
      throw new Error("temporal dead zone, probably");
    });
    err.mockRestore();

    expect(root.textContent).toContain("Something went wrong");
    // Not lost, and a way out: the two things the blank page failed to say.
    expect(root.textContent).toContain("Nothing you made has been lost");
    expect(root.querySelector("button")?.textContent).toBe("Reload");
  });

  it("stays out of the way when nothing throws", () => {
    const root = el("div", "");
    screen(root, () => root.append(el("h2", "p-title", "Set up this card")));
    expect(root.querySelector(".p-title")?.textContent).toBe("Set up this card");
    expect(root.textContent).not.toContain("Something went wrong");
  });
});

describe("sheet()", () => {
  it("carries the dithered edge above the body", () => {
    const { root, body } = sheet();
    const edge = root.querySelector(".p-edge");
    expect(edge).not.toBeNull();
    // Three dither bands, lightest to heaviest — the water's bottom edge.
    expect([...edge!.children].map((c) => c.className)).toEqual(["p-d25", "p-d50", "p-d75"]);
    // Order matters: the edge is the top of the sheet, so it comes first.
    expect(root.firstElementChild).toBe(edge);
    expect(root.lastElementChild).toBe(body);
  });

  it("marks both halves when centred", () => {
    const { root, body } = sheet(true);
    expect(root.classList.contains("p-centre")).toBe(true);
    expect(body.classList.contains("p-centre")).toBe(true);
  });
});

describe("button()", () => {
  it("is type=button, so it never submits a form by accident", () => {
    const b = button("p-btn", "Save setup", () => {});
    expect(b.type).toBe("button");
  });

  it("calls its handler on click", () => {
    const onClick = vi.fn();
    button("p-btn", "Save setup", onClick).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
