/**
 * The two languages, held level.
 *
 * Coverage itself is not tested here — `ZH_HANT` is typed
 * `Record<StringKey, string>`, so a missing or misspelled key is a
 * compile error and `npm run typecheck` has already refused it.
 *
 * What the compiler cannot see is whether a translation still SAYS the same
 * thing. These check the two ways it can quietly stop:
 *
 *   * a dropped `{placeholder}` — "被戳 次" instead of "被戳 5 次", which
 *     reads as a typo rather than as missing data, and
 *   * an invented one, which never substitutes and ships a literal `{n}`.
 */

import { describe, expect, it } from "vitest";
import {
  EN, KEEPER_STRINGS, LIVE_STRINGS, SCOPE_STRINGS, ZH_HANT,
  fortuneTitle, setLang, t,
} from "../src/client/strings.js";

const ENGLISH: Record<string, string> = {
  ...EN,
  ...KEEPER_STRINGS,
  ...SCOPE_STRINGS,
  ...LIVE_STRINGS,
};

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("繁體中文", () => {
  it("carries exactly the placeholders the English does", () => {
    const drifted = Object.keys(ENGLISH)
      .map((key) => ({
        key,
        en: placeholders(ENGLISH[key]!),
        zh: placeholders(ZH_HANT[key as keyof typeof ZH_HANT]),
      }))
      .filter(({ en, zh }) => en.join() !== zh.join());

    // Reported as a list rather than one at a time: if a batch of strings
    // is edited, seeing all of them beats fixing one and re-running.
    expect(drifted).toEqual([]);
  });

  it("says something for every key", () => {
    const blank = Object.entries(ZH_HANT).filter(([, v]) => v.trim() === "");
    expect(blank).toEqual([]);
  });

  it("is actually different from English where it should be", () => {
    /*
     * A table filled in by copying English would pass every check above.
     * The entries that SHOULD match are names, URLs, glyphs and the two
     * language buttons — written out on purpose so that "identical" and
     * "nobody has translated this yet" stay distinguishable.
     */
    const identical = Object.keys(ENGLISH).filter(
      (k) => ENGLISH[k] === ZH_HANT[k as keyof typeof ZH_HANT],
    );
    expect(identical.sort()).toEqual([
      "keeper.05", // Sam — an example name
      "keeper.13", // English — a language names itself
      "keeper.14", // 繁體中文 — likewise
      "manage.06", // an edit-key URL
      "pond.07", // +
      "pond.09", // −
      "pond.18", // an edit-key URL
      "pond.25", // Mika — an example name
      "sign.04", // Sam — an example name
      "sign.05", // 0 — a character count
      "studio.13", // 1×
      "studio.14", // 2×
    ]);
  });
});

describe("t()", () => {
  // The default language, since setLang needs a document and this does not.
  it("substitutes by name and leaves unknown braces alone", () => {
    expect(t("live.via", { keeper: "Sam" })).toBe("via Sam");
    expect(t("live.count", {})).toBe("{n} ducks");
  });

  it("returns English for a key with no translation, never the key itself", () => {
    // The fallback is the whole reason a half-finished table is safe to
    // ship: a reader sees words, not machinery.
    expect(t("arrival.02")).toBe("大吉 · Great luck");
    expect(t("nope.99" as never)).toBe("");
  });
});

describe("a fortune's name", () => {
  /*
   * The arrival heading used to be built as `${jp} · ${en}` in the screen
   * itself, which meant it stayed half-English no matter what language the
   * reader had asked for — the one heading on the loudest screen in the
   * product, and the string table could not reach it.
   */
  it("is glossed for an English reader", () => {
    setLang("en");
    expect(fortuneTitle(0)).toBe("大吉 · Great luck");
    expect(fortuneTitle(3)).toBe("凶 · Bad luck");
  });

  it("is not glossed for a 繁體中文 reader — it is already their language", () => {
    setLang("zh-Hant");
    expect(fortuneTitle(0)).toBe("大吉");
    expect(fortuneTitle(3)).toBe("凶");
    setLang("en");
  });

  it("falls back to 小吉 rather than showing nothing for a bad index", () => {
    // The fortune is a number off a card that anyone can retype.
    setLang("en");
    expect(fortuneTitle(99)).toBe("小吉 · Little luck");
    expect(fortuneTitle(-1)).toBe("小吉 · Little luck");
  });
});
