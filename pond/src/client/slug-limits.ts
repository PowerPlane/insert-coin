/**
 * What makes a usable public address, as the server defines it.
 *
 * Stated here rather than imported from the worker: the client bundle must
 * not reach across into server code, and the server is the authority
 * anyway — these are a courtesy so somebody is told before they submit,
 * and they must never be STRICTER than what will actually be accepted.
 *
 * Kept in step with `SLUG_MIN` / `SLUG_MAX` in src/worker/slug.ts.
 */
export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
