/**
 * Tap to released duck: arrival, studio, sign, contact, release, keep link.
 *
 * ══ THE DRAFT SURVIVES EVERYTHING ══
 * The single most likely way to lose someone's work is iOS reclaiming a
 * backgrounded Safari tab while they are picking a hat. Every change writes
 * to localStorage, and nothing is cleared until the server has confirmed
 * the release — so a reload mid-decoration resumes rather than restarts.
 *
 * ══ NOTHING IS DESTROYED BEFORE IT IS SAFE ══
 * The private link is the only credential that will ever exist for a duck.
 * It is stored the moment the server returns it, BEFORE the screen that
 * shows it renders, because a crash between those two points would leave a
 * duck in the pond that nobody can edit or remove.
 */

import { ApiError, api, clearDraft, loadDraft, rememberEditKey, saveDraft } from "./api.js";
import type { ContactScope } from "./api.js";
import { GRID, decodePaint } from "./codec.js";
import { button, el, field, screen, sheet } from "./dom.js";
import { drawDuck } from "./render.js";
import { type StudioState, studioScreen, toPayload } from "./studio.js";
import { SCOPE_STRINGS, fortuneTitle, t } from "./strings.js";

export interface ReleaseResult {
  id: string;
  slug: string;
  editKey: string;
}

export interface FlowOptions {
  root: HTMLElement;
  fortune: number;
  /** The card keeper's name, if this card has one. Decides the scope picker. */
  keeper: string | null;
  onDone: (duck: ReleaseResult) => void;
  onBrowse: () => void;
}

interface Draft {
  studio: StudioState;
  name: string;
  message: string;
  contact: string;
  scope: ContactScope;
}

function blankDraft(): Draft {
  return {
    studio: { tint: 0, stickers: [], paint: new Uint8Array(GRID * GRID) },
    name: "",
    message: "",
    contact: "",
    // The narrowest scope, which is the only one the screen promises.
    scope: "david",
  };
}

/** Restore whatever survived, without ever failing the flow over it. */
function restore(): Draft {
  const d = blankDraft();
  const saved = loadDraft();
  if (!saved) return d;
  d.studio.tint = saved.tint ?? 0;
  d.studio.stickers = saved.stickers ?? [];
  d.studio.paint = decodePaint(saved.paint);
  d.name = saved.name ?? "";
  d.message = saved.message ?? "";
  d.contact = saved.contact ?? "";
  d.scope = saved.scope ?? "david";
  return d;
}

