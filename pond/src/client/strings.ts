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

import { FORTUNES } from "./sprites.js";

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
  "live.say.wait": "Your duck can speak again in {time}", // Screen reader, the say button while quiet
  "live.sr.duck": "{name}'s duck, {fortune}", // Screen reader, one duck in the list
  "live.sr.bumper": "{name}, {bumps} — open their duck", // Screen reader, a bumper chip
  "live.sr.anon": "Someone", // Screen reader, a duck with no name
  "live.sr.burning": "{name}, on fire — open to put it out", // Screen reader
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
  // Named, not "invalid": the keeper needs to know it is this word, not
  // their typing, and that the pond is not accusing them of anything.
  "live.keeper.reserved": "That name is kept for the pond itself. Try another.",
  "live.keeper.taken": "Somebody already keeps this card.",
  "live.claim.held": "This card is {keeper}\u2019s",
  "live.keeper.via": "Ducks from this card will say via {keeper}. You can change it or hand it on later.",
  "live.claim.no": "This card could not be set up.",
  "live.claim.no.card": "Card {serial}", // The serial, so it can be named
  "live.claim.no.body": "The setup may already have been used, or this card is not one the pond knows. Hold the card, blow four times again, and tap.",
  // Whose circle you are in. Names the person, never "filter: keeper".
  "live.whistling": "{keeper}'s cards",
  // The row, not the screen-reader label. "Show everyone again" describes
  // an action to somebody who cannot see the list; "Everyone" names a state
  // to somebody reading it.
  "live.everyone": "Everyone",
  /*
   * A failed release used to be four words on their own — true, and no
   * help. Somebody who has just spent two minutes decorating a duck needs
   * three things: what happened, that their work is still here, and what
   * to do. The draft IS kept, so saying so is not reassurance, it is a
   * fact they cannot otherwise see.
   */
  "live.error.body": "Your duck is still here — nothing you made has been lost. Try again in a moment.",
  "live.offline.body": "Your duck is still here — nothing you made has been lost. Try again once you are back online.",
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

  // ── keeping the card you just used ────────────────────────────────────
  //
  // The offer, and the sheet behind it. Every one of these is deliberately
  // short: this arrives while somebody is watching their duck float, and a
  // paragraph at that moment is a paragraph nobody reads.
  "keeper.19": "Keep this card yours", // Button — the offer in the pond bar
  /*
   * A decline, not a postponement. The offer stops asking about this
   * card for good, so "Not now" would have been a small lie.
   */
  "keeper.20": "No thanks", // Button — declines the offer for this card
  "keeper.21": "Keep it", // Button — the sheet's primary
  "keeper.22": "This card is yours", // Field label on your duck's settings
  "keeper.23": "Card settings", // Button
  "keeper.24": "Take my name off", // Button
  "keeper.25": "Someone else keeps it now", // Button
  "keeper.26": "Your ducks stay in the pond and keep saying via you. The card goes back to being anybody's.", // Body
  "keeper.27": "Hand it on", // Button — confirms
  "keeper.28": "Keep it", // Button — cancels handing on
  /*
   * Not "Card name". In admin, a card's NAME is its label — "the one I
   * gave Sam" — which is a different field about a different thing. What
   * this asks for is a person, and the sentence above it says so: ducks
   * from this card will read via <this>.
   */
  "keeper.29": "Your name", // Field label
  /*
   * ══ FOUR BLOWS ON A CARD SOMEBODY ALREADY KEEPS ══
   * The gesture cannot say who is holding the card, so the pond does not
   * guess — it names the keeper and asks. This is the screen a keeper
   * blowing on their OWN card used to never see, while their settings
   * were quietly replaced.
   */
  "keeper.31": "This card is already set up", // Heading, keeper unnamed
  "keeper.32": "Taking it over makes it yours: new ducks say your name instead, and nothing of theirs comes with it. Their ducks stay in the pond.", // Body
  "keeper.33": "Take it over", // Button
  "keeper.34": "Leave it as it is", // Button
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
  "studio.19": "Nothing here is required.", // Body, on the other tabs
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
  /*
   * ══ RETIRED ══
   * The contact screen had "Release my duck" and "Skip contact" side by
   * side. With the field empty — which is how almost everybody arrives —
   * they did the same thing. Leaving it blank IS skipping, and the
   * screen says so three other ways. Kept as a key so the numbering of
   * everything after it does not shift, and so COPY.md stays readable.
   */
  "contact.08": "Skip contact", // Button — no longer rendered
  "contact.09": "Leave an address if you want a postcard. David will not share it.", // Body
  "pond.01": "14 ducks", // Button
  "pond.02": "David's Pond — who made this. Opens davidyang.work in a new tab.", // Screen reader
  "pond.41": "David's Pond", // The mark on the water
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
  /*
   * ══ A MESSAGE YOU SEND TO YOURSELF ══
   * The text was the bare URL and the email subject was "Keep this link" —
   * a heading lifted off the screen it came from, which means nothing in
   * an inbox six months later. There are no accounts here, so this message
   * IS the account recovery, and the person most likely to read it is the
   * sender, long after they have forgotten what it was.
   *
   * So it says what it is, what it does, and why to keep it — in that
   * order, and in about the space a text message should take.
   */
  "pond.42": "Your duck at David's Pond.\n\n{url}\n\nThere are no accounts, so this link is the only way back to it. Keep it.", // SMS body
  "pond.43": "Your duck at David's Pond", // Email subject
  "pond.44": "This is the link to your duck in the pond:\n\n{url}\n\nThere are no accounts here, so this link is the only way back to it. Use it to change your duck, redecorate it, or take it out of the pond.\n\nKeep it somewhere you will find it again.", // Email body
  "pond.18": "ducky.davidyang.work/e/9fQ2xK7pLm", // Example value
  "pond.19": "Copy", // Button
  "pond.20": "Text", // Button
  "pond.21": "Email", // Button
  "pond.22": "Done", // Button
  "pond.40": "Copied", // Button, once the link is on the clipboard
  "say.01": "Say something", // Button, screen reader
  "say.02": "Say something", // Heading
  "say.03": "Your duck says this for 45 seconds.", // Body
  "say.04": "What's on your mind?", // Placeholder
  "say.05": "Say it", // Button
  "say.06": "Not now", // Button
  "say.07": "One at a time — try again in {minutes} min.", // Error, cooldown
  "say.08": "The pond isn't answering. Try again.", // Error
  "say.09": "Your duck settings", // Button, screen reader
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
  "mine.04": "{names} bumped your duck.", // Body, under the orbit
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
  "manage.10": "Its address in the pond", // Field label
  "manage.11": "Letters, numbers and dashes", // Placeholder
  "manage.12": "Free", // Hint, the address is available
  "manage.13": "Taken", // Hint, somebody has it
  "manage.14": "Three letters or more", // Hint, not a usable address
  "manage.08": "Save changes", // Button
  "manage.09": "Take my duck out", // Button
  "manage.15": "Take back my contact", // Button
  "manage.19": "Type here to set or replace how David can reply. Blank changes nothing.", // Hint
  "manage.20": "Save", // Button, in the header row where there is no room for a sentence
  "manage.21": "Copy", // Button, the private link
  "manage.22": "Copied", // Button, after copying
  "manage.23": "Take it back", // Button, beside the hint that names what "it" is
  "manage.16": "If you left a way to reply, this deletes it. Your duck stays in the pond.", // Privacy note
  "manage.17": "Done. Nobody can reply to you now.", // Result
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

