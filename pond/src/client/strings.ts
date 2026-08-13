/**
 * Every word the product says, keyed by its id in docs/pond/COPY.md.
 *
 * ══ WHY THE KEYS EXIST NOW, WITH ONE LANGUAGE ══
 * Phase 6 adds 繁體中文. If the strings were inline in the screens, that
 * phase would be a refactor of every file; keyed here from the start it is a
 * table to fill in. The cost today is one indirection, and it buys the
 * property UI.md § 8 needs: `lang` correct before paint, strings chosen
 * from the same place.
 *
 * ══ COPY.md IS GENERATED, SO THIS FILE IS THE SOURCE ══
 * `tools/extract-copy.py` reads the UI and writes the deck. That direction
 * matters: a string that only exists in the deck is a string nobody ever
 * sees, and a string only in the UI is one nobody reviewed. Add words HERE,
 * then regenerate.
 *
 * User content is NEVER translated — a duck's name and message are its
 * author's, in whatever language they wrote them.
 */

export type Lang = "en" | "zh-Hant";

/**
 * The scope picker's words.
 *
 * Not in COPY.md: the deck predates the `david` / `keeper` /
 * `keeper_and_david` enum, which only became three-valued when the schema
 * was frozen. UI.md § 9 is the rule they follow — contact scope is stated
 * in NAMES, on every row, everywhere it appears. "shared with Sam and
 * David", never "scope: 2".
 *
 * `{keeper}` is substituted with the card keeper's name. When a card has no
 * keeper the middle option is not offered at all, because "shared with the
 * person who keeps this card" is not a sentence anyone can consent to.
 */
export const SCOPE_STRINGS = {
  "scope.01": "Who can see this",
  "scope.02": "Only David",
  "scope.03": "Only {keeper}",
  "scope.04": "{keeper} and David",
  "scope.05": "David runs the pond and answers the post.",
} as const;

/**
 * Strings the deck does not have yet, and why.
 *
 * COPY.md was extracted from a static prototype, so it holds example
 * VALUES — "14 ducks", "via Sam · 4 Aug" — where a running UI needs
 * TEMPLATES. And a prototype has no network, so it has no words for a
 * network that is not there, though FLOW.md's edge-state table has always
 * required them.
 *
 * These enter here, in the source, which is the correct direction:
 * `tools/extract-copy.py` reads the UI and writes the deck. A string that
 * exists only in the deck is one nobody ever sees. Re-running the extractor
 * against the real client is a Phase 3 exit task.
 */
export const LIVE_STRINGS = {
  "live.count": "{n} ducks",
  "live.count.one": "1 duck",
  "live.count.none": "no ducks yet",
  // Distinguished on purpose: "try again" is true and useful when the
  // network is gone; "something went wrong" is what you say when it is not.
  "live.offline": "no signal",
  "live.error": "the pond is not answering",
  "live.via": "via {keeper}",
  "live.bumps": "{n} bumps",
  "live.bumps.one": "1 bump",
  "live.bumps.none": "nobody has bumped it yet",
  "live.today": "in the pond since today",
  "live.day": "in the pond for a day",
  "live.days": "in the pond for {n} days",
  "live.loading": "finding your duck",
  "live.saved": "saved",
  "live.nolink": "That link does not open a duck",
  "live.nolink.body": "It may have been taken out, or the link may be incomplete.",
  // Deletion says what goes, in full, before the second tap. There is no
  // account to restore from and the private link dies with the duck.
  "live.remove.sure": "Take your duck out for good?",
  "live.remove.yes": "Yes, take it out",
  "live.removed": "Your duck is out",
  "live.removed.body": "Everything you left has been deleted.",
  // The ten-unreturned cap is an answer, not a failure: it is the poke
  // dynamic asking for reciprocity.
  "live.capped": "bump them back first",
  // "30 of 113" while a whistle is active — the count says what it is
  // showing rather than growing a second label.
  "live.count.of": "{n} of {total}",
  "live.nokeepers": "No cards have been named yet, so there is nobody to whistle for.",
  // The hint shows what the name will DO rather than describing it.
  "live.keeper.hint": "Ducks from this card say via {keeper}.",
  "live.keeper.adopt": "Add the {n} earlier ducks",
} as const;

