/**
 * `/flash` — reached by a rewrite, like every other HTML route.
 *
 * No `loadEnv()`: the page needs neither the database nor a secret, and a
 * missing TURSO_URL should not stop a friend flashing a card at a kitchen
 * table. The firmware file never reaches the server at all.
 */

import { guard } from "../src/worker/env.js";
import { flashPage } from "../src/worker/pages.js";

export default {
  fetch: (req: Request): Promise<Response> => guard(async () => flashPage(req)),
};
