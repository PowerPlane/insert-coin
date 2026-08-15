/**
 * Coming back: your duck, and what you can still do to it.
 *
 * Reached by the private link, which is the whole point of that link. There
 * are no accounts and no notifications — FLOW.md is explicit that **you find
 * out someone bumped you by coming back**, and this is the screen that makes
 * that worth doing.
 *
 * ══ "TAKE MY DUCK OUT" IS NOT OPTIONAL ══
 * People leave a name, a message and sometimes a phone number on a
 * stranger's website. There has to be a way to undo that which is not
 * emailing David. It deletes the duck and its contact in one statement —
 * see the trigger in 0001_init.sql — and it says so before asking.
 */

import { ApiError, api, clearDraft } from "./api.js";
import {
  button, el, field, screen, sheet, spacer, view as fullView,
} from "./dom.js";
import { ORBIT_SIZE, STEP_MS, drawOrbit, type OrbitDuck } from "./orbit.js";
import { drawDuck } from "./render.js";
import { GRID, decodePaint } from "./codec.js";
import { studioScreen, toPayload } from "./studio.js";
import { t } from "./strings.js";
import type { PondDuck } from "./types.js";

export interface MineOptions {
  root: HTMLElement;
  editKey: string;
  onPond: () => void;
}

/** Days, in the words a person would use. */
function since(created: number): string {
  const days = Math.floor((Date.now() / 1000 - created) / 86400);
  if (days <= 0) return t("live.today");
  if (days === 1) return t("live.day");
  return t("live.days", { n: String(days) });
}

