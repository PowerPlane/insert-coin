/**
 * `/e/<key>` — the private edit page. The URL is the credential.
 *
 * noindex is set here AND in vercel.json. Belt and braces on purpose: this
 * is the one header whose absence cannot be noticed until a bearer URL is
 * already in a search index, at which point it is too late to fix.
 */

import { loadEnv, guard } from "../src/worker/env";
import { editPage } from "../src/worker/pages";

export default {
  fetch: (req: Request): Promise<Response> =>
    guard(async () => {
      const key = new URL(req.url).searchParams.get("key") ?? "";
      return editPage(req, await loadEnv(), key);
    }),
};
