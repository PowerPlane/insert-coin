/**
 * Card setup — reached by blowing four times, never by a link.
 *
 * ══ CLAIMING AND CONFIGURING ARE DIFFERENT ACTS ══
 * By the time this screen renders the card is already claimed: the epoch
 * exists, and everything here is optional. Somebody who taps "Not now" has
 * still claimed their card — `via` is simply not shown.
 *
 * ══ NO CUSTOM LINK ══
 * It was in an earlier design and was removed. Anyone who wants their card
 * to point elsewhere can rewrite the tag with any NFC app; keeping it here
 * would have meant an open redirect on this domain, an interstitial, and a
 * moderation surface, for a feature the tag already provides.
 */

import { api, recallEditKey } from "./api.js";
import {
  button, el, field, nav as navStrip, screen, sheet as makeSheet, spacer,
  view as fullView,
} from "./dom.js";
import { t } from "./strings.js";
import { GRID, decodePaint } from "./codec.js";
import { drawDuck } from "./render.js";

/** Sprite pixels per side for the linked duck's thumbnail. */
const LINKED_CELL = 3;

interface KeeperState {
  epochId: string;
  keeper: string;
  lang: "en" | "zh-Hant";
  duckSlug: string | null;
  orphans: number;
}

export interface CardSetupOptions {
  root: HTMLElement;
  onDone: () => void;
  /*
   * ══ TWO PRESENTATIONS, ONE SCREEN ══
   * Compact is a sheet with two questions on it. Full is the view above,
   * with the paste field and the linked-duck thumbnail.
   *
   * Which one is right is decided by a single fact: does the pond already
   * know which duck is theirs. Reached by blowing on a card, it does not —
   * there may be no session and no duck at all, so the screen has to ask
   * for a private link and is a screen's worth of work. Reached from the
   * pond a minute after a duck landed, it knows: the edit key is in this
   * browser, the name they want is the name they just signed with, and
   * the language is the one they are reading in. Two questions is a sheet.
   *
   * Asking the same person the same thing twice is what makes software
   * feel like paperwork, so the compact form asks for neither.
   */
  compact?: boolean;
  /** Their duck, when the caller already knows it. Skips the paste field. */
  editKey?: string;
  /** Prefill for the name — what they signed their duck with. */
  suggestName?: string;
}

/**
 * Card settings, by whichever credential is to hand.
 *
 * The cookie is the fresher one and lasts an hour; a keeper's own duck's
 * private link works for as long as their tenure does. Sent as a query
 * parameter only when there is one — an empty `?editKey=` would be a
 * malformed credential rather than an absent one.
 */
async function get(editKey?: string): Promise<KeeperState | null> {
  const url = editKey ? `/api/keeper?editKey=${encodeURIComponent(editKey)}` : "/api/keeper";
  const res = await fetch(url, { credentials: "same-origin" });
  return res.ok ? ((await res.json()) as KeeperState) : null;
}