/**
 * 繁體中文 — Phase 6.
 *
 * ══ WRITTEN, NOT MACHINE-TRANSLATED ══
 * Every entry here was composed against the screen it appears on. The tone
 * matches the English: warm, short, and plain — the pond talks to a person
 * holding a card, not to a user of a service. Where English is deliberately
 * gentle ("the pond is not answering", not "error 500"), Chinese is too.
 *
 * ══ WHAT IS DELIBERATELY IDENTICAL ══
 * Names (David, Sam, Mika), URLs, "English", "繁體中文", the zoom glyphs and
 * the brush sizes are written out unchanged rather than omitted. Omitting
 * them would fall through to English and look the same today, but it would
 * be indistinguishable from a string nobody has translated yet — and the
 * parity test could no longer tell those two apart.
 *
 * ══ BUMP IS 碰, NOT 戳 ══
 * It was 戳 on the reasoning that Chinese social apps have always called it
 * that, so it would arrive already understood. That is exactly the problem:
 * what arrives understood is FACEBOOK'S POKE — a finger jabbing a person
 * through a screen.
 *
 * What happens here is one duck swimming across a pond and nudging another.
 * 碰 is that: a light physical bump between two things floating in water.
 * The apps' word borrowed a gesture that does not exist in this pond, and
 * being instantly recognisable made it worse rather than better.
 *
 * Flagged by a native Taiwanese reader, which is the only review that could
 * have caught it — every string here was correct.
 *
 * 大吉 · 小吉 · 末吉 · 凶 are left alone. They were already Chinese.
 */
