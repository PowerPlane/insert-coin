export interface Sticker {
  id: string;
  x: number;
  y: number;
}

/**
 * A duck as the pond endpoint returns it.
 *
 * Must stay in step with `PublicDuck` in src/worker/types.ts — that is the
 * server's copy of this shape and the one the tests assert against.
 *
 * Note what is absent: no contact, and no card serial. What a duck shows of
 * the card it came from is `keeper`, a name.
 */
export interface PondDuck {
  id: string;
  slug: string;
  fortune: number;
  tint: number;
  stickers: Sticker[];
  paint: string;
  name: string;
  message: string;
  created: number;
  bumps: number;
  rescues: number;
  burning: boolean;
  say: { text: string; at: number } | null;
  /** "via Sam", or nothing at all. */
  keeper: string | null;
}

/** The duck being built or edited locally. */
export interface DuckDraft {
  fortune: number;
  tint: number;
  stickers: Sticker[];
  paint: Uint8Array;
  name: string;
  message: string;
  contact: string;
  /** Only meaningful when `contact` is non-empty. */
  scope: "keeper" | "keeper_and_david";
}

export type ScreenName =
  | "arrival"
  | "reveal"
  | "studio"
  | "sign"
  | "contact"
  | "release"
  | "keep"
  | "pond"
  | "mine"
  | "manage"
  | "visitor"
  | "stale"
  | "offline";