export function cardSetup(opts: CardSetupOptions): void {
  const { root } = opts;

  void get(opts.editKey).then((state) => {
    if (!state) return opts.onDone();
    // Only offered as a prefill, and only when there is nothing to
    // overwrite. A keeper who has already chosen a name keeps it.
    if (!state.keeper && opts.suggestName) state.keeper = opts.suggestName;
    render(state);
  });

  function render(state: KeeperState): void {
    if (opts.compact) return renderCompact(state);
    screen(root, () => {
      root.replaceChildren();
      /*
       * ══ A FULL VIEW, LIKE EVERY OTHER WORKING SCREEN ══
       * This was the last bottom sheet in the flow. A sheet says "a small
       * thing, over what you were doing" — but setting up a card has five
       * fields and a keyboard, and it is not over anything: it is reached
       * by blowing on a card, with no pond behind it to return to.
       *
       * The way out is in the nav, where it is in the rest of the flow,
       * rather than only at the foot of a form somebody has to scroll
       * past a keyboard to reach.
       */
      const { root: viewRoot, body: wrap } = fullView();
      wrap.append(navStrip({ label: t("keeper.18"), onClick: opts.onDone }, t("keeper.02")));
      wrap.append(el("p", "p-note", t("keeper.03")));

      // ── the card's name ─────────────────────────────────────────────
      let name = state.keeper;
      const nameField = field({
        label: t("keeper.04"), placeholder: t("keeper.05"), max: 18, value: name,
        onInput: (v) => {
          name = v;
          // The hint is the point of the field: it shows what the name
          // will actually do rather than describing it.
          hint.textContent = v ? t("live.keeper.hint", { keeper: v }) : t("keeper.06");
        },
      });
      const hint = el(
        "p", "p-hint-block",
        name ? t("live.keeper.hint", { keeper: name }) : t("keeper.06"),
      );
      wrap.append(nameField.wrap, hint);

      // ── the keeper's own duck ───────────────────────────────────────
      //
      // Claiming a card and having a duck are different things, and either
      // can come first — so this is optional and can be filled in later.
      let editKey = recallEditKey() ?? "";
      wrap.append(el("p", "p-field-label", t("keeper.07")));

      if (state.duckSlug) {
        /*
         * ══ SHOW THE DUCK, NOT THE STRING ══
         * This said "/d/tidal-fern" and nothing else. A slug is an address:
         * correct, unmemorable, and no help at all in answering the only
         * question anybody has here — "is that the right duck?" A person
         * who linked the wrong one would read their own address back and
         * agree with it.
         *
         * So it shows the duck. The picture is the confirmation; the
         * address stays underneath for anyone who wants to check it.
         */
        const linked = el("div", "p-linked");
        const art = el("canvas", "p-linked-art");
        art.width = GRID * LINKED_CELL;
        art.height = GRID * LINKED_CELL;
        art.setAttribute("role", "img");
        const who = el("div", "p-linked-who");
        const name = el("b", "", "");
        who.append(name, el("small", "", `/d/${state.duckSlug}`));
        linked.append(art, who, button("p-chip", t("keeper.08"), () => {
          editKey = "";
          void save({ editKey: "" });
        }));
        wrap.append(linked);

        /*
         * Fetched after the screen is up, never before it. The address is
         * already on screen and already correct; the picture is a
         * confirmation of it, and a setup screen that will not render until
         * an unrelated duck has loaded is a screen that breaks when that
         * duck is gone.
         */
        void api.bySlug(state.duckSlug).then(
          ({ duck }) => {
            if (!art.isConnected) return;
            const ctx = art.getContext("2d");
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            drawDuck(
              ctx,
              {
                fortune: duck.fortune, tint: duck.tint,
                paint: decodePaint(duck.paint), stickers: duck.stickers,
              },
              0, 0, LINKED_CELL,
            );
            art.setAttribute("aria-label", duck.name || `/d/${duck.slug}`);
            if (duck.name) name.textContent = duck.name;
          },
          // The link is a fact the server already gave us. A picture that
          // will not load does not make it less true.
          () => {},
        );
      } else {
        const paste = field({
          placeholder: t("keeper.10"), max: 200, value: editKey,
          onInput: (v) => {
            // Somebody will paste the whole link rather than the key. Take
            // either — asking a person to extract a substring is asking
            // them to make a mistake.
            editKey = v.trim().replace(/^.*\/e\//, "");
          },
        });
        wrap.append(paste.wrap, el("p", "p-hint-block", t("keeper.11")));
      }

      // ── language ────────────────────────────────────────────────────
      //
      // A default, not a lock: the visitor's phone wins if it asks for a
      // language we have. UI.md § 8.
      let lang = state.lang;
      wrap.append(el("p", "p-field-label", t("keeper.12")));
      const langs = el("div", "p-scopes");
      const langButtons: [KeeperState["lang"], string][] = [
        ["en", t("keeper.13")],
        ["zh-Hant", t("keeper.14")],
      ];
      /*
       * `aria-pressed`, not just a class.
       *
       * A chip that shows its state with a colour shows it to exactly one
       * kind of person. These are the only control on the screen whose
       * whole job is to say which of two things is currently true, so the
       * one that says it out loud has to say it too.
       */
      const paintLang = (): void => {
        buttons.forEach((b, i) => {
          const on = langButtons[i]![0] === lang;
          b.classList.toggle("on", on);
          b.setAttribute("aria-pressed", String(on));
        });
      };
      const buttons = langButtons.map(([value, label]) =>
        button("p-chip", label, () => {
          lang = value;
          paintLang();
        }),
      );
      buttons.forEach((b) => langs.append(b));
      paintLang();
      langs.setAttribute("role", "group");
      wrap.append(langs, el("p", "p-hint-block", t("keeper.15")));

      // ── adopting the ducks that came before ─────────────────────────
      //
      // Offered, never automatic. They are somebody else's ducks, and a
      // keeper saying "yes, those came from my card" is a different act
      // from the system deciding it for them.
      let adopt = false;
      if (state.orphans > 0) {
        const adoptBtn = button(
          "p-chip",
          t("live.keeper.adopt", { n: String(state.orphans) }),
          () => {
            adopt = !adopt;
            adoptBtn.classList.toggle("on", adopt);
            // It is a yes/no about somebody else's ducks. Whether the
            // answer is currently yes is the only thing worth announcing.
            adoptBtn.setAttribute("aria-pressed", String(adopt));
          },
        );
        adoptBtn.setAttribute("aria-pressed", "false");
        /*
         * The chip carries the whole sentence, so it does not also get a
         * label saying the same words. "Add the 12 earlier ducks to this
         * card" above a button reading "Add the 12 earlier ducks" is one
         * thought printed twice, and the second printing is the one you
         * have to press.
         *
         * Wrapped, because a bare chip in this column stretches to the
         * full width and stops looking like a toggle: it looked like a
         * third primary button, sitting above the actual one.
         */
        const adoptRow = el("div", "p-chip-row");
        adoptRow.append(adoptBtn);
        wrap.append(adoptRow);
      }

      // ── save ────────────────────────────────────────────────────────
      const status = el("p", "p-note", "");
      /*
       * ══ ONE "NOT NOW", NOT TWO ══
       * The nav already carries it, top-left, where every screen in this
       * flow puts the way out — and where it stays reachable with the
       * keyboard up. A second copy at the foot of the form was the same
       * words doing the same thing twice on one screen, which is the
       * third time that has happened here: the duplicate Save, the
       * redundant "Skip contact", and now this.
       */
      const actions = el("div", "p-actions");
      actions.append(
        button("p-btn", t("keeper.17"), () => void save({ name, lang, editKey, adopt })),
      );
      // Eats the space between the last field and the buttons, so the
      // primary sits at the foot on a tall phone and directly under the
      // form on a short one.
      wrap.append(spacer(), actions, status);
      root.append(viewRoot);

      async function save(body: Record<string, unknown>): Promise<void> {
        try {
          const res = await fetch("/api/keeper", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            // The one refusal a keeper can act on, so it is the one that
            // gets its own sentence rather than "something went wrong".
            const why = (await res.json().catch(() => null)) as { error?: string } | null;
            status.textContent =
              why?.error === "reserved name" ? t("live.keeper.reserved") : t("live.error");
            return;
          }
          opts.onDone();
        } catch {
          status.textContent = t("live.error");
        }
      }
    });
  }

  /**
   * The same settings, as a sheet, for somebody who already has a duck.
   *
   * ══ WHY THIS IS SHORT ══
   * The card is already claimed by the time this opens — the offer did
   * that, and it is the part that matters. Everything here is optional,
   * so the sheet asks the two questions that are actually questions and
   * infers the rest:
   *
   *   the duck    — the edit key is already in this browser,
   *   the name    — prefilled with what they signed their duck with,
   *   the language— prefilled with the one they are reading in.
   *
   * A person who closes it without touching anything has still kept their
   * card. That is the whole reason it can be a sheet: nothing on it is
   * load-bearing.
   */
  function renderCompact(state: KeeperState): void {
    screen(root, () => {
      root.replaceChildren();
      const { root: sheetRoot, body: wrap } = makeSheet();

      let name = state.keeper;
      wrap.append(el("h2", "p-title", t("keeper.19")));
      const via = el(
        "p", "p-body",
        name ? t("live.keeper.via", { keeper: name }) : t("keeper.06"),
      );
      wrap.append(via);

      const nameField = field({
        label: t("keeper.29"), placeholder: t("keeper.05"), max: 18, value: name,
        onInput: (v) => {
          name = v;
          // The sentence above IS the preview. It shows what the name will
          // do rather than describing what the field is for.
          via.textContent = v ? t("live.keeper.via", { keeper: v }) : t("keeper.06");
          status.textContent = "";
        },
      });
      wrap.append(nameField.wrap);

      // Language: a default for this card, never a lock on a visitor.
      let lang = state.lang;
      wrap.append(el("p", "p-field-label", t("keeper.12")));
      const langs = el("div", "p-scopes");
      langs.setAttribute("role", "group");
      const choices: [KeeperState["lang"], string][] = [
        ["en", t("keeper.13")],
        ["zh-Hant", t("keeper.14")],
      ];
      const chips = choices.map(([value, label]) =>
        button("p-chip", label, () => {
          lang = value;
          paint();
        }),
      );
      const paint = (): void => {
        chips.forEach((b, i) => {
          const on = choices[i]![0] === lang;
          b.classList.toggle("on", on);
          // A chip that shows its state only with a colour shows it to
          // exactly one kind of person.
          b.setAttribute("aria-pressed", String(on));
        });
      };
      chips.forEach((b) => langs.append(b));
      paint();
      wrap.append(langs);

      /*
       * The ducks made from this card before it was claimed. Offered,
       * never assumed — they are somebody else's ducks. Their own duck is
       * not among them: the server adopted that one when the claim was
       * made, because it is the duck that proved the claim.
       */
      let adopt = false;
      if (state.orphans > 0) {
        const chip = button(
          "p-chip", t("live.keeper.adopt", { n: String(state.orphans) }),
          () => {
            adopt = !adopt;
            chip.classList.toggle("on", adopt);
            chip.setAttribute("aria-pressed", String(adopt));
          },
        );
        chip.setAttribute("aria-pressed", "false");
        const row = el("div", "p-chip-row");
        row.append(chip);
        wrap.append(row);
      }

      const status = el("p", "p-note", "");
      const actions = el("div", "p-actions");
      actions.append(
        button("p-btn", t("keeper.21"), () => void save()),
        button("p-btn p-btn-quiet", t("keeper.18"), opts.onDone),
      );
      wrap.append(actions, status);
      root.append(sheetRoot);
      nameField.input.focus();

      async function save(): Promise<void> {
        try {
          const res = await fetch("/api/keeper", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            /*
             * `editKey` is both the link and, when the cookie has expired,
             * the credential. Sent every time so a save an hour later is
             * the same request as a save a minute later.
             */
            body: JSON.stringify({ name, lang, adopt, ...(opts.editKey ? { editKey: opts.editKey } : {}) }),
          });
          if (!res.ok) {
            const why = (await res.json().catch(() => null)) as { error?: string } | null;
            /*
             * Rendered against the field rather than swallowed. Prefilling
             * the name from the duck means a duck signed "David" arrives
             * here holding a name the server will refuse, so this is a
             * path an ordinary person reaches by doing nothing wrong.
             */
            status.textContent =
              why?.error === "reserved name" ? t("live.keeper.reserved") : t("live.error");
            if (why?.error === "reserved name") nameField.input.focus();
            return;
          }
          opts.onDone();
        } catch {
          status.textContent = t("live.error");
        }
      }
    });
  }
}