/**
 * Card setup — Phase 5's screen.
 *
 * Held apart from EN only because these were excluded when the deck was
 * first extracted, back when keepers were a phase away. They are the deck's
 * own strings, unedited.
 */
export const KEEPER_STRINGS = {
  "keeper.01": "Card setup", // Body
  "keeper.02": "Set up this card", // Heading
  "keeper.03": "To change it, hold the card and blow again.", // Body
  "keeper.04": "Card name", // Field label
  "keeper.05": "Sam", // Example value
  "keeper.06": "Ducks from this card say via Sam.", // Hint
  "keeper.07": "Link your duck", // Field label
  "keeper.08": "Remove link", // Button
  "keeper.09": "Make a duck", // Button
  "keeper.10": "Paste duck link", // Button
  "keeper.11": "People can bump you back.", // Hint
  "keeper.12": "Default language", // Field label
  "keeper.13": "English", // Button
  "keeper.14": "繁體中文", // Button
  "keeper.15": "A visitor's phone can still choose another language.", // Hint
  "keeper.16": "Add the 12 earlier ducks to this card", // Field label
  "keeper.17": "Save setup", // Button
  "keeper.18": "Not now", // Button
} as const;

export const EN = {
  "arrival.01": "Your fortune", // Body
  "arrival.02": "大吉 · Great luck", // Heading
  "arrival.03": "No one else got this duck today. Decorate it or release it as is.", // Body
  "arrival.04": "Decorate it", // Button
  "arrival.05": "Just look around", // Button
  "studio.01": "Back", // Button
  "studio.02": "Make it yours", // Body
  "studio.03": "Skip", // Button
  "studio.04": "Your duck. Tap to place or drag a sticker.", // Screen reader
  "studio.05": "Undo", // Screen reader
  "studio.06": "Clear everything", // Screen reader
  "studio.07": "Surprise me", // Screen reader
  "studio.08": "Colour", // Button
  "studio.09": "Stickers", // Button
  "studio.10": "Draw", // Button
  "studio.11": "Body", // Body
  "studio.12": "Brush", // Body
  "studio.13": "1×", // Button
  "studio.14": "2×", // Button
  "studio.15": "Erase", // Button
  "studio.16": "Colour", // Body
  "studio.17": "Next", // Button
  "studio.18": "Drag stickers to move them. Nothing is required.", // Body
  "sign.01": "Sign it", // Body
  "sign.02": "Name your duck", // Heading
  "sign.03": "Name", // Field label
  "sign.04": "Sam", // Placeholder
  "sign.05": "0", // Body
  "sign.06": "Message", // Field label
  "sign.07": "Say something", // Placeholder
  "sign.08": "Everyone who taps a card can see your name and message.", // Privacy note
  "sign.09": "Next", // Button
  "contact.01": "Optional", // Body
  "contact.02": "Want David to reply?", // Heading
  "contact.03": "Skip this and your duck still goes in.", // Body
  "contact.04": "Email, phone, @handle, or address", // Field label
  "contact.05": "@yourhandle or 12 Somewhere St, Brooklyn NY 11211", // Placeholder
  "contact.06": "Only David sees this. It is not shown in the pond, and it is deleted when you take your duck out.", // Privacy note
  "contact.07": "Release my duck", // Button
  "contact.08": "Skip contact", // Button
  "pond.01": "14 ducks", // Button
  "pond.02": "BY-002 — about this card. Opens davidyang.work in a new tab.", // Screen reader
  "pond.03": "Show everyone again", // Screen reader
  "pond.04": "Whistle for", // Body
  "pond.05": "Back to the whole pond", // Screen reader
  "pond.06": "Zoom in", // Screen reader
  "pond.07": "+", // Button
  "pond.08": "Zoom out", // Screen reader
  "pond.09": "−", // Button
  "pond.10": "Say something", // Screen reader
  "pond.11": "Find my duck", // Button
  "pond.12": "Your duck settings", // Screen reader
  "pond.13": "Ducks in the pond", // Screen reader
  "pond.14": "Your duck is in", // Body
  "pond.15": "Keep this link", // Heading
  "pond.16": "No accounts. Use this to edit, redecorate, or take your duck out.", // Body
  "pond.17": "Your private link", // Field label
  "pond.18": "ducky.davidyang.work/e/9fQ2xK7pLm", // Example value
  "pond.19": "Copy", // Button
  "pond.20": "Text", // Button
  "pond.21": "Email", // Button
  "pond.22": "Done", // Button
  "pond.23": "Close", // Screen reader
  "pond.24": "小吉·Little luck", // Body
  "pond.25": "Mika", // Body
  "pond.26": "via Sam · 4 Aug", // Body
  "pond.27": "found this card at the bar", // Body
  "pond.28": "Most bumps from", // Body
  "pond.29": "What's wrong with it?", // Body
  "pond.30": "Rude or abusive", // Button
  "pond.31": "Private details", // Button
  "pond.32": "Spam", // Button
  "pond.33": "Something else", // Button
  "pond.34": "Anything to add", // Field label
  "pond.35": "Anything to add — optional", // Placeholder
  "pond.36": "Send report", // Button
  "pond.37": "Cancel", // Button
  "pond.38": "Bump · 6", // Button
  "pond.39": "Report", // Button
  "mine.01": "Welcome back", // Body
  "mine.02": "Your duck", // Heading
  "mine.03": "In the pond for six days. Four people bumped your duck.", // Body
  "mine.04": "Mika, Jo, Lu, and Sam bumped your duck.", // Body
  "mine.05": "Back to the pond", // Button
  "mine.06": "Redecorate", // Button
  "mine.07": "Settings", // Button
  "manage.01": "Your duck", // Body
  "manage.02": "Message & settings", // Heading
  "manage.03": "Your message", // Field label
  "manage.04": "Email, phone, @handle, or address", // Field label
  "manage.05": "Your private link", // Field label
  "manage.06": "ducky.davidyang.work/e/9fQ2xK7pLm", // Example value
  "manage.07": "Taking your duck out deletes its message and contact at the same time. Nothing is kept.", // Privacy note
  "manage.08": "Save changes", // Button
  "manage.09": "Take my duck out", // Button
  "shared.01": "Tap ducks in the pond. Drag stickers in the studio.", // Body
  "shared.02": "Add 100 ducks", // Button
  "shared.03": "Reset", // Button
  "code.01": "Drag a sticker to move it · nothing is required", // Set from code
  "code.02": "Finish my duck", // Set from code
  "code.03": "Make a duck to bump", // Set from code
  "code.04": "Reported", // Set from code
  "code.05": "Reported ✓", // Set from code
  "code.06": "Slide a coin in to get one", // Set from code
} as const;

