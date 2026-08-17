/**
 * How many bumps a duck card should claim.
 *
 * ══ TWO VIEWS OF ONE FACT, FROM TWO SOURCES ══
 * A duck card says how many bumps a duck has twice over, and gets the
 * number from two different places:
 *
 *   `duck.bumps`   — polled with the whole pond, every twenty seconds.
 *   `/api/bumpers` — its own request, made when the card opens.
 *
 * Between somebody bumping and the next poll, those disagree. The card
 * printed the first as a sentence and the second as a row of faces
 * underneath, so it could say "nobody has bumped it yet" directly above
 * four people who had.
 *
 * This is the fifth time in this project that a value derived from
 * something live has been read from a stale copy of it. The others were
 * caches; this one is two fetches, which is the same mistake wearing
 * different clothes.
 *
 * The rule: the named list wins when it knows more. It is the fresher
 * request and the more specific answer — it can name them — so it corrects
 * the sentence rather than sitting beneath it contradicting it.
 *
 * It only ever corrects UPWARD. A bumpers list is capped at the top few
 * senders (TOP_BUMPERS), so its total is a floor on the real count, never
 * a ceiling: a duck with fifty bumps from thirty people returns five rows
 * summing to well under fifty. Taking the larger of the two is therefore
 * not a preference, it is the only direction the arithmetic supports.
 */

/** One sender's contribution, as `/api/bumpers` reports it. */
export interface BumpShare {
  count: number;
}

/**
 * The count to show, given the polled figure and whoever is listed.
 *
 * Pure, so the rule can be checked without a card, a canvas or a clock.
 */
export function bumpsToShow(polled: number, bumpers: readonly BumpShare[]): number {
  const named = bumpers.reduce((n, b) => n + (Number.isFinite(b.count) ? b.count : 0), 0);
  // Not `Math.max` on its own: a negative or absent poll figure should not
  // be able to drag the total below what is actually on screen either.
  return Math.max(polled > 0 ? polled : 0, named > 0 ? named : 0);
}