/**
 * A card arriving armed.
 *
 * The claim is in the URL the card wrote, so this happens on arrival rather
 * than being typed. It is POSTed rather than read from the query string by
 * the server, so the credential does not sit in a Referer or in history any
 * longer than the first request.
 */
/**
 * Is this URL a CLAIM, or just a tap?
 *
 * ══ `&t=` IS ON EVERY TAG, NOT ONLY ON ARMED ONES ══
 * Two places used "has `?t=`" to mean "this card arrived armed", and one
 * of them wrote the belief down: "an ARMED card is going to Card setup
 * instead... the two cannot both be true."
 *
 * They are ALWAYS both true. `config.h` writes `&c=`, `&g=` and `&t=` once
 * at provisioning and only the fortune digit is ever patched, so every
 * ordinary tap carries a signature. Two things followed, and David hit
 * both on the first real card:
 *
 *   Every ordinary tap showed "This card could not be set up." — the
 *   claim was "refused" because there was no claim, and the client could
 *   not tell those apart.
 *
 *   The arrival never played on a real card. `beginRelease` was gated
 *   behind "no `?t=`", so tapping a card landed on the pond with a
 *   button instead of on the fortune. It only ever worked from a typed
 *   URL or `?debug=1` — which is exactly what every bench run used, so
 *   nothing caught it.
 *
 * What actually marks a claim is the COUNTER. Cards ship at `g=0000` and
 * the server requires a counter above the high-water mark, so a zero is
 * not a failed claim — it is not a claim at all.
 *
 * Defined once, here, because the belief it replaces was duplicated and
 * both copies were wrong.
 */
