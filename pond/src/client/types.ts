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
  /*
   * Yours, as far as this browser knows. Never sent by the server — the
   * pond payload is public and says nothing about who anybody is — it is
   * written on the client once the private link has resolved to an id, so
   * the tag can be drawn over your own duck.
   */
  mine?: boolean;
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
  /**
   * The fire on this duck, if it is alight — identity and time remaining.
   *
   * `litAt` names this particular fire, so a client can tell "the one I just
   * put out" from "a new one". `burnsFor` is SECONDS REMAINING, not an end
   * time, so a phone with a wrong clock still counts down correctly.
   */
  fire: { litAt: number; burnsFor: number } | null;
  say: { text: string; at: number } | null;
  /** "via Sam", or nothing at all. */
  keeper: string | null;
}
