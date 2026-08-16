/**
 * Pixel glyphs — the same hand as the ducks.
 *
 * ══ WHY NOT EMOJI, AND WHY NOT A FONT ══
 * Emoji render differently on every platform and sit oddly next to flat
 * pixel art; an icon font is a download for six shapes. These are drawn the
 * way everything else here is drawn, so a toolbar belongs to the same world
 * as the water.
 *
 * Sizes are the ones each glyph was AUTHORED at and are not reducible. The
 * gear is the icons8 pixel gear at its native 26 — eight teeth on a stepped
 * ring around a hollow hub — and halving it turns it into a mandala, so the
 * grid stays and the DISPLAY size is set in CSS. Same reason the chat
 * bubble is 27: its tail is drawn, not implied.
 *
 * Ported from the prototype rather than redrawn, and extracted mechanically
 * rather than retyped, because a pixel moved by hand is a pixel moved.
 */

export const ICONS = {
  chat: [
    "...........................",
    "...........................",
    "...kkkkkkkkkkkkkkkkkkkkk...",
    "...kkkkkkkkkkkkkkkkkkkkk...",
    "...kkkkkkkkkkkkkkkkkkkkk...",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "kkk.....................kkk",
    "...kkkkkkkkkkkkkkkkkk...kkk",
    "...kkkkkkkkkkkkkkkkkk...kkk",
    "...kkkkkkkkkkkkkkkkkk...kkk",
    ".....................kkkkkk",
    ".....................kkkkkk",
    ".....................kkkkkk",
    "........................kkk",
    "........................kkk",
    "........................kkk",
    "...........................",
  ],
  gear: [
    "............kk............",
    "............kk............",
    "..........kk..kk..........",
    ".....kkk..kk..kk..kkk.....",
    ".....kkk..kk..kk..kkk.....",
    "...kk...kk......kk...kk...",
    "...kk...kk......kk...kk...",
    "...kk................kk...",
    ".....kk............kk.....",
    ".....kk....kkkk....kk.....",
    "..kkk......kkkk......kkk..",
    "..kkk....kk....kk....kkk..",
    "kk.......kk....kk.......kk",
    "kk.......kk....kk.......kk",
    "..kkk....kk....kk....kkk..",
    "..kkk......kkkk......kkk..",
    ".....kk....kkkk....kk.....",
    ".....kk............kk.....",
    "...kk................kk...",
    "...kk...kk......kk...kk...",
    "...kk...kk......kk...kk...",
    ".....kkk..kk..kk..kkk.....",
    ".....kkk..kk..kk..kkk.....",
    "..........kk..kk..........",
    "............kk............",
    "............kk............",
  ],
  home: [
    "...........................",
    "...........................",
    ".............k.............",
    "............kkk............",
    "...........kkkkk...........",
    "..........kkkkkkk..........",
    ".........kkkkkkkkk.........",
    "........kkkkkkkkkkk........",
    ".......kkkkkkkkkkkkk.......",
    "......kkkkkkkkkkkkkkk......",
    ".....kkkkkkkkkkkkkkkkk.....",
    "....kkkkkkkkkkkkkkkkkkk....",
    "...kkkkkkkkkkkkkkkkkkkkk...",
    "...........................",
    "....kkkkkkkkkkkkkkkkkkk....",
    "....kk...............kk....",
    "....kk.....kkkkkkk...kk....",
    "....kk.....kk...kk...kk....",
    "....kk.....kk...kk...kk....",
    "....kk.....kk...kk...kk....",
    "....kk.....kk...kk...kk....",
    "....kkkkkkkkkkkkkkkkkkk....",
    "...........................",
    "...........................",
    "...........................",
    "...........................",
    "...........................",
  ],
  /*
   * ══ IT HAD TO POINT THE OTHER WAY ══
   * The first drawing put the arrowhead at the TOP, apex up, with the tail
   * curling away to the right and down. Read at 22px that is "up and
   * over" — a forward motion — and it was reported as looking like REDO,
   * by somebody who then described the broken button as the redo button.
   *
   * An undo arrow has to point BACK. The head is now a left-pointing
   * triangle, unmistakable at this size because it is the widest thing in
   * the glyph, and the shaft runs right, turns down and hooks — the
   * return-arrow shape, which is the one everybody already knows.
   */
  undo: [
    "...k.....",
    "..kk.....",
    ".kkkkkkkk",
    "..kk....k",
    "...k....k",
    "........k",
    "........k",
    "......kkk",
    ".........",
  ],
  clear: [
    "..kkkkk..",
    ".........",
    "kkkkkkkkk",
    ".k.....k.",
    ".k.k.k.k.",
    ".k.k.k.k.",
    ".k.k.k.k.",
    ".kkkkkkk.",
    ".........",
  ],
  dice: [
    "kkkkkkkkk",
    "k.......k",
    "k.k...k.k",
    "k.......k",
    "k...k...k",
    "k.......k",
    "k.k...k.k",
    "k.......k",
    "kkkkkkkkk",
  ],} as const;

export type IconName = keyof typeof ICONS;

/**
 * A glyph as a canvas, sized in CSS pixels.
 *
 * `image-rendering: pixelated` in the stylesheet is what keeps it crisp at
 * any display size, so the canvas is drawn at its authored grid and scaled
 * by the box rather than being redrawn per size.
 */
export function icon(name: IconName, css = 24, colour = "currentColor"): HTMLCanvasElement {
  const rows = ICONS[name];
  const n = rows.length;
  const c = document.createElement("canvas");
  c.className = "p-icon";
  c.width = n;
  c.height = n;
  c.style.width = `${css}px`;
  c.style.height = `${css}px`;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  /*
   * `currentColor` is not a canvas colour, so it is resolved by the caller
   * through CSS on the element instead — the default here is a literal that
   * only works once the canvas is in the document. Callers that need a
   * specific ink pass one.
   */
  ctx.fillStyle = colour === "currentColor" ? "#0b3d52" : colour;
  for (let y = 0; y < n; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
