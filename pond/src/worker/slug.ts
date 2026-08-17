/**
 * Readable duck URLs.
 *
 * Three separate things, deliberately:
 *
 *   name      the words on the duck. Free text, duplicates fine, may be empty.
 *   slug      the URL at /d/<slug>. Unique, readable, renameable.
 *   edit_key  the credential. Secret, unguessable, never shown publicly.
 *
 * ══ WHY THE SLUG IS NOT THE CREDENTIAL ══
 * If the readable URL were also the edit link, `/d/sam` would be guessable
 * and anyone could delete anyone's duck. The slug is a *public* address —
 * shareable on purpose. Editing lives behind `/e/<edit_key>`.
 *
 * ══ WHY IT IS AUTO-ASSIGNED ══
 * Nobody should have to invent a unique name to release a duck; that puts
 * friction on the most important step in the flow. Every duck gets a good
 * name for free and can rename later, which is how Notion, Linear and Vercel
 * all handle it.
 */

import type { Env } from "./types.js";

/**
 * Pond-flavoured word lists. Adjective + noun is the pattern Docker, Heroku
 * and gfycat all settled on, because two words are short enough to say aloud
 * and read off a screen.
 *
 * Curated rather than generated: every pair has to be pleasant, and no word
 * may combine into something unkind. 120 × 80 = 9,600 combinations, and the
 * numeric suffix below covers the rest.
 */
const ADJECTIVES = [
  "amber","ancient","autumn","balmy","bashful","billowy","blithe","bold",
  "bonny","brave","breezy","briny","bright","brisk","calm","candid",
  "cheerful","chipper","clever","cosy","crisp","curious","dainty","damp",
  "dappled","dawn","deep","dewy","dizzy","dreamy","drifting","dusky",
  "eager","early","easy","fabled","faithful","fearless","feathered","fleet",
  "floating","fond","frosty","gentle","gilded","glassy","gleaming","golden",
  "hazy","hearty","hidden","honest","hopeful","humble","idle","jolly",
  "keen","kindly","lively","lucky","lunar","merry","mild","misty",
  "mossy","nimble","noble","olden","paddling","patient","pearly","placid",
  "plucky","polite","quiet","rainy","rapid","reedy","restful","ripe",
  "rosy","rustic","salty","sandy","seaside","shady","silken","silver",
  "sleepy","snug","soft","solar","spry","stately","steady","stormy",
  "sunny","sunlit","swift","tender","tidal","tranquil","trusty","twilit",
  "velvet","verdant","wandering","warm","watchful","wavy","whispering","willow",
  "windy","winsome","wistful","witty","woolly","yonder","zesty","zippy",
];

const NOUNS = [
  "acorn","bank","bay","beacon","bloom","boat","bream","brook",
  "bulrush","canoe","cattail","channel","cove","creek","current","dabble",
  "dawn","delta","dew","dinghy","drift","eddy","ferry","fern",
  "float","ford","frond","gull","harbour","heron","inlet","islet",
  "jetty","kelp","lagoon","lantern","lily","lilypad","marsh","meadow",
  "mill","minnow","mist","moor","oar","otter","paddle","pebble",
  "pier","plume","pool","quay","raft","rapids","reed","reef",
  "ripple","river","rudder","rush","sail","sedge","shallow","shell",
  "shoal","shore","skiff","sluice","spring","stone","stream","surf",
  "swell","tide","willow","wake","water","wave","weir","wharf",
];

const pick = <T,>(list: readonly T[]): T =>
  list[crypto.getRandomValues(new Uint32Array(1))[0]! % list.length]!;

/**
 * Slugs that would be confusing or would shadow something. Checked before a
 * user-chosen slug is accepted; the generator can't produce these anyway.
 */
const RESERVED = new Set([
  "admin","api","new","edit","delete","settings","about","help","login",
  "logout","signup","d","e","p","pond","duck","ducks","index","robots",
  "sitemap","favicon","static","assets","null","undefined","me","you",
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;

/** Normalise anything a person types into a legal slug, or null. */
export function normaliseSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // spaces, punctuation, emoji → separator
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (s.length < SLUG_MIN || s.length > SLUG_MAX) return null;
  if (RESERVED.has(s)) return null;
  // Reject an all-digit slug: it reads as an id and invites people to guess
  // neighbours by counting.
  if (/^\d+$/.test(s)) return null;
  return s;
}

export function randomSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

export async function slugTaken(env: Env, slug: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS x FROM ducks WHERE slug = ?1`)
    .bind(slug)
    .first<{ x: number }>();
  return Boolean(row);
}

/**
 * A free slug.
 *
 * Tries clean two-word names first, so the first several thousand ducks all
 * get one. Only once the space is genuinely crowded does it fall back to a
 * numeric suffix — Heroku's approach, and it degrades gracefully instead of
 * failing.
 *
 * This is advisory only: the real guarantee is the UNIQUE index on
 * ducks.slug, which is what makes two simultaneous releases safe.
 */
export async function freeSlug(env: Env, attempts = 6): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const s = randomSlug();
    if (!(await slugTaken(env, s))) return s;
  }
  const base = randomSlug();
  for (let n = 2; n < 500; n++) {
    const s = `${base}-${n}`;
    if (!(await slugTaken(env, s))) return s;
  }
  // Pathological only. Still readable, still unique.
  return `${base}-${Date.now().toString(36)}`;
}

export const SLUG_SPACE = ADJECTIVES.length * NOUNS.length;