export const ZH_HANT: Record<StringKey, string> = {
  // ── who may read a contact — stated in NAMES, never as a value ────────
  "scope.01": "誰可以看到",
  "scope.02": "只有 David",
  "scope.03": "只有 {keeper}",
  "scope.04": "{keeper} 和 David",
  "scope.05": "David 經營這個池塘，也會回信。",

  // ── counts, states, and the words for a network that is not there ────
  "live.count": "{n} 隻鴨子",
  "live.count.one": "1 隻鴨子",
  "live.count.none": "還沒有鴨子",
  "live.offline": "沒有訊號",
  "live.error": "池塘沒有回應",
  "live.via": "來自 {keeper}",
  "live.bumps": "被碰了 {n} 下",
  "live.bumps.one": "被碰了 1 下",
  "live.bumps.none": "還沒有人碰過它",
  "live.say.wait": "還要 {time} 才能再說話",
  "live.sr.duck": "{name} 的鴨子，{fortune}",
  "live.sr.bumper": "{name}，{bumps} — 打開這隻鴨子",
  "live.sr.anon": "有人",
  "live.sr.burning": "{name} 燒起來了 — 打開幫它滅火",
  "live.today": "今天來到池塘",
  "live.day": "在池塘裡一天了",
  "live.days": "在池塘裡 {n} 天了",
  "live.loading": "正在找你的鴨子",
  "live.saved": "已儲存",
  "live.nolink": "這個連結打不開任何鴨子",
  "live.nolink.body": "可能已經被帶走了，或是連結不完整。",
  "live.remove.sure": "確定要把鴨子永遠帶走嗎？",
  "live.remove.yes": "好，帶走",
  "live.removed": "你的鴨子離開了",
  "live.removed.body": "你留下的一切都已經刪除。",
  "live.capped": "先碰回去",
  "live.count.of": "{total} 隻中的 {n} 隻",
  "live.nokeepers": "還沒有卡片取名字，所以現在還不能吹哨找人。",
  "live.keeper.hint": "這張卡片放出的鴨子會顯示「來自 {keeper}」。",
  "live.keeper.adopt": "加入先前的 {n} 隻鴨子",
  "live.keeper.reserved": "這個名字是池塘自己保留的，換一個吧。",
  "live.keeper.taken": "這張卡片已經有人保管了。",
  "live.claim.held": "這張卡片是 {keeper} 的",
  "live.keeper.via": "這張卡片放出的鴨子會顯示「來自 {keeper}」。之後可以改，也可以交給別人。",
  "live.claim.no": "這張卡片無法設定。",
  "live.claim.no.card": "卡片 {serial}",
  "live.claim.no.body": "這組設定可能已經用過，或是池塘不認得這張卡片。拿著卡片再吹四次，然後再感應一次。",
  "live.whistling": "{keeper} 的卡片",
  "live.everyone": "全部",
  "live.error.body": "你的鴨子還在，做的東西都沒有不見。等一下再試一次。",
  "live.offline.body": "你的鴨子還在，做的東西都沒有不見。等你連上網路再試一次。",

  // ── card setup ────────────────────────────────────────────────────────
  "keeper.01": "卡片設定",
  "keeper.02": "設定這張卡片",
  "keeper.03": "想改的話，拿著卡片再吹一次。",
  "keeper.04": "卡片名稱",
  "keeper.05": "Sam",
  "keeper.06": "這張卡片放出的鴨子會顯示「來自 Sam」。",
  "keeper.07": "連結你的鴨子",
  "keeper.08": "移除連結",
  "keeper.09": "做一隻鴨子",
  "keeper.10": "貼上鴨子連結",
  "keeper.11": "別人就可以碰回來。",
  "keeper.12": "預設語言",
  "keeper.13": "English",
  "keeper.14": "繁體中文",
  "keeper.15": "訪客還是可以在手機上選別的語言。",
  "keeper.16": "把先前的 12 隻鴨子加進這張卡片",
  "keeper.17": "儲存設定",
  "keeper.18": "現在不要",

  // ── 把剛剛用的卡片變成自己的 ──────────────────────────────────────────
  "keeper.19": "把這張卡片留給自己",
  "keeper.20": "不用了，謝謝",
  "keeper.21": "留下來",
  "keeper.22": "這張卡片是你的",
  "keeper.23": "卡片設定",
  "keeper.24": "把我的名字拿掉",
  "keeper.25": "換別人保管",
  "keeper.26": "你的鴨子會留在池塘裡，也還是會顯示來自你。卡片則會變回誰都可以拿。",
  "keeper.27": "交出去",
  "keeper.28": "還是我保管",
  "keeper.29": "你的名字",
  "keeper.31": "這張卡片已經設定過了",
  "keeper.32": "接手之後就是你的了：之後放出的鴨子會顯示你的名字，也不會拿到對方的任何東西。他們的鴨子會留在池塘裡。",
  "keeper.33": "我要接手",
  "keeper.34": "維持原樣",

  // ── the arrival ───────────────────────────────────────────────────────
  "arrival.01": "你的運勢",
  "arrival.02": "大吉",
  "arrival.03": "今天沒有人抽到這隻鴨子。裝飾一下，或直接放進池塘。",
  "arrival.04": "裝飾它",
  "arrival.05": "先看看就好",

  // ── the studio ────────────────────────────────────────────────────────
  "studio.01": "返回",
  "studio.02": "做成你的鴨子",
  "studio.03": "略過",
  "studio.04": "你的鴨子。點一下放置，或拖曳貼紙。",
  "studio.05": "復原",
  "studio.06": "全部清除",
  "studio.07": "隨機來一個",
  "studio.08": "顏色",
  "studio.09": "貼紙",
  "studio.10": "塗鴉",
  "studio.11": "身體",
  "studio.12": "筆刷",
  "studio.13": "1×",
  "studio.14": "2×",
  "studio.15": "擦掉",
  "studio.16": "顏色",
  "studio.17": "下一步",
  "studio.18": "拖曳貼紙可以移動。不加也可以。",
  "studio.19": "這裡什麼都不用改也可以。",

  // ── signing it ────────────────────────────────────────────────────────
  "sign.01": "簽名",
  "sign.02": "幫鴨子取個名字",
  "sign.03": "名字",
  "sign.04": "Sam",
  "sign.05": "0",
  "sign.06": "留言",
  "sign.07": "說點什麼",
  "sign.08": "每個感應卡片的人都看得到你的名字和留言。",
  "sign.09": "下一步",

  // ── the contact, and what it is for ───────────────────────────────────
  "contact.01": "可以不填",
  "contact.02": "想讓 David 回覆你嗎？",
  "contact.03": "跳過也沒關係，鴨子一樣會下水。",
  "contact.04": "Email、電話、@帳號或地址",
  "contact.05": "@yourhandle 或 12 Somewhere St, Brooklyn NY 11211",
  "contact.06": "只有 David 看得到。不會出現在池塘裡，你把鴨子帶走時也會一起刪掉。",
  "contact.07": "放我的鴨子下水",
  "contact.08": "略過聯絡方式",
  "contact.09": "想收到明信片的話，可以留下地址。David 不會把地址給別人。",

  // ── the pond ──────────────────────────────────────────────────────────
  "pond.01": "14 隻鴨子",
  "pond.02": "David's Pond — 這是誰做的。會在新分頁打開 davidyang.work。",
  "pond.41": "David's Pond",
  "pond.03": "重新顯示全部",
  "pond.04": "吹哨找",
  "pond.05": "回到整個池塘",
  "pond.06": "放大",
  "pond.07": "+",
  "pond.08": "縮小",
  "pond.09": "−",
  "pond.10": "說點什麼",
  "pond.11": "找我的鴨子",
  "pond.12": "你的鴨子設定",
  "pond.13": "池塘裡的鴨子",
  "pond.14": "你的鴨子下水了",
  "pond.15": "留著這個連結",
  "pond.40": "已複製",
  "say.01": "說點什麼",
  "say.02": "說點什麼",
  "say.03": "你的鴨子會說 45 秒。",
  "say.04": "想說什麼？",
  "say.05": "說出來",
  "say.06": "先不要",
  "say.07": "一次一句 — {minutes} 分鐘後再試。",
  "say.08": "池塘沒有回應，請再試一次。",
  "say.09": "你的鴨子設定",
  "pond.16": "沒有帳號。用這個連結修改、重新裝飾，或把鴨子帶走。",
  "pond.17": "你的私人連結",
  "pond.42": "你在 David's Pond 的鴨子。\n\n{url}\n\n這裡沒有帳號，這個連結是唯一找回牠的方法，記得留著。",
  "pond.43": "你在 David's Pond 的鴨子",
  "pond.44": "這是你在池塘裡那隻鴨子的連結：\n\n{url}\n\n這裡沒有帳號，所以這個連結是唯一找回牠的方法。你可以用它修改鴨子、重新裝飾，或把牠帶走。\n\n記得存在之後找得到的地方。",
  "pond.18": "ducky.davidyang.work/e/9fQ2xK7pLm",
  "pond.19": "複製",
  "pond.20": "簡訊",
  "pond.21": "電子郵件",
  "pond.22": "完成",
  "pond.23": "關閉",
  "pond.24": "小吉",
  "pond.25": "Mika",
  "pond.26": "來自 Sam · 8 月 4 日",
  "pond.27": "在酒吧撿到這張卡片",
  "pond.28": "碰最多次的是",
  "pond.29": "哪裡有問題？",
  "pond.30": "不友善或辱罵",
  "pond.31": "個人資料",
  "pond.32": "垃圾訊息",
  "pond.33": "其他",
  "pond.34": "想補充什麼",
  "pond.35": "想補充什麼 — 可以不填",
  "pond.36": "送出檢舉",
  "pond.37": "取消",
  "pond.38": "碰一下 · 6",
  "pond.39": "檢舉",

  // ── coming back to your own duck ──────────────────────────────────────
  "mine.01": "歡迎回來",
  "mine.02": "你的鴨子",
  "mine.03": "在池塘裡六天了。有四個人碰過你的鴨子。",
  "mine.04": "{names} 碰過你的鴨子。",
  "mine.05": "回到池塘",
  "mine.06": "重新裝飾",
  "mine.07": "設定",

  // ── managing it ───────────────────────────────────────────────────────
  "manage.01": "你的鴨子",
  "manage.02": "留言與設定",
  "manage.03": "你的留言",
  "manage.04": "Email、電話、@帳號或地址",
  "manage.05": "你的私人連結",
  "manage.06": "ducky.davidyang.work/e/9fQ2xK7pLm",
  "manage.07": "把鴨子帶走時，留言和聯絡方式會一起刪掉。什麼都不會留下。",
  "manage.10": "池塘裡的地址",
  "manage.11": "英文字母、數字或 -",
  "manage.12": "可以用",
  "manage.13": "有人用了",
  "manage.14": "至少 3 個字元",
  "manage.08": "儲存變更",
  "manage.09": "把我的鴨子帶走",
  "manage.15": "刪掉聯絡方式",
  "manage.19": "在這裡填，就能設定或更換 David 回覆你的方式；留白不會改動原本資料。",
  "manage.20": "儲存",
  "manage.21": "複製",
  "manage.22": "已複製",
  "manage.23": "刪掉",
  "manage.16": "如果你留了聯絡方式，這會把它刪掉。鴨子會留在池塘裡。",
  "manage.17": "已完成。現在沒有人能回覆你了。",

  // ── the prototype's own scaffolding ───────────────────────────────────
  "shared.01": "點池塘裡的鴨子。在工作室裡拖曳貼紙。",
  "shared.02": "加入 100 隻鴨子",
  "shared.03": "重設",

  // ── set from code ─────────────────────────────────────────────────────
  "code.01": "拖曳貼紙可以移動 · 不加也可以",
  "code.02": "完成我的鴨子",
  "code.03": "先做一隻鴨子才能碰別人",
  "code.04": "已檢舉",
  "code.05": "已檢舉 ✓",
  "code.06": "投幣就能拿到一隻",
};

const TABLES: Record<Lang, Partial<Record<StringKey, string>>> = {
  en: { ...EN, ...KEEPER_STRINGS, ...SCOPE_STRINGS, ...LIVE_STRINGS },
  "zh-Hant": ZH_HANT,
};

let current: Lang = "en";

export function setLang(lang: Lang): void {
  current = lang;
  // The server already stamped <html lang> — this agrees with it rather
  // than deciding it, and matters only if the language is ever switched
  // without a reload. Guarded so the table can be tested off a document.
  if (typeof document !== "undefined") document.documentElement.lang = lang;
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

/**
 * A fortune's name, glossed only where the gloss earns its place.
 *
 * 大吉 is already Chinese. Appending "Great luck" for a 繁體中文 reader
 * would be glossing INTO a language they are not reading — so they get the
 * characters alone, which is all the card itself ever showed them.
 *
 * An English reader gets both, and the order matters: the kanji is the
 * thing that was on the card, and the gloss is what it turned out to mean.
 */
export function fortuneTitle(fortune: number): string {
  const f = FORTUNES[fortune] ?? FORTUNES[1];
  return current === "zh-Hant" ? f.jp : `${f.jp} · ${f.en}`;
}
