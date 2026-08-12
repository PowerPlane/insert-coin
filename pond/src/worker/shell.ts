/**
 * The HTML shell — server-rendered, because three separate things need it
 * to be.
 *
 * On Cloudflare the document was a static asset fetched from a binding.
 * On Vercel the CDN serves `public/` before a function is ever invoked,
 * which would have made `/` unable to do the one thing it must do. So there
 * is deliberately NO `public/index.html`: every HTML route is a function.
 *
 * What that buys, in the order it matters:
 *
 *  1. **`/` can set a cookie.** The card's `?d=` is live for 300 seconds and
 *     decorating takes minutes, so the tap is exchanged for a session on the
 *     very first request. A statically served document cannot do that, and
 *     checking later means every duck dies on the submit button.
 *
 *  2. **`/d/<slug>` gets real link previews.** A duck shared into a chat
 *     should show its name and message, not the site's. That needs the
 *     og: tags in the response, not written in by script afterwards.
 *
 *  3. **`<html lang>` is correct before the page paints.** Several
 *     characters are drawn differently in Japanese and Traditional Chinese;
 *     with a Japanese face in the stack and no `lang`, a Chinese reader gets
 *     Japanese letterforms. Phase 6 adds the strings — this is the hook they
 *     hang on, and it costs nothing to get right now.
 */

import type { PublicDuck } from "./types.js";

/** The languages the pond speaks. `en` is the fallback, never a choice. */
export const LANGUAGES = ["en", "zh-Hant"] as const;
export type Language = (typeof LANGUAGES)[number];

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Pick a language.
 *
 * The card keeper sets a DEFAULT, not a lock: a visitor whose phone asks
 * for Traditional Chinese gets it whatever the keeper chose, because the
 * person holding the phone is the one who has to read it.
 */
export function pickLanguage(acceptLanguage: string | null, keeperDefault?: string | null): Language {
  const accepts = (acceptLanguage ?? "").toLowerCase();
  // zh-TW, zh-HK and zh-Hant all mean the same thing to us. zh-CN does not,
  // and falls through to English rather than being served the wrong script.
  if (/\bzh-(hant|tw|hk|mo)\b/.test(accepts)) return "zh-Hant";
  if (keeperDefault && LANGUAGES.includes(keeperDefault as Language)) {
    return keeperDefault as Language;
  }
  return "en";
}

export interface ShellOptions {
  lang: Language;
  title: string;
  description: string;
  /** Handed to the client as JSON so the first paint needs no round trip. */
  bootstrap: Record<string, unknown>;
  canonical?: string;
  noindex?: boolean;
}

/**
 * Serialise for an inline `<script type="application/json">`.
 *
 * `type="application/json"` is a data block, not executable script, so it
 * does not need a CSP nonce. It does still need `<` escaped: a duck's
 * message is user text, and `</script>` inside it would end the element
 * early and drop the rest of the document into the page as markup.
 */
function jsonBlock(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function renderShell(o: ShellOptions): string {
  const title = escapeHtml(o.title);
  const description = escapeHtml(o.description);
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${o.noindex ? '<meta name="robots" content="noindex, nofollow, noarchive">\n' : ""}${
    o.canonical ? `<link rel="canonical" href="${escapeHtml(o.canonical)}">\n` : ""
  }<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#8ecae6">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="pond"></div>
<script type="application/json" id="pond-bootstrap">${jsonBlock(o.bootstrap)}</script>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

/** The pond itself. */
export function pondShell(lang: Language, bootstrap: Record<string, unknown>): string {
  return renderShell({
    lang,
    title: "The pond",
    description: "Tap a card, get a fortune, decorate a duck, put it in the water.",
    bootstrap: { view: "pond", ...bootstrap },
  });
}

/**
 * A duck's public page.
 *
 * The description is the duck's own words where it has any, because that is
 * what makes a shared link worth opening. Never the card serial, never a
 * contact — see the note on PublicDuck.
 */
export function duckShell(lang: Language, duck: PublicDuck, origin: string): string {
  const who = duck.name || "A duck";
  const said = duck.message || "in the pond";
  return renderShell({
    lang,
    title: `${who} · the pond`,
    description: said,
    canonical: `${origin}/d/${duck.slug}`,
    bootstrap: { view: "duck", duck },
  });
}

/** The private edit page. Never indexed, and never server-renders the duck. */
export function editShell(lang: Language, editKey: string): string {
  return renderShell({
    lang,
    title: "Your duck · the pond",
    description: "Your duck.",
    noindex: true,
    // The key is handed to the client and nothing else is: this document is
    // a bearer URL, so the less of the duck that is baked into it, the less
    // there is sitting in a browser cache or a screenshot.
    bootstrap: { view: "edit", editKey },
  });
}
