/** Small shared helpers. No dependencies — this runs on Workers. */

export const nowSec = (): number => Math.floor(Date.now() / 1000);

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

/**
 * URL-safe random id. The alphabet omits 0/O/1/l/I so a card id can be read
 * off a silkscreen and typed without ambiguity.
 */
export function randomId(len = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Compare two strings without an early exit on the first differing
 * character, which is what would let someone forge a signature a byte at a
 * time.
 *
 * Honest caveat: this is best-effort, not a true constant-time primitive —
 * JS string indexing makes no timing guarantees, and the length check does
 * return early. That is acceptable here because both operands are
 * fixed-length hex digests, so the length branch carries no secret.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  // The pond is polled; let clients cache nothing by default.
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/**
 * The error responses take headers like every other response.
 *
 * They did not, and index.ts describes `securityHeaders()` as "applied to
 * every response" — so every 400 and 404 went out with no CSP, no
 * `referrer-policy: no-referrer`, no frame protection, and dropped the
 * pending visitor `set-cookie` on the floor. A 404 is a perfectly good
 * place to be handed a page that then leaks an edit key in a Referer.
 *
 * Optional so the signature stays convenient, but every caller in the
 * router passes them.
 */
export function badRequest(message: string, headers?: Headers): Response {
  return json({ error: message }, { status: 400, headers });
}

export function notFound(headers?: Headers): Response {
  return json({ error: "not found" }, { status: 404, headers });
}

/**
 * Normalise and clamp free text.
 *
 * - NFC-normalises so visually identical strings compare equal
 * - strips control characters and zero-width joiners, which are the usual
 *   way to smuggle invisible payloads or break layout
 * - collapses runs of whitespace
 * - counts by code POINTS, so an emoji costs one, not four
 */
export function cleanText(input: unknown, maxCodePoints: number): string {
  if (typeof input !== "string") return "";

  // Lone surrogates survive JSON and would corrupt anything downstream that
  // re-encodes; drop them before normalising.
  let s = input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

  s = s.normalize("NFC");

  // \p{Cc} control, \p{Cf} format (zero-width joiners, bidi overrides, tag
  // characters), \p{Cs} surrogate, \p{Co} private use, \p{Cn} unassigned.
  // \p{Cf} is the important one: it is how invisible payloads and
  // right-to-left layout attacks get smuggled into a display name.
  //
  // ZWJ (U+200D) and the variation selectors are deliberately kept —
  // stripping them breaks ordinary emoji like 👨‍👩‍👧 and ❤️.
  s = s.replace(/[\p{Cc}\p{Cs}\p{Co}\p{Cn}]/gu, "");
  s = s.replace(/[\p{Cf}]/gu, (ch) =>
    ch === "‍" || (ch >= "︀" && ch <= "️") ? ch : "",
  );

  s = s.replace(/\s+/g, " ").trim();

  // Count by code POINTS so an emoji costs one, not four — and so this
  // matches SQLite's length(), which is what the schema CHECK uses.
  const points = [...s];
  return points.length <= maxCodePoints ? s : points.slice(0, maxCodePoints).join("");
}

/** Parse a small non-negative integer from a query param. */
export function intParam(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  if (!/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Card ids and nonces come off a physical card; be strict about shape. */
export function safeToken(value: string | null, maxLen: number): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9]{1,32}$/.test(value) && value.length <= maxLen ? value : null;
}
