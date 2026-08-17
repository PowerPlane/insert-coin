/**
 * `/pondkeeper` — reached by a rewrite, like every other HTML route.
 *
 * ══ NOT `api/admin.ts` ══
 * It was, and a file in `api/` beats the `/api/:path*` rewrite — so
 * `/api/admin` served this HTML page instead of reaching the router, and
 * the admin API answered 200 with a login screen to anyone who asked,
 * password gate and all. The page and the API it talks to must not share
 * a path. deploy-shape checks the rule now rather than trusting it.
 *
 * The page itself is served to anyone; everything it can DO is behind the
 * password, checked per request in the API. Serving a login form to a
 * stranger costs nothing, and gating the HTML would only move the same
 * check somewhere with a worse error message.
 */

import { loadEnv, guard } from "../src/worker/env.js";
import { adminPage } from "../src/worker/pages.js";

export default {
  fetch: (req: Request): Promise<Response> => guard(async () => adminPage(req, await loadEnv())),
};
