import type { Db } from "../db/types.js";

/**
 * Everything a request handler is given.
 *
 * `DB` is the D1-shaped interface from src/db, not a Cloudflare binding.
 * That indirection is the entire Cloudflare→Vercel port: these modules were
 * written against `prepare().bind().first()/run()/all()` and did not change
 * when the platform did.
 *
 * There is no `ASSETS` any more. On Workers the static site was a binding
 * you fetched from; on Vercel the CDN serves `public/` before a function is
 * ever invoked, and the HTML shell is rendered by src/worker/shell.ts —
 * which is what lets `/` set a session cookie, `/d/<slug>` carry real link
 * previews, and `<html lang>` be correct before Phase 6 adds 繁體中文.
 */
export interface Env {
  DB: Db;
  /** HMAC key for session cookies and visitor hashes. */
  SESSION_SECRET: string;
  /** Admin password. The secret path is obscurity; this is the actual auth. */
  ADMIN_PASSWORD: string;
}

/**
 * What the public pond endpoint returns.
 *
 * ══ NOTE WHAT IS NOT HERE ══
 * No contact, and no card id. The card serial is half of what a card claim
 * is keyed on (see BUILD-PLAN § The claim credential), so publishing it
 * would hand out one of the two things a forger needs. What a duck shows
 * instead is `keeper` — the NAME the card's current keeper chose, resolved
 * through card_epochs. "via Sam" tells a visitor something true and useful
 * and cannot be replayed at anything.
 *
 * `test/contacts-isolation.test.ts` asserts both absences.
 */
export interface PublicDuck {
  id: string;
  /** The readable public address, /d/<slug>. Not a credential. */
  slug: string;
  fortune: number;
  tint: number;
  stickers: { id: string; x: number; y: number }[];
  paint: string;
  name: string;
  message: string;
  created: number;
  /** Total bumps received. Derived from `bumps`, never a stored counter. */
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
  /** The card keeper's name — "via Sam" — or null. Never the serial. */
  keeper: string | null;
}
