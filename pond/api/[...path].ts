/**
 * Everything under /api.
 *
 * A catch-all by FILENAME rather than a rewrite, deliberately: a rewrite
 * would hand the function its destination path instead of the one the
 * visitor asked for, and this router dispatches on the path. `api/sweep.ts`
 * still wins for `/api/sweep` — a named file beats a catch-all.
 *
 * The whole file is three lines because the router knows nothing about
 * Vercel. That is the point of it.
 */

import { loadEnv, guard } from "../src/worker/env";
import { handle } from "../src/worker/index";

export default {
  fetch: (req: Request): Promise<Response> => guard(async () => handle(req, await loadEnv())),
};