export function isClaimUrl(url: URL): boolean {
  const card = url.searchParams.get("c");
  const g = url.searchParams.get("g");
  const token = url.searchParams.get("t");
  if (!card || !g || !token) return false;
  const counter = parseInt(g, 16);
  return Number.isInteger(counter) && counter > 0;
}

/*
 * The counter this browser has already tried, per card.
 *
 * ══ AN ARMED TAG STAYS ARMED ══
 * Blowing four times writes `&g=` into the tag, and it STAYS there. The
 * claim is spent the first time it is used, but the card goes on serving
 * the same URL for every tap afterwards — so every ordinary tap of a card
 * that was ever armed looked like a claim, and the server correctly
 * refused it as already used, and the person got "This card could not be
 * set up" while trying to make a duck.
 *
 * David hit it the moment he used the four-blow setup: the card worked,
 * and then would not let him make a duck.
 *
 * The server cannot help here — it deliberately returns the same refusal
 * for a spent counter as for a forged token, so that somebody walking the
 * counter space learns nothing. But the CLIENT knows something the server
 * does not: whether it has tried this exact counter before. A counter it
 * has already spent is not a claim attempt at all, and asking again is
 * how a stale tag turns into an error message.
 *
 * The serial is used as the key. It is already in this browser's own
 * history from the tap that put it there, so storing it locally reveals
 * nothing that was not already local.
 */
