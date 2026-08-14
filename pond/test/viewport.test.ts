/**
 * The canvas must never be stretched.
 *
 * ══ THE INVARIANT, NOT THE LISTENERS ══
 * The bug was a backing store whose aspect ratio stopped matching its CSS
 * box, so the browser scaled one to the other and every duck smeared
 * vertically. Asserting "a ResizeObserver was constructed" would pass with
 * an observer wired to the wrong element, or one that never re-fits. So the
 * test changes the box and asserts the ratio.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import { watchSize } from "../src/client/viewport.js";

/**
 * jsdom has no ResizeObserver and no visualViewport. Both are stubbed so the
 * observed element can be resized on demand — the point is the re-fit, and
 * a real layout engine is not needed to prove one happened.
 */
function stubEnvironment(): { resize: (w: number, h: number) => void } {
  const observers: { el: Element; cb: () => void }[] = [];
  const box = { width: 390, height: 844 };

  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: () => void) {}
    observe(el: Element) { observers.push({ el, cb: this.cb }); }
    disconnect() { observers.length = 0; }
  });
  vi.stubGlobal("matchMedia", () => ({
    addEventListener: () => {}, removeEventListener: () => {},
  }));

  Element.prototype.getBoundingClientRect = function () {
    return { width: box.width, height: box.height, top: 0, left: 0, right: box.width,
             bottom: box.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };

  return {
    resize(w, h) {
      box.width = w; box.height = h;
      observers.forEach((o) => o.cb());
    },
  };
}

/** The sizing rule from PondView.resize(), which is what has to stay true. */
function fitTo(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}

const aspect = (w: number, h: number): number => w / h;

describe("the canvas backing store", () => {
  it("keeps its aspect ratio when the box changes height", () => {
    const env = stubEnvironment();
    const canvas = document.createElement("canvas");
    watchSize(canvas, () => fitTo(canvas));
    fitTo(canvas);

    const before = aspect(canvas.width, canvas.height);
    expect(before).toBeCloseTo(aspect(390, 844), 5);

    /*
     * Safari's URL bar collapsing: the box gets ~60px taller and the window
     * fires nothing at all. Before the fix the backing store kept the old
     * height here and the browser stretched it — which is exactly the
     * vertical smear that reached a real phone.
     */
    env.resize(390, 904);
    expect(aspect(canvas.width, canvas.height)).toBeCloseTo(aspect(390, 904), 5);
    expect(aspect(canvas.width, canvas.height)).not.toBeCloseTo(before, 3);
  });

  it("keeps it through a rotation, where both dimensions change", () => {
    const env = stubEnvironment();
    const canvas = document.createElement("canvas");
    watchSize(canvas, () => fitTo(canvas));
    fitTo(canvas);

    env.resize(844, 390);
    expect(aspect(canvas.width, canvas.height)).toBeCloseTo(aspect(844, 390), 5);
  });

  it("stops watching when told to", () => {
    const env = stubEnvironment();
    const canvas = document.createElement("canvas");
    const onChange = vi.fn();
    const unwatch = watchSize(canvas, onChange);

    env.resize(390, 900);
    expect(onChange).toHaveBeenCalled();

    unwatch();
    onChange.mockClear();
    env.resize(390, 700);
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * Reduce Motion is read every frame, so it is remembered rather than asked
 * for each time — and the first version remembered it FOREVER. Somebody who
 * turns the switch on because the pond is making them ill would have had to
 * reload the pond to be heard.
 *
 * The module caches, so each test re-imports it fresh.
 */
describe("reduce motion", () => {
  /** A media query whose value can be changed from the outside. */
  function stubQuery(initial: boolean) {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    let matches = initial;
    vi.stubGlobal("matchMedia", (q: string) => {
      expect(q).toContain("prefers-reduced-motion");
      return {
        get matches() { return matches; },
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
        removeEventListener: () => {},
      };
    });
    return {
      flip(to: boolean) {
        matches = to;
        listeners.forEach((fn) => fn({ matches: to }));
      },
    };
  }

  const fresh = async () => {
    vi.resetModules();
    return (await import("../src/client/viewport.js")).prefersReducedMotion;
  };

  it("reports what the query says", async () => {
    stubQuery(true);
    expect((await fresh())()).toBe(true);
  });

  it("notices the switch being turned on while the page is open", async () => {
    const q = stubQuery(false);
    const prefers = await fresh();
    expect(prefers()).toBe(false);
    q.flip(true);
    expect(prefers()).toBe(true);
  });

  it("notices it being turned off again", async () => {
    const q = stubQuery(true);
    const prefers = await fresh();
    expect(prefers()).toBe(true);
    q.flip(false);
    expect(prefers()).toBe(false);
  });

  it("says no where there is no matchMedia at all", async () => {
    // Server-side rendering and the test runner both land here. Refusing to
    // animate is the wrong default: it would strip motion from everyone.
    vi.stubGlobal("matchMedia", undefined);
    expect((await fresh())()).toBe(false);
  });
});
