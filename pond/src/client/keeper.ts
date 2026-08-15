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
  button, el, field, nav as navStrip, screen, spacer, view as fullView,
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
}

async function get(): Promise<KeeperState | null> {
  const res = await fetch("/api/keeper", { credentials: "same-origin" });
  return res.ok ? ((await res.json()) as KeeperState) : null;
}

export function cardSetup(opts: CardSetupOptions): void {
  const { root } = opts;

  void get().then((state) => {
    if (!state) return opts.onDone();
    render(state);
  });

  function render(state: KeeperState): void {
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
      const actions = el("div", "p-actions");
      actions.append(
        button("p-btn", t("keeper.17"), () => void save({ name, lang, editKey, adopt })),
        button("p-btn p-btn-quiet", t("keeper.18"), opts.onDone),
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
}

/**
 * A card arriving armed.
 *
 * The claim is in the URL the card wrote, so this happens on arrival rather
 * than being typed. It is POSTed rather than read from the query string by
 * the server, so the credential does not sit in a Referer or in history any
 * longer than the first request.
 */
export async function claimFromUrl(url: URL): Promise<boolean> {
  const card = url.searchParams.get("c");
  const g = url.searchParams.get("g");
  const token = url.searchParams.get("t");
  if (!card || !g || !token) return false;

  const counter = parseInt(g, 16);
  // Counter 0 is what every card ships with and is never claimable — the
  // server requires a counter ABOVE the high-water mark, and cards start
  // at 0. Not worth a round trip.
  if (!Number.isInteger(counter) || counter <= 0) return false;

  try {
    const res = await api.claim(card, counter, token);
    return res.ok;
  } catch {
    return false;
  }
}