const CLAIM_SEEN = "pond.claim.seen";

function claimCounter(url: URL): { card: string; counter: number } | null {
  if (!isClaimUrl(url)) return null;
  const card = url.searchParams.get("c") ?? "";
  const counter = parseInt(url.searchParams.get("g") ?? "", 16);
  return card && Number.isInteger(counter) ? { card, counter } : null;
}

/** A claim this browser has not already spent. */
export function claimIsFresh(url: URL): boolean {
  const at = claimCounter(url);
  if (!at) return false;
  try {
    const raw = localStorage.getItem(`${CLAIM_SEEN}.${at.card}`);
    if (raw === null) return true;
    const seen = parseInt(raw, 10);
    return !Number.isInteger(seen) || at.counter > seen;
  } catch {
    // No storage: every tap looks fresh. The server still refuses a spent
    // counter, so the worst case is the old behaviour rather than a hole.
    return true;
  }
}

/** Spent, whether it worked or not: the tag will keep offering it. */
export function rememberClaimAttempt(url: URL): void {
  const at = claimCounter(url);
  if (!at) return;
  try {
    localStorage.setItem(`${CLAIM_SEEN}.${at.card}`, String(at.counter));
  } catch {
    /* nothing to do, and nothing lost that was not already lost */
  }
}

export async function claimFromUrl(url: URL): Promise<boolean> {
  const card = url.searchParams.get("c");
  const g = url.searchParams.get("g");
  const token = url.searchParams.get("t");
  // Not worth a round trip: a card at counter 0 is not making a claim.
  if (!isClaimUrl(url) || !card || !g || !token) return false;
  const counter = parseInt(g, 16);

  try {
    const res = await api.claim(card, counter, token, recallEditKey());
    return res.ok;
  } catch {
    return false;
  }
}
