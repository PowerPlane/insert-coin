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
import {
  button, el, field, nav as navStrip, screen, sheet, spacer, view, copyText,
} from "./dom.js";
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
  /**
   * Play the arrival in the pond behind this flow, and call back when the
   * sheet should rise. Returns a cleanup to run on leaving the screen.
   *
   * The choreography belongs to whoever owns the water, not to the flow —
   * this screen's job is to say what the fortune IS, once the duck that
   * carries it has landed.
   */
  playArrival: (
    fortune: number,
    tint: number,
    /** The sheet, already laid out, so its height can be measured. */
    sheet: HTMLElement,
    onSheet: () => void,
  ) => () => void;
  /** The card keeper's name, if this card has one. Decides the scope picker. */
  keeper: string | null;
  /**
   * The duck exists and is in the pond. Put it in the water NOW — the card
   * that says so is about to be shown over it.
   */
  onReleased: (duck: ReleaseResult) => void;
  /** The card has been dismissed. Nothing to do but get out of the way. */
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
    /*
     * No picture of a duck here. The duck is IN THE WATER behind this
     * sheet, wearing a YOU tag, having just fallen — that is the whole
     * arrival, and a thumbnail of it inside the panel was a photograph of
     * a moment that was supposed to be happening.
     */
    wrap.append(
      el("p", "p-eyebrow", t("arrival.01")),
      el("h1", "p-title p-fortune-title", fortuneTitle(opts.fortune)),
      el("p", "p-body", t("arrival.03")),
    );
    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("arrival.04"), () => { endArrival(); studio(); }),
      // The escape hatch matters: someone who just wants to look must not
      // have to make a duck first.
      button("p-btn p-btn-quiet", t("arrival.05"), () => { endArrival(); opts.onBrowse(); }),
    );
    wrap.append(actions);

    /*
     * Held back until the duck has landed and its fortune has been seen —
     * but LAID OUT the whole time.
     *
     * `hidden` would take it out of layout, and the camera needs to know
     * how much water this sheet is about to cover so it can centre the duck
     * in what is left. A sheet with no height yet answers that question
     * wrongly, and the duck ends up high.
     */
    sheetRoot.classList.add("p-waiting");
    root.append(sheetRoot);
    endArrival = opts.playArrival(opts.fortune, draft.studio.tint, sheetRoot, () => {
      sheetRoot.classList.remove("p-waiting");
      /*
       * ══ FOCUS HAS TO COME WITH IT ══
       * This screen now opens BY ITSELF on a fresh tap, rather than
       * because somebody pressed a button. Nothing moved focus, so a
       * screen reader stayed wherever it was — usually the document body,
       * behind a sheet that had just taken over the page — and a keyboard
       * had to tab in from the top of the pond to reach "Decorate it".
       *
       * The heading takes it rather than the first button: this is
       * somebody's fortune, and it should be read out before it is acted
       * on. `tabindex="-1"` makes it focusable without adding a tab stop
       * of its own.
       *
       * Waited for the reveal to finish rather than done on append,
       * because moving focus into a sheet that is still `p-waiting` —
       * laid out but invisible — announces a screen nobody can see yet.
       */
      const heading = sheetRoot.querySelector<HTMLElement>("h2, .p-title");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  }

  /**
   * Stops the arrival and takes its stand-in duck back out.
   *
   * Called on every way OFF that screen, including the ones that are not
   * buttons — leaving it running would drop a duck the server has never
   * heard of into a pond that is about to be polled.
   */
  let endArrival: () => void = () => {};

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
    // A full screen, not a sheet: this one is mostly typing, and a sheet
    // with the keyboard up has almost nothing left to show.
    const { root: viewRoot, body: wrap } = view();
    /*
     * ══ EVERY STEP HAS A WAY BACK ══
     * The prototype has none here, and neither did this: once you left the
     * studio you could not return to it, so a duck you decided against was
     * a duck you had to release anyway. Nothing is being saved to a server
     * yet and the draft survives, so there is no cost to stepping back and
     * no reason to prevent it.
     */
    wrap.append(navStrip({ label: t("studio.01"), onClick: studio }, t("sign.01")));
    wrap.append(preview(6), el("h2", "p-title", t("sign.02")));

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
    wrap.append(spacer());
    wrap.append(
      el("div", "p-actions").appendChild(button("p-btn", t("sign.09"), contact)).parentElement!,
    );
    root.append(viewRoot);
  }

  // ── 04 · contact ──────────────────────────────────────────────────────
  function contactBody(): void {
    root.replaceChildren();
    const { root: viewRoot, body: wrap } = view();
    wrap.append(navStrip({ label: t("studio.01"), onClick: sign }, t("contact.01")));
    wrap.append(
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
    /*
     * ══ WHY AN ADDRESS IS ON THE LIST AT ALL ══
     * The field offers "Email, phone, @handle, or address" and the last
     * one made no sense on its own: nobody hands a stranger their street
     * address to be replied to by post unless somebody says that is what
     * will happen. The admin has had a "postcard" mark on a contact since
     * the beginning; this is the sentence that mark was always for, and
     * it was the one piece of the prototype's contact screen missing here.
     *
     * Set apart rather than added to the privacy note. It is an offer, not
     * a condition, and the two read differently: one tells you what you
     * get, the other what happens to what you give.
     */
    const postcard = el("p", "p-postcard");
    const stamp = el("span", "p-postcard-stamp");
    stamp.setAttribute("aria-hidden", "true");
    postcard.append(stamp, document.createTextNode(t("contact.09")));

    wrap.append(input.wrap, scopeLabel, scopes, postcard, el("p", "p-note", t("contact.06")));
    // Explicitly, on the way in. This used to happen as a side effect of
    // `field()` running its onInput during construction, which is exactly
    // the kind of invisible dependency that made three screens throw.
    syncScope();

    /*
     * ══ ONE BUTTON, BECAUSE THERE IS ONE ACTION ══
     * There used to be a "Skip contact" beside this, which cleared the
     * field and released. With the field empty — which is how almost
     * everybody arrives at it — the two buttons did exactly the same
     * thing, and a screen that offers the same outcome twice makes
     * somebody stop and work out the difference.
     *
     * The screen already says four times over that this is optional: the
     * nav reads OPTIONAL, the body says "Skip this and your duck still
     * goes in", the placeholder is an example rather than a demand, and
     * the note underneath explains what happens if you do fill it in.
     * A second button was the fifth telling, and the only one that could
     * be misread — it did not say "discard what I typed", which is the
     * one case where it differed at all.
     *
     * Leaving it blank IS skipping. So there is one button, and it says
     * what happens.
     */
    const actions = el("div", "p-actions");
    actions.append(button("p-btn", t("contact.07"), () => void release()));
    wrap.append(spacer(), actions);
    root.append(viewRoot);
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
      /*
       * ══ IT GOES IN NOW, NOT WHEN THE CARD IS DISMISSED ══
       * The card says "your duck is in", so it had better be going in. It
       * used to wait for Done, which meant reading that sentence over a
       * pond your duck was not yet part of, and then watching it arrive
       * after you had already been told.
       *
       * The card covers the bottom of the screen and the water above it is
       * clear, so the arrival plays behind it and Done becomes what it
       * looks like: closing a card, not triggering an event.
       */
      keep(made);
      opts.onReleased(made);
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

    /*
     * ══ THE LINK IS A FIELD, NOT A PARAGRAPH ══
     * It was a `<code>` in a box. That looks right and behaves badly: on a
     * phone the only way to get text out of a block element is a long-press
     * and a careful drag, on a 40-character URL where one wrong character
     * loses the duck for good. A readonly input selects itself on focus, so
     * one tap arms the system Copy — and it scrolls rather than wrapping,
     * which keeps the modal short.
     *
     * `readonly`, not `disabled`: disabled fields cannot be focused, copied,
     * or read aloud, and this one has to be all three.
     */
    const link = field({
      label: t("pond.17"), placeholder: "", max: 200, value: url, readonly: true,
    });
    const input = link.input as HTMLInputElement;
    input.classList.add("p-link");

    /*
     * ══ ONE GOLD BUTTON, AND IT IS ALWAYS THE NEXT THING ══
     * Copy, Text and Email are three routes to ONE outcome, so they are
     * three equal quiet buttons in a row — the row is what says "pick one".
     * Stacked full-width, and with Copy gold, the screen had two competing
     * primaries and read as four unrelated commands.
     *
     * Done is the only gold, and it is honest: once the link is somewhere
     * safe, leaving is the next thing to do. There are no accounts behind
     * this, so a link lost here is a duck lost for good.
     */
    const actions = el("div", "p-actions-row");
    const copy = button("p-btn p-btn-quiet", t("pond.19"), () => {
      void copyText(url).then((ok) => {
        if (ok) {
          copy.textContent = t("pond.40");
          return;
        }
        // The clipboard can be refused — by permissions, by a non-secure
        // origin, or by there being no clipboard API at all. Selecting the
        // field always works, and leaves the person one system gesture from
        // the same result.
        input.focus();
        input.select();
      });
    });
    const sms = el("a", "p-btn p-btn-quiet", t("pond.20"));
    sms.href = `sms:?&body=${encodeURIComponent(url)}`;
    const mail = el("a", "p-btn p-btn-quiet", t("pond.21"));
    mail.href = `mailto:?subject=${encodeURIComponent(t("pond.15"))}&body=${encodeURIComponent(url)}`;

    actions.append(copy, sms, mail);
    wrap.append(link.wrap, actions);
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



