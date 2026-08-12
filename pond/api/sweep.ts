/**
 * The daily cron, declared in vercel.json as `0 4 * * *`.
 *
 * Vercel Hobby crons run once per day and a finer expression fails AT
 * DEPLOY TIME — it is a hard error, not a silent degradation. That shaped
 * the whole design: fires ignite on read inside GET /api/pond and go out by
 * arithmetic, so nothing here is time-sensitive. All this does is stop
 * three tables growing forever.
 *
 * ══ THE BEARER CHECK IS NOT OPTIONAL ══
 * Vercel sends CRON_SECRET as a bearer token. Without checking it, this is
 * a public endpoint that deletes rows, and anyone who reads vercel.json in
 * the repository knows its path.
 */

import { loadEnv, guard } from "../src/worker/env.js";
import { scheduled } from "../src/worker/index.js";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Refuse rather than run unauthenticated. A cron that never fires is a
  // table that grows; a cron anyone can fire is a table anyone can empty.
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export default {
  fetch: (req: Request): Promise<Response> =>
    guard(async () => {
      if (!authorised(req)) {
        return new Response("not found", { status: 404 });
      }
      await scheduled(await loadEnv());
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }),
};