export type StringKey =
  | keyof typeof KEEPER_STRINGS
  | keyof typeof EN
  | keyof typeof SCOPE_STRINGS
  | keyof typeof LIVE_STRINGS;

const TABLES: Record<Lang, Partial<Record<StringKey, string>>> = {
  en: { ...EN, ...KEEPER_STRINGS, ...SCOPE_STRINGS, ...LIVE_STRINGS },
  // Phase 6. Deliberately empty rather than machine-translated: every entry
  // falls through to English until a person has written it, which is the
  // honest failure mode.
  "zh-Hant": {},
};

let current: Lang = "en";

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export function lang(): Lang {
  return current;
}

/**
 * A string, with optional `{name}` substitution.
 *
 * Falls back to English rather than showing a key. A missing translation
 * should read as untranslated, never as machinery.
 */
export function t(key: StringKey, vars?: Record<string, string>): string {
  const table = TABLES[current] ?? {};
  const text =
    table[key] ??
    EN[key as keyof typeof EN] ??
    KEEPER_STRINGS[key as keyof typeof KEEPER_STRINGS] ??
    SCOPE_STRINGS[key as keyof typeof SCOPE_STRINGS] ??
    LIVE_STRINGS[key as keyof typeof LIVE_STRINGS] ??
    "";
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => vars[name] ?? whole);
}