export function releaseFlow(opts: FlowOptions): void {
  const { root } = opts;
  const draft = restore();

  const persist = () => {
    const { tint, stickers, paint } = toPayload(draft.studio);
    saveDraft({
      tint, stickers, paint,
      name: draft.name,
      message: draft.message,
      contact: draft.contact,
      scope: draft.scope,
    });
  };

  /**
   * A duck at a readable size, for the screens that are not the studio.
   *
   * Five, not ten. At ten a 24-pixel sprite is 240 CSS pixels — more than
   * half the width of a phone — and it pushed the fortune, the sentence and
   * both buttons off the bottom of the sheet. The prototype's is small
   * enough that the whole screen is one thought.
   */
  function preview(size = 5): HTMLCanvasElement {
    const c = el("canvas", "p-preview");
    c.width = GRID * size;
    c.height = GRID * size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    drawDuck(
      ctx,
      {
        fortune: opts.fortune,
        tint: draft.studio.tint,
        paint: draft.studio.paint,
        stickers: draft.studio.stickers,
      },
      0, 0, size,
    );
    return c;
  }

  // ── 01 · arrival ──────────────────────────────────────────────────────
  function arrivalBody(): void {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet(true);
    wrap.append(
      el("p", "p-eyebrow", t("arrival.01")),
      preview(6),
      el("h1", "p-title p-fortune-title", fortuneTitle(opts.fortune)),
      el("p", "p-body", t("arrival.03")),
    );
    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("arrival.04"), studio),
      // The escape hatch matters: someone who just wants to look must not
      // have to make a duck first.
      button("p-btn p-btn-quiet", t("arrival.05"), opts.onBrowse),
    );
    wrap.append(actions);
    root.append(sheetRoot);
  }

  // ── 02 · studio ───────────────────────────────────────────────────────
  function studio(): void {
    studioScreen(root, {
      fortune: opts.fortune,
      state: draft.studio,
      onChange: persist,
      onNext: sign,
      onBack: arrival,
    });
  }

  // ── 03 · sign it ──────────────────────────────────────────────────────
  function signBody(): void {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet();
    wrap.append(el("p", "p-eyebrow", t("sign.01")), preview(6), el("h2", "p-title", t("sign.02")));

    const name = field({
      label: t("sign.03"), placeholder: t("sign.04"), max: 18, value: draft.name,
      onInput: (v) => { draft.name = v; persist(); },
    });
    const message = field({
      label: t("sign.06"), placeholder: t("sign.07"), max: 90, value: draft.message,
      multiline: true,
      onInput: (v) => { draft.message = v; persist(); },
    });

    wrap.append(name.wrap, message.wrap);
    // Stated inline at the point of asking, not in a footer nobody reads.
    wrap.append(el("p", "p-note", t("sign.08")));
    wrap.append(
      el("div", "p-actions").appendChild(button("p-btn", t("sign.09"), contact)).parentElement!,
    );
    root.append(sheetRoot);
  }

  // ── 04 · contact ──────────────────────────────────────────────────────
  function contactBody(): void {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet();
    wrap.append(
      el("p", "p-eyebrow", t("contact.01")),
      el("h2", "p-title", t("contact.02")),
      el("p", "p-body", t("contact.03")),
    );

    /*
     * The picker states scope in NAMES, never as a value — UI.md § 9. And
     * the keeper options only exist when the card HAS a keeper: "shared
     * with the person who keeps this card" is not a sentence anyone can
     * consent to.
     */
    const scopes = el("div", "p-scopes");
    const scopeLabel = el("p", "p-field-label", SCOPE_STRINGS["scope.01"]);
    const options: [ContactScope, string][] = [["david", t("scope.02")]];
    if (opts.keeper) {
      options.push(["keeper", t("scope.03", { keeper: opts.keeper })]);
      options.push(["keeper_and_david", t("scope.04", { keeper: opts.keeper })]);
    }

    const syncScope = (): void => {
      const given = draft.contact.trim().length > 0;
      // With no contact there is nothing to scope. Hiding it is honest:
      // choosing "nobody" IS leaving this empty.
      scopeLabel.hidden = !given;
      scopes.hidden = !given;
      scopeButtons.forEach((b, i) => b.classList.toggle("on", options[i]![0] === draft.scope));
    };

    const scopeButtons = options.map(([value, label]) =>
      button("p-chip", label, () => {
        draft.scope = value;
        persist();
        syncScope();
      }),
    );
    scopeButtons.forEach((b) => scopes.append(b));

    const input = field({
      label: t("contact.04"), placeholder: t("contact.05"), max: 120, value: draft.contact,
      onInput: (v) => { draft.contact = v; persist(); syncScope(); },
    });
    wrap.append(input.wrap, scopeLabel, scopes, el("p", "p-note", t("contact.06")));
    // Explicitly, on the way in. This used to happen as a side effect of
    // `field()` running its onInput during construction, which is exactly
    // the kind of invisible dependency that made three screens throw.
    syncScope();

    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("contact.07"), () => void release()),
      button("p-btn p-btn-quiet", t("contact.08"), () => {
        draft.contact = "";
        persist();
        void release();
      }),
    );
    wrap.append(actions);
    root.append(sheetRoot);
    syncScope();
  }

  // ── 05 · release ──────────────────────────────────────────────────────
  async function release(): Promise<void> {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet(true);
    const status = el("p", "p-body", t("pond.14"));
    wrap.append(preview(6), status);
    root.append(sheetRoot);

    const { tint, stickers, paint } = toPayload(draft.studio);
    const contactValue = draft.contact.trim();

    try {
      const made = await api.release({
        tint, stickers, paint,
        name: draft.name,
        message: draft.message,
        ...(contactValue ? { contact: contactValue, scope: draft.scope } : {}),
      });

      // BEFORE anything else, and before the next screen renders: this is
      // the only credential that will ever exist for this duck, and a crash
      // between here and the keep screen would strand it in the pond with
      // nobody able to edit or remove it.
      rememberEditKey(made.editKey);
      clearDraft();
      keep(made);
    } catch (err) {
      // Nothing is cleared — the draft is still there, and the button
      // simply comes back. Offline is a different sentence from broken.
      // Offline is a different sentence from broken, and both need to say
      // that the duck survived — which it did: `clearDraft()` is above the
      // catch, so nothing has been thrown away.
      const offline = err instanceof ApiError && err.status === 0;
      status.textContent = offline ? t("live.offline") : t("live.error");
      wrap.append(
        el("p", "p-body", offline ? t("live.offline.body") : t("live.error.body")),
        el("div", "p-actions").appendChild(
          button("p-btn", t("contact.07"), () => void release()),
        ).parentElement!,
      );
    }
  }

  // ── 06 · keep the link ────────────────────────────────────────────────
  function keepBody(made: ReleaseResult): void {
    root.replaceChildren();
    const url = `${location.origin}/e/${made.editKey}`;
    const { root: sheetRoot, body: wrap } = sheet();
    wrap.append(
      el("p", "p-eyebrow", t("pond.14")),
      el("h2", "p-title", t("pond.15")),
      el("p", "p-body", t("pond.16")),
    );

    const box = el("div", "p-linkbox");
    // The link is a credential, so it is selectable and copyable but never
    // a link you can accidentally follow and leave in a Referer header.
    const text = el("code", "p-link", url);
    box.append(text);

    const actions = el("div", "p-actions");
    const copy = button("p-btn", t("pond.19"), () => {
      void navigator.clipboard?.writeText(url).then(
        () => { copy.textContent = "✓"; },
        () => {
          // Clipboard can be refused. Selecting the text is the fallback
          // that always works.
          const range = document.createRange();
          range.selectNodeContents(text);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        },
      );
    });
    const smsHref = `sms:?&body=${encodeURIComponent(url)}`;
    const mailHref = `mailto:?subject=${encodeURIComponent(t("pond.15"))}&body=${encodeURIComponent(url)}`;
    const sms = el("a", "p-btn p-btn-quiet", t("pond.20"));
    sms.href = smsHref;
    const mail = el("a", "p-btn p-btn-quiet", t("pond.21"));
    mail.href = mailHref;

    actions.append(copy, sms, mail);
    wrap.append(box, actions);
    wrap.append(
      el("div", "p-actions").appendChild(
        button("p-btn", t("pond.22"), () => opts.onDone(made)),
      ).parentElement!,
    );
    root.append(sheetRoot);
  }

  // Each screen renders inside a guard: a throw after replaceChildren
  // would otherwise leave a blank page, which is the hardest kind of bug
  // to report and the easiest to ship.
  function arrival(): void { screen(root, arrivalBody); }
  function sign(): void { screen(root, signBody); }
  function contact(): void { screen(root, contactBody); }
  function keep(made: ReleaseResult): void { screen(root, () => keepBody(made)); }

  // Resume where they were if there is anything to resume.
  const started = draft.name || draft.message || draft.studio.stickers.length ||
    draft.studio.tint !== 0 || draft.studio.paint.some((v) => v !== 0);
  if (started) studio();
  else arrival();
}



