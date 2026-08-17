/**
 * The water buffer, and the one rule about it that cannot be checked by
 * running anything.
 *
 * ══ WHY THIS IS A SOURCE TEST ══
 * The defect it guards is an ORDER of two statements inside `draw()`, and
 * `draw()` needs a real 2D context — jsdom has none, and adding a native
 * canvas to the test dependencies to assert a line order would be a large
 * price for a small check. `deploy-shape.test.ts` already establishes the
 * idiom here: when the thing that can be wrong is the shape of the source,
 * read the source.
 *
 * ══ WHAT WENT WRONG ══
 * `drawWater` painted the buffer, and `fitWater` — which REPLACES the
 * buffer when the zoom crosses a render-cell boundary — ran after it. The
 * replacement is allocated, not painted, so it is fully transparent, and
 * the water blit is the only thing that clears the canvas. One frame per
 * zoom step drew nothing at all, leaving the previous frame on screen
 * while the element's CSS scale had already moved: the pond, resampled to
 * the wrong size, for 16 ms. That is the flicker people saw on pinch.
 *
 * An instrumented build counted exactly one unpainted blit per zoom step
 * and zero while idle, which is how it was finally pinned down after two
 * wrong theories — both of which measured the camera model, where nothing
 * was ever wrong.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "..", "src", "client", "pond-view.ts"),
  "utf8",
);

/** The body of a method, from its signature to the closing brace. */
function methodBody(name: string): string {
  const start = source.indexOf(`private ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i);
  }
  throw new Error(`${name} never closes`);
}

describe("the water buffer is sized before it is painted", () => {
  it("fits the buffer to the zoom before drawing into it", () => {
    const body = methodBody("draw");
    const fit = body.indexOf("this.fitWater(");
    const paint = body.indexOf("drawWater(");
    expect(fit, "draw() should fit the water buffer").toBeGreaterThan(-1);
    expect(paint, "draw() should paint the water buffer").toBeGreaterThan(-1);
    expect(
      fit,
      "fitWater must run BEFORE drawWater — swapping them blits a buffer " +
        "that was never painted, and the water blit is what clears the canvas",
    ).toBeLessThan(paint);
  });

  it("blits after painting, never before", () => {
    const body = methodBody("draw");
    expect(body.indexOf("drawWater(")).toBeLessThan(body.indexOf("blitWater("));
  });

  it("paints anything it allocates, so no caller can hand over a blank one", () => {
    /*
     * `resize` also calls `fitWater`, nowhere near a draw. Ordering inside
     * `draw` is not enough on its own — the buffer has to leave `fitWater`
     * with pixels in it whoever asked.
     */
    const body = methodBody("fitWater");
    expect(body).toContain("createWaterBuffer(");
    const made = body.indexOf("createWaterBuffer(");
    const painted = body.indexOf("drawWater(");
    expect(painted, "fitWater must paint the buffer it allocates").toBeGreaterThan(-1);
    expect(painted).toBeGreaterThan(made);
  });

  it("has no clearRect, which is why all of the above matters", () => {
    /*
     * If somebody adds one, this test is the note explaining that the
     * comments above are now describing a rule that no longer bites — and
     * that the cheapest fix for a future frame-clearing bug is a
     * clearRect, not another ordering rule.
     */
    // A CALL, not the word — the comments above discuss it by name, and a
    // test that its own explanation can fail is worse than no test.
    expect(source).not.toMatch(/\.clearRect\s*\(/);
  });
});
