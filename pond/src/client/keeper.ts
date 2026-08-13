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
import { button, el, field, screen, sheet } from "./dom.js";
import { t } from "./strings.js";

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
      const { root: sheetRoot, body: wrap } = sheet();

      wrap.append(
        el("p", "p-eyebrow", t("keeper.01")),
        el("h2", "p-title", t("keeper.02")),
        el("p", "p-note", t("keeper.03")),
      );

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
      const hint = el("p", "p-hint", name ? t("live.keeper.hint", { keeper: name }) : t("keeper.06"));
      wrap.append(nameField.wrap, hint);

      // ── the keeper's own duck ───────────────────────────────────────
      //
      // Claiming a card and having a duck are different things, and either
      // can come first — so this is optional and can be filled in later.
      let editKey = recallEditKey() ?? "";
      wrap.append(el("p", "p-field-label", t("keeper.07")));

      if (state.duckSlug) {
        const linked = el("div", "p-actions");
        linked.append(
          el("p", "p-body", `/d/${state.duckSlug}`),
          button("p-chip", t("keeper.08"), () => {
            editKey = "";
            void save({ editKey: "" });
          }),
        );
        wrap.append(linked);
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
        wrap.append(paste.wrap, el("p", "p-hint", t("keeper.11")));
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
      const buttons = langButtons.map(([value, label]) =>
        button("p-chip", label, () => {
          lang = value;
          buttons.forEach((b, i) => b.classList.toggle("on", langButtons[i]![0] === lang));
        }),
      );
      buttons.forEach((b, i) => {
        b.classList.toggle("on", langButtons[i]![0] === lang);
        langs.append(b);
      });
      wrap.append(langs, el("p", "p-hint", t("keeper.15")));

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
          },
        );
        wrap.append(el("p", "p-field-label", t("keeper.16")), adoptBtn);
      }

      // ── save ────────────────────────────────────────────────────────
      const status = el("p", "p-note", "");
      const actions = el("div", "p-actions");
      actions.append(
        button("p-btn", t("keeper.17"), () => void save({ name, lang, editKey, adopt })),
        button("p-btn p-btn-quiet", t("keeper.18"), opts.onDone),
      );
      wrap.append(actions, status);
      root.append(sheetRoot);

      async function save(body: Record<string, unknown>): Promise<void> {
        try {
          const res = await fetch("/api/keeper", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(String(res.status));
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
