// ABOUTME: Guides a fresh NFC fortune through an intention, optional decoration, and private save.
// ABOUTME: Preserves unfinished artwork locally until the personal pond confirms the entry.

import { ApiError, api, clearDraft, loadDraft, rememberEditKey, saveDraft } from "./api.js";
import { GRID, decodePaint } from "./codec.js";
import { button, el, field, nav as navStrip, screen, sheet, view } from "./dom.js";
import { drawDuck } from "./render.js";
import { type StudioState, studioScreen, toPayload } from "./studio.js";
import { fortuneTitle, t } from "./strings.js";

export interface ReleaseResult {
  id: string;
  slug: string;
  editKey: string;
}

export interface FlowOptions {
  root: HTMLElement;
  fortune: number;
  playArrival: (
    fortune: number,
    tint: number,
    sheet: HTMLElement,
    onSheet: () => void,
  ) => () => void;
  onReleased: (duck: ReleaseResult) => void;
  onDone: (duck: ReleaseResult) => void;
  onBrowse: () => void;
}

interface Draft {
  studio: StudioState;
  intention: string;
}

function blankDraft(): Draft {
  return {
    studio: { tint: 0, stickers: [], paint: new Uint8Array(GRID * GRID) },
    intention: "",
  };
}

function restore(): Draft {
  const draft = blankDraft();
  const saved = loadDraft();
  if (!saved) return draft;
  draft.studio.tint = saved.tint ?? 0;
  draft.studio.stickers = saved.stickers ?? [];
  draft.studio.paint = decodePaint(saved.paint);
  draft.intention = saved.intention ?? "";
  return draft;
}

export function releaseFlow(opts: FlowOptions): void {
  const { root } = opts;
  const draft = restore();
  let endArrival: () => void = () => {};

  const persist = (): void => {
    const { tint, stickers, paint } = toPayload(draft.studio);
    saveDraft({ tint, stickers, paint, intention: draft.intention });
  };

  function preview(size = 5): HTMLCanvasElement {
    const canvas = el("canvas", "p-preview");
    canvas.width = GRID * size;
    canvas.height = GRID * size;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    drawDuck(context, {
      fortune: opts.fortune,
      tint: draft.studio.tint,
      paint: draft.studio.paint,
      stickers: draft.studio.stickers,
    }, 0, 0, size);
    return canvas;
  }

  function arrivalBody(): void {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet(true);
    wrap.append(
      el("p", "p-eyebrow", t("arrival.01")),
      el("h1", "p-title p-fortune-title", fortuneTitle(opts.fortune)),
      el("p", "p-body", t("arrival.03")),
    );
    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("arrival.04"), () => { endArrival(); intention(); }),
      button("p-btn p-btn-quiet", t("arrival.05"), () => {
        endArrival();
        void release();
      }),
    );
    wrap.append(actions);
    sheetRoot.classList.add("p-waiting");
    root.append(sheetRoot);
    endArrival = opts.playArrival(opts.fortune, draft.studio.tint, sheetRoot, () => {
      sheetRoot.classList.remove("p-waiting");
      const heading = sheetRoot.querySelector<HTMLElement>("h2, .p-title");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
  }

  function intentionBody(): void {
    root.replaceChildren();
    const { root: viewRoot, body: wrap } = view();
    wrap.append(navStrip({ label: t("studio.01"), onClick: arrival }, t("personal.01")));
    wrap.append(preview(6), el("h2", "p-title", t("personal.02")));
    const intentionField = field({
      label: t("personal.03"),
      placeholder: t("personal.04"),
      max: 90,
      value: draft.intention,
      multiline: true,
      onInput: (value) => {
        draft.intention = value;
        persist();
      },
    });
    wrap.append(intentionField.wrap, el("p", "p-note", t("personal.05")));
    const actions = el("div", "p-actions");
    actions.append(
      button("p-btn", t("personal.06"), studio),
      button("p-btn p-btn-quiet", t("personal.07"), () => void release()),
    );
    wrap.append(actions);
    root.append(viewRoot);
  }

  function studio(): void {
    studioScreen(root, {
      fortune: opts.fortune,
      state: draft.studio,
      onChange: persist,
      onNext: () => void release(),
      onBack: intention,
    });
  }

  async function release(): Promise<void> {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet(true);
    const status = el("p", "p-body", t("personal.08"));
    wrap.append(preview(6), status);
    root.append(sheetRoot);

    const { tint, stickers, paint } = toPayload(draft.studio);
    try {
      const made = await api.release({
        tint,
        stickers,
        paint,
        name: "",
        message: draft.intention,
      });
      rememberEditKey(made.editKey);
      clearDraft();
      opts.onReleased(made);
      saved(made);
    } catch (error) {
      const offline = error instanceof ApiError && error.status === 0;
      status.textContent = offline ? t("live.offline") : t("live.error");
      wrap.append(
        el("p", "p-body", offline ? t("live.offline.body") : t("live.error.body")),
        el("div", "p-actions").appendChild(
          button("p-btn", t("personal.09"), () => void release()),
        ).parentElement!,
      );
    }
  }

  function savedBody(made: ReleaseResult): void {
    root.replaceChildren();
    const { root: sheetRoot, body: wrap } = sheet();
    wrap.append(
      el("p", "p-eyebrow", t("personal.10")),
      el("h2", "p-title", t("personal.11")),
      el("p", "p-body", t("personal.12")),
      el("div", "p-actions").appendChild(
        button("p-btn", t("personal.13"), () => opts.onDone(made)),
      ).parentElement!,
    );
    root.append(sheetRoot);
  }

  function arrival(): void { screen(root, arrivalBody); }
  function intention(): void { screen(root, intentionBody); }
  function saved(made: ReleaseResult): void { screen(root, () => savedBody(made)); }

  const started = draft.intention || draft.studio.stickers.length
    || draft.studio.tint !== 0 || draft.studio.paint.some((value) => value !== 0);
  if (started) intention();
  else arrival();
}