export function mineScreen(opts: MineOptions): void {
  const { root, editKey } = opts;

  screen(root, () => {
    root.replaceChildren();
    root.append(el("div", "p-screen p-centre").appendChild(el("p", "p-body", t("live.loading"))).parentElement!);
  });

  void (async () => {
    let duck: PondDuck;
    try {
      const res = await api.mine(editKey);
      duck = res.duck as unknown as PondDuck;
    } catch (err) {
      return screen(root, () => {
        root.replaceChildren();
        const { root: sheetRoot, body: wrap } = sheet(true);
        wrap.append(
          el("p", "p-title", t("live.nolink")),
          el("p", "p-body", t("live.nolink.body")),
          button("p-btn", t("mine.05"), opts.onPond),
        );
        root.append(sheetRoot);
        void err;
      });
    }
    view(duck);
  })();

  function preview(duck: PondDuck, size = 5): HTMLCanvasElement {
    const c = el("canvas", "p-preview");
    c.width = GRID * size;
    c.height = GRID * size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    drawDuck(
      ctx,
      {
        fortune: duck.fortune,
        tint: duck.tint,
        paint: decodePaint(duck.paint),
        stickers: duck.stickers,
      },
      0, 0, size,
    );
    return c;
  }

  // ── 09 · your duck, later ─────────────────────────────────────────────
  function view(duck: PondDuck): void {
    screen(root, () => {
      root.replaceChildren();
      const { root: viewRoot, body: wrap } = fullView();
      wrap.append(
        el("p", "p-eyebrow", t("mine.01")),
        el("h1", "p-title", t("mine.02")),
      );

      // The two facts worth coming back for: how long it has been in, and
      // whether anybody bumped it.
      const bumps = duck.bumps === 1 ? t("live.bumps.one") : t("live.bumps", { n: String(duck.bumps) });
      wrap.append(el("p", "p-body", `${since(duck.created)} · ${bumps}`));

      /*
       * ══ THE PEOPLE WHO BUMPED YOU, CIRCLING ══
       * There is no notification here — you find out somebody bumped your
       * duck by COMING BACK, which is the whole point of a private link
       * and no account. So this screen has to be worth arriving at, and a
       * static picture of your own duck with a number under it is not.
       *
       * The ring loads after the screen: an empty stage is honest while it
       * is on its way, and the duck in the middle is drawn from the first
       * frame either way.
       */
      const stage = el("div", "p-orbit");
      const canvas = el("canvas", "p-orbit-art");
      canvas.width = ORBIT_SIZE;
      canvas.height = ORBIT_SIZE;
      canvas.setAttribute("role", "img");
      stage.append(canvas);
      wrap.append(stage);

      // Named underneath, in a sentence, because a ring of moving labels is
      // something to enjoy and a sentence is something to READ.
      const who = el("p", "p-orbit-who", "");
      who.hidden = true;
      wrap.append(who);

      startOrbit(canvas, who, duck);

      wrap.append(spacer());
      const actions = el("div", "p-actions");
      /*
       * Back is the one primary. Redecorate and Settings are a pair of
       * equal alternatives, so they sit side by side rather than stacking —
       * three full-width buttons read as three steps.
       */
      const pair = el("div", "p-actions-pair");
      pair.append(
        button("p-btn p-btn-quiet", t("mine.06"), () => redecorate(duck)),
        button("p-btn p-btn-quiet", t("mine.07"), () => settings(duck)),
      );
      actions.append(button("p-btn", t("mine.05"), opts.onPond), pair);
      wrap.append(actions);
      root.append(viewRoot);
    });
  }

  /**
   * "Mika, Jo, Lu, and Sam" — in whatever language is on.
   *
   * `Intl.ListFormat` because the joining word is not translatable by
   * substitution: English wants "and" with an Oxford comma, Chinese wants
   * 、 between and 和 before the last, and neither is a matter of swapping
   * one token. The browser already knows all of this.
   */
  function nameList(names: string[]): string {
    try {
      return new Intl.ListFormat(document.documentElement.lang || "en", {
        style: "long", type: "conjunction",
      }).format(names);
    } catch {
      // Very old Safari. A comma list still reads.
      return names.join(", ");
    }
  }

  /**
   * Turn the ring, and stop turning it when the screen goes.
   *
   * The interval is cleared by the NEXT screen replacing the canvas: every
   * screen here starts with `replaceChildren`, so a canvas that is no
   * longer in the document is the signal that this screen is over. Cheaper
   * and less forgettable than a teardown every caller has to remember.
   */
  function startOrbit(canvas: HTMLCanvasElement, who: HTMLElement, duck: PondDuck): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let wavers: OrbitDuck[] = [];
    let tick = 0;

    const paint = () => {
      if (!canvas.isConnected) {
        window.clearInterval(timer);
        return;
      }
      drawOrbit(ctx, duck, wavers, tick++, ORBIT_SIZE);
    };
    const timer = window.setInterval(paint, STEP_MS);
    paint();

    void api.bumpers(duck.id).then(
      (res) => {
        if (!canvas.isConnected || !res.bumpers.length) return;
        wavers = res.bumpers;
        const names = res.bumpers.map((b) => b.name).filter(Boolean);
        if (names.length) {
          who.textContent = t("mine.04", { names: nameList(names) });
          who.hidden = false;
        }
        paint();
      },
      // A screen that shows your duck is still a screen worth having.
      () => {},
    );
  }

  /**
   * Redecorate.
   *
   * The same studio, saving quietly — FLOW.md: "the arrival animation
   * belongs to the first arrival only". There is nothing to announce about
   * changing a hat, and re-running the reveal would say otherwise.
   *
   * The draft machinery is deliberately NOT used here. A draft exists to
   * survive losing an unreleased duck; this duck is already in the pond, so
   * the thing to protect is the version that is in it. Changes land when
   * Next is tapped, or not at all.
   */
  function redecorate(duck: PondDuck): void {
    /*
     * ══ A COPY OF THE ARRAY IS NOT A COPY OF WHAT IS IN IT ══
     * `[...duck.stickers]` makes a new list of the SAME sticker objects, and
     * dragging one in the studio moves it by writing to `x`/`y`. So backing
     * out without saving left the duck in memory already changed: the screen
     * showed the new position, the server had the old one, and the next
     * thing to save would have quietly written a move nobody confirmed.
     *
     * Each sticker is copied too. Redecorating is a DRAFT — it exists to be
     * abandoned — and a draft that edits the thing it is a draft of is not
     * one.
     */
    const state = {
      tint: duck.tint,
      stickers: duck.stickers.map((st) => ({ ...st })),
      paint: decodePaint(duck.paint),
    };

    studioScreen(root, {
      fortune: duck.fortune,
      state,
      // Not "Skip" and not "Next": this duck is already in the pond, so
      // the only thing forward means here is keeping what you changed.
      forward: t("manage.08"),
      onChange: () => {
        /* nothing: this duck is already in the water */
      },
      onBack: () => view(duck),
      onNext: () => {
        const { tint, stickers, paint } = toPayload(state);
        void api.update(editKey, { tint, stickers, paint, name: duck.name, message: duck.message })
          .then(
            () => {
              duck.tint = tint;
              duck.stickers = stickers;
              duck.paint = paint;
              view(duck);
            },
            () => {
              // The edits are still on screen and Next still works, so the
              // honest thing is to say so and stay put rather than throw
              // the work away by navigating.
              const note = el("p", "p-note", t("live.error"));
              root.querySelector(".p-screen")?.append(note);
            },
          );
      },
    });
  }

  // ── 10 · message and settings ─────────────────────────────────────────
  function settings(duck: PondDuck): void {
    screen(root, () => {
      root.replaceChildren();
      const { root: sheetRoot, body: wrap } = sheet();
      wrap.append(
        el("p", "p-eyebrow", t("manage.01")),
        el("h2", "p-title", t("manage.02")),
      );

      let name = duck.name;
      let message = duck.message;

      const nameField = field({
        label: t("sign.03"), placeholder: t("sign.04"), max: 18, value: name,
        onInput: (v) => { name = v; },
      });
      const messageField = field({
        label: t("sign.06"), placeholder: t("sign.07"), max: 90, value: message,
        multiline: true,
        onInput: (v) => { message = v; },
      });
      wrap.append(nameField.wrap, messageField.wrap);

      const status = el("p", "p-note", "");
      const save = button("p-btn", t("manage.08"), () => {
        status.textContent = "";
        void api
          .update(editKey, {
            tint: duck.tint,
            stickers: duck.stickers,
            paint: duck.paint,
            name,
            message,
          })
          .then(
            () => {
              duck.name = name;
              duck.message = message;
              status.textContent = t("live.saved");
            },
            (err: unknown) => {
              status.textContent =
                err instanceof ApiError && err.status === 0 ? t("live.offline") : t("live.error");
            },
          );
      });

      const actions = el("div", "p-actions");
      actions.append(save, button("p-btn p-btn-quiet", t("mine.05"), () => view(duck)));
      wrap.append(actions, status);

      // ── take my duck out ────────────────────────────────────────────
      //
      // Behind a confirmation, because it cannot be undone — there is no
      // account to restore it from and the private link dies with it. The
      // confirmation states what goes, in full, before the second tap.
      const danger = el("div", "p-danger");
      const remove = button("p-btn p-btn-danger", t("manage.09"), () => {
        danger.replaceChildren(
          el("p", "p-body", t("live.remove.sure")),
          // The deck's own sentence, not a paraphrase of it. This is the
          // promise the contact screen made, repeated at the moment it is
          // being kept.
          el("p", "p-note", t("manage.07")),
        );
        const confirm = el("div", "p-actions");
        confirm.append(
          button("p-btn p-btn-danger", t("live.remove.yes"), () => {
            void api.remove(editKey).then(
              () => {
                // The local copy of the key is now a key to nothing.
                try {
                  localStorage.removeItem("pond.editKey.v1");
                } catch {
                  /* private mode; the key is gone from the server either way */
                }
                clearDraft();
                gone();
              },
              () => {
                danger.replaceChildren(el("p", "p-note", t("live.error")));
              },
            );
          }),
          button("p-btn p-btn-quiet", t("pond.37"), () => settings(duck)),
        );
        danger.append(confirm);
      });
      danger.append(remove);
      wrap.append(danger);
      root.append(sheetRoot);
    });
  }

  function gone(): void {
    screen(root, () => {
      root.replaceChildren();
      const { root: sheetRoot, body: wrap } = sheet(true);
      wrap.append(
        el("h2", "p-title", t("live.removed")),
        el("p", "p-body", t("live.removed.body")),
        button("p-btn", t("mine.05"), opts.onPond),
      );
      root.append(sheetRoot);
    });
  }
}
