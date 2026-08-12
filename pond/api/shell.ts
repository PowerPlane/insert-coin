/**
 * `/` — the pond. Reached by a rewrite in vercel.json.
 *
 * There is no `public/index.html`, and that absence is load-bearing: the
 * CDN serves a static file before a function is ever invoked, so an
 * index.html here would mean `/` could never exchange a tap for a session.
 * See src/worker/shell.ts.
 */

import { loadEnv, guard } from "../src/worker/env";
import { pondPage } from "../src/worker/pages";

export default {
  fetch: (req: Request): Promise<Response> => guard(async () => pondPage(req, await loadEnv())),
};
