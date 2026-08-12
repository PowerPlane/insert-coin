export interface Sticker {
  id: string;
  x: number;
  y: number;
}

/** A duck as the pond endpoint returns it. Note what is absent. */
export interface PondDuck {
  id: string;
  fortune: number;
  tint: number;
  stickers: Sticker[];
  paint: string;
  name: string;
  message: string;
  created: number;
  waves: number;
  rescues: number;
  burning: boolean;
  say: { text: string; at: number } | null;
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
