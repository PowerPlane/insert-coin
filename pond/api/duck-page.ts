/**
 * `/d/<slug>` — a duck's public page, server-rendered so a link shared into
 * a chat shows the duck's own name and message.
 *
 * The rewrite passes the slug as a query parameter rather than leaving it
 * in the path, because a rewritten request's path is the destination, not
 * what the visitor typed.
 */

import { loadEnv, guard } from "../src/worker/env";
import { duckPage } from "../src/worker/pages";

export default {
  fetch: (req: Request): Promise<Response> =>
    guard(async () => {
      const slug = new URL(req.url).searchParams.get("slug") ?? "";
      return duckPage(req, await loadEnv(), slug);
    }),
};
