/**
 * Knowing when an element actually changed size.
 *
 * ══ `window.resize` IS NOT ENOUGH, AND THE PHONE IS WHERE IT SHOWS ══
 * The pond's canvas sizes its backing store from its own box. That is right
 * when it runs — but it only ran on `window`'s resize event, and on iOS
 * Safari the URL bar collapsing or expanding does NOT fire one. It moves the
 * VISUAL viewport while the layout viewport stands still.
 *
 * So the CSS box grew, the bitmap did not, and the browser stretched one to
 * fit the other: every duck and every dither pixel smeared vertically while
 * the horizontal stayed sharp. It reproduced on a real iPhone within one tap
 * and never once in a desktop browser at a fixed window size, because
 * nothing there ever changed the height without also firing `resize`.
 *
 * The fix is to stop asking the window what happened and observe the element
 * itself. `ResizeObserver` fires on any box change whatever caused it —
 * toolbar, rotation, keyboard, a stylesheet loading late.
 *
 * `visualViewport` is kept as a second signal because it is the one event
 * iOS reliably sends for a toolbar move, and a belt here is cheap: the
 * callback is idempotent, and PondView.resize() returns immediately when
 * nothing changed.
 *
 * The device-pixel-ratio watch is for dragging a window between a laptop
 * screen and an external monitor — the box does not change, only what a
 * pixel means, so nothing above would notice.
 */

/** Stop watching. */
export type Unwatch = () => void;

export function watchSize(el: Element, onChange: () => void): Unwatch {
  const stops: Unwatch[] = [];

  // The element's own box — the signal that actually matters.
  const ro = new ResizeObserver(() => onChange());
  ro.observe(el);
  stops.push(() => ro.disconnect());

  // iOS toolbar moves. Passive: this never prevents a default.
  const vv = window.visualViewport;
  if (vv) {
    const on = () => onChange();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    stops.push(() => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    });
  }

  // A move between displays changes what a CSS pixel is worth without
  // changing any box. matchMedia is the only event for it, and the query
  // has to be rebuilt each time because it tests one exact ratio.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = (): void => {
    dprQuery?.removeEventListener("change", onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", onDpr);
  };
  const onDpr = (): void => {
    onChange();
    watchDpr();
  };
  watchDpr();
  stops.push(() => dprQuery?.removeEventListener("change", onDpr));

  return () => stops.forEach((stop) => stop());
}
