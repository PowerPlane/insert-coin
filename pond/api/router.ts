/**
 * Everything under /api.
 *
 * ══ WHY THIS IS A REWRITE AND NOT A CATCH-ALL FILENAME ══
 * This started as `api/[...path].ts`, on the reasoning that filename routing
 * would hand the router the real path and avoid a rewrite entirely. The
 * function built and deployed happily — and then matched exactly one path
 * segment. `/api/pond` worked; `/api/duck/by-slug/humble-lily` never reached
 * our code at all, returning Vercel's own `x-vercel-error: NOT_FOUND`.
 *
 * Vercel's zero-config `/api` directory supports a dynamic segment, but does
 * not expand `[...param]` across multiple segments the way framework routing
 * does. Half the API was unreachable, and nothing local could have said so.
 *
 * So `/api/*` is a rewrite in vercel.json, exactly like `/d/:slug` — the
 * pattern this config already used everywhere else. The cost is that a
 * rewritten request arrives carrying its DESTINATION path, not the one the
 * visitor typed, so the matched segments come back as `__path` and this file
 * reassembles them.
 *
 * That reassembly lives here and not in the router, because this file is the
 * only part of the codebase allowed to know what platform it is on.
 */

import { loadEnv, guard } from "../src/worker/env.js";
import { handle } from "../src/worker/index.js";

export default {
  fetch: (req: Request): Promise<Response> =>
    guard(async () => {
      const matched = new URL(req.url).searchParams.get("__path");
      // Absent means this file was requested directly at /api/router, which
      // is nobody's business but is harmless — the router 404s it.
      const path = matched === null ? undefined : `/api/${matched}`;
      return handle(req, await loadEnv(), path);
    }),
};
