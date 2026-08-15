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
  button, el, field, nav as navStrip, screen, sheet, spacer, view as fullView,
} from "./dom.js";
import { ORBIT_SIZE, STEP_MS, drawOrbit, type OrbitDuck } from "./orbit.js";
import { drawDuck } from "./render.js";
import { GRID, decodePaint } from "./codec.js";
import { SLUG_MAX, SLUG_MIN } from "./slug-limits.js";
import { studioScreen, toPayload } from "./studio.js";
import { t } from "./strings.js";
import type { PondDuck } from "./types.js";

export interface MineOptions {
  root: HTMLElement;
  editKey: string;
  onPond: () => void;
}

/**
 * How many ticks the ring will wait to be put on screen before giving up.
 *
 * The screen is mounted on the very next line in practice, so this is not
 * a timing guess — it is a leak stop, so a canvas that is built and then
 * thrown away without ever being shown cannot leave an interval running
 * for the life of the page.
 */
const MOUNT_GRACE_TICKS = 24;

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
  /**
   * ══ ONE SCREEN, NOT TWO ══
   *
   * There used to be a "welcome back" screen showing the ring, with
   * Settings a tap further in — so tapping the gear landed you on a page
   * about how your duck is DOING when you had come to change something.
   *
   * They are now one screen, and the split is by weight rather than by
   * page: the settings are the work and take the middle, and the record of
   * who bumped you is the header — in the slot where every other screen in
   * this flow already puts a small duck. It costs the space a still picture
   * would have cost, and it is the nicer thing to find there.
   *
   * The names go in a SENTENCE under the ring rather than on the ducks in
   * it. Labels on a moving ring are hard to read; that was learned the
   * first time this ring was built, and the ring is small here.
   */
  function view(duck: PondDuck): void {
    screen(root, () => {
      root.replaceChildren();
      const { root: viewRoot, body: wrap } = fullView();
      // Everything sized for one page is scoped to this class, so no other
      // screen in the flow gets quietly shorter because this one had to.
      wrap.classList.add("p-mine-view");

      /*
       * ══ ONE PAGE, NOT A SCROLL ══
       * This screen was 1156px in an 844px phone: everything below the
       * message box was off the bottom, which put "Save changes" — the
       * only reason most people open it — out of sight behind a scroll.
       *
       * Three moves, in the order they earn their space:
       *
       *   Save goes in the header row, opposite Back. It is the Done of
       *   every settings screen on the platform, it is always reachable
       *   even with the keyboard up, and it gives back a whole 44px row
       *   plus its gap.
       *
       *   "Back to the pond" goes entirely. It did the same thing as the
       *   Back in the nav, and the only argument for keeping both was that
       *   the nav scrolls away — which stops being true the moment the
       *   page does not scroll.
       *
       *   The ring and the sentence about it become one row instead of
       *   two stacked blocks. They are one thought — this is your duck and
       *   this is how it has been getting on — and side by side they read
       *   as one, in about the height the ring alone used to take.
       *
       * The budget is 390x844. At 320x568 it still scrolls, and that is
       * arithmetic rather than a decision: a ring, five fields and two
       * actions do not fit 568px at a readable size. `p8.test` pins the
       * 390 case so it cannot quietly grow back.
       */
      const status = el("p", "p-note p-save-note", "");

      /*
       * Declared as a function rather than a const so the nav above can
       * refer to it before it is written. The alternative was building the
       * nav last and prepending it, which puts the top of the screen at
       * the bottom of the file.
       */
      function doSave(): void {
        status.textContent = "";
        /*
         * The address goes first and on its own, because it is the only
         * field here that can be REFUSED for a reason a person can act on.
         * If it is refused nothing else is written: a half-saved settings
         * screen is worse than a rejected one.
         */
        const tidy = slug.trim().toLowerCase();
        const renamed = tidy && tidy !== duck.slug
          ? api.rename(editKey, tidy).then((res) => { duck.slug = res.slug; })
          : Promise.resolve();

        void renamed.then(saveTheRest, (err: unknown) => {
          status.textContent =
            err instanceof ApiError && err.status === 409 ? t("manage.13") : t("live.error");
        });
      }

      wrap.append(
        navStrip(
          // A SHORT label. "Back to the pond" in the corner is wide enough
          // to shove the title off centre.
          { label: t("studio.01"), onClick: opts.onPond },
          t("mine.02"),
          // Short here too, for the same reason: "Save changes" is the
          // sentence a full-width button has room for, and this is not one.
          { label: t("manage.20"), onClick: () => doSave() },
        ),
        status,
      );

      // ── the record, as a header row ───────────────────────────────────
      const header = el("div", "p-mine-head");
      const stage = el("div", "p-orbit p-orbit-compact");
      const ring = el("canvas", "p-orbit-art");
      ring.width = ORBIT_SIZE;
      ring.height = ORBIT_SIZE;
      ring.setAttribute("role", "img");
      ring.setAttribute("aria-label", t("mine.01"));
      stage.append(ring);

      /*
       * The two facts worth coming back for, in one line: how long it has
       * been in, and who has been by. A sentence rather than a stat block,
       * because "Mika, Jo and Lu bumped your duck" is a nicer thing to read
       * than a number with a label under it.
       */
      const bumps = duck.bumps === 1
        ? t("live.bumps.one")
        : t("live.bumps", { n: String(duck.bumps) });
      const stats = el("p", "p-orbit-who", `${since(duck.created)} · ${bumps}`);
      header.append(stage, stats);
      wrap.append(header);
      startOrbit(ring, stats, duck);

      // ── the settings, which are the work ──────────────────────────────
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

      /*
       * ══ THE PUBLIC ADDRESS, AND ONLY THE PUBLIC ONE ══
       * Two links belong to a duck and they are not the same kind of thing.
       * The PRIVATE one is a credential — there is no account behind it, so
       * a rotatable key just loses people their duck. It is shown, because
       * this is where somebody comes looking for it, and it is readonly.
       * The PUBLIC one is an address you might say out loud, and it can be
       * changed.
       */
      let slug = duck.slug;
      const slugHint = el("p", "p-hint p-hint-inline", "");
      const slugField = field({
        label: t("manage.10"), placeholder: t("manage.11"),
        max: SLUG_MAX, value: duck.slug,
        onInput: (v) => { slug = v; void checkSlug(v); },
      });
      slugField.wrap.append(slugHint);

      let checking = 0;
      async function checkSlug(value: string): Promise<void> {
        const mine = ++checking;
        const tidy = value.trim().toLowerCase();
        if (tidy === duck.slug) { slugHint.textContent = ""; return; }
        if (tidy.length < SLUG_MIN) {
          slugHint.textContent = t("manage.14");
          slugHint.classList.remove("p-hint-good");
          return;
        }
        try {
          const res = await api.slugFree(tidy);
          // A slower answer to an older keystroke must not overwrite a
          // newer one — people type faster than a round trip.
          if (mine !== checking) return;
          slugHint.textContent = res.ok ? t("manage.12") : t("manage.13");
          slugHint.classList.toggle("p-hint-good", res.ok);
        } catch {
          if (mine === checking) slugHint.textContent = "";
        }
      }

      /*
       * ══ A CONTACT YOU CAN REPLACE BUT NEVER READ ══
       * The field is EMPTY, always, and that is the whole design rather
       * than an omission. Prefilling it would mean the server handing back
       * a phone number to whoever is holding this link — and a private
       * link is a string that gets pasted into group chats. So you cannot
       * see what is there. You can put something else in its place, or
       * take it out.
       *
       * Which makes blank mean LEAVE IT ALONE, never delete. Somebody
       * fixing a typo in their name must not lose their contact by not
       * typing in a box they had no reason to touch. Removal stays its own
       * deliberate act, on the line below.
       *
       * The scope is not offered here and is fixed to "only David" by the
       * server. The contact screen can offer to share with the card's
       * keeper because it runs inside a session that knows who that is;
       * this screen has neither, and a screen that cannot name the person
       * must not ask you to agree to them.
       */
      let contact = "";
      const contactField = field({
        label: t("contact.04"), placeholder: t("contact.05"), max: 120, value: "",
        onInput: (v) => { contact = v; },
      });
      const contactNote = el("p", "p-hint-block p-hint-tight", t("manage.19"));
      // The short label. The sentence next to it already says what "it"
      // is, and the long one ran off the edge of a 390px phone.
      const takeBack = button("p-linkish", t("manage.23"), () => {
        takeBack.disabled = true;
        void api.withdrawContact(editKey).then(
          () => { contactNote.textContent = t("manage.17"); takeBack.remove(); },
          () => { contactNote.textContent = t("live.error"); takeBack.disabled = false; },
        );
      });
      /*
       * The hint and the way out share a line. Stacked they were 38px of
       * sentence over a 44px link for one rare act, on the screen with the
       * least room in the flow; side by side the link keeps its full tap
       * target and the sentence keeps its full width beside it.
       */
      const contactFoot = el("div", "p-contact-foot");
      contactFoot.append(contactNote, takeBack);
      contactField.wrap.append(contactFoot);

      /*
       * The private link as a ROW rather than a field. It is not something
       * anybody edits or reads character by character — it is something
       * they send to themselves — so it gets the one control that matters
       * and none of the height a text field spends on being editable.
       */
      const linkRow = el("div", "p-linkrow");
      const linkText = el("span", "p-linkrow-url", `${location.origin}/e/${editKey}`);
      const copy = button("p-chip", t("manage.21"), () => {
        void navigator.clipboard?.writeText(`${location.origin}/e/${editKey}`).then(
          () => {
            copy.textContent = t("manage.22");
            window.setTimeout(() => { copy.textContent = t("manage.21"); }, 1400);
          },
          // The clipboard can be refused. The link is on screen and can be
          // selected by hand, so this is a failed convenience, not an error.
          () => {},
        );
      });
      linkRow.append(el("span", "p-field-label", t("manage.05")), linkText, copy);

      wrap.append(nameField.wrap, messageField.wrap, slugField.wrap, contactField.wrap, linkRow);

      const saveTheRest = (): void => {
        // The contact is written separately: it lives in its own table
        // behind its own route, and it must not be able to fail the rest
        // of the form or be failed by it.
        if (contact.trim()) {
          void api.setContact(editKey, contact.trim()).then(
            () => {
              // Cleared on success so a second Save does not write it
              // again, and so nothing that was typed stays on screen.
              contact = "";
              contactField.input.value = "";
            },
            () => { status.textContent = t("live.error"); },
          );
        }
        void api
          .update(editKey, {
            tint: duck.tint, stickers: duck.stickers, paint: duck.paint, name, message,
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
      };

      wrap.append(spacer());

      /*
       * Redecorate on its own. It used to sit beside "Back to the pond" as
       * one of two equal alternatives; with Back gone from here there is
       * nothing to pair it with, and a lone quiet button under the form is
       * exactly what it is — the other thing you might have come to do.
       */
      const actions = el("div", "p-actions");
      actions.append(button("p-btn p-btn-quiet", t("mine.06"), () => redecorate(duck)));
      wrap.append(actions);

      /*
       * ══ TAKING IT OUT LIVES BELOW EVERYTHING, BEHIND A RULE ══
       * It cannot be undone — there is no account to restore from and the
       * private link dies with it — so it is separated from the things that
       * can, and the confirmation states what goes before the second tap.
       */
      const danger = el("div", "p-danger");
      const remove = button("p-btn p-btn-danger", t("manage.09"), () => {
        danger.replaceChildren(
          el("p", "p-body", t("live.remove.sure")),
          el("p", "p-note", t("manage.07")),
        );
        const confirm = el("div", "p-actions");
        confirm.append(
          button("p-btn p-btn-danger", t("live.remove.yes"), () => {
            void api.remove(editKey).then(
              () => { clearDraft(); gone(); },
              () => { danger.replaceChildren(el("p", "p-note", t("live.error"))); },
            );
          }),
          button("p-btn p-btn-quiet", t("pond.37"), () => view(duck)),
        );
        danger.append(confirm);
      });
      danger.append(remove);
      wrap.append(danger);

      root.append(viewRoot);
    });
  }

  /**
   * Turn the ring, and stop turning it when the screen goes.
   *
   * The interval stops when its canvas leaves the document: every screen
   * here starts with `replaceChildren`, so a canvas that is no longer
   * connected IS the signal that this screen is over. Cheaper than a
   * teardown every caller has to remember, and impossible to forget.
   *
   * ══ EXCEPT IT HAD NOT ARRIVED YET ══
   * "Gone" and "not here yet" are the same reading of `isConnected`, and
   * this told them apart by assuming the first. `view()` builds its whole
   * tree DETACHED and returns it for the caller to mount, so the paint on
   * the line after `setInterval` ran against a canvas that was not in the
   * document — and cancelled the interval it had just started, one tick
   * into a screen that had not been shown yet.
   *
   * Nothing looked broken, which is the worst part. The bumpers request
   * came back a moment later, by then the canvas WAS mounted, and its
   * callback painted one frame: four ducks, correctly placed, at tick 0,
   * for as long as the screen was open. A ring that is never drawn is
   * obvious; a ring drawn exactly once is just a picture, and it took
   * someone saying "the ducks are not moving" to see it.
   *
   * So the two states are now distinguished. Before the first mount there
   * is nothing to do but wait; after it, a disconnected canvas means the
   * screen is over.
   */
  function startOrbit(canvas: HTMLCanvasElement, stats: HTMLElement, duck: PondDuck): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let wavers: OrbitDuck[] = [];
    let tick = 0;
    /** Has this canvas ever been in the document? */
    let mounted = false;
    /** Ticks spent waiting for that, so a screen that never opens stops. */
    let waited = 0;

    const paint = () => {
      if (!canvas.isConnected) {
        // Gone after being shown, or never shown at all and out of
        // patience. Either way there is nothing left to turn.
        if (mounted || ++waited > MOUNT_GRACE_TICKS) window.clearInterval(timer);
        return;
      }
      mounted = true;
      // Unnamed: the names are in the sentence under the ring.
      drawOrbit(ctx, duck, wavers, tick++, ORBIT_SIZE, false);
    };
    const timer = window.setInterval(paint, STEP_MS);
    paint();

    void api.bumpers(duck.id).then(
      (res) => {
        if (!canvas.isConnected || !res.bumpers.length) return;
        wavers = res.bumpers;
        const names = res.bumpers.map((b) => b.name).filter(Boolean);
        if (names.length) {
          // The names replace the bump COUNT: "Mika, Jo and Lu bumped your
          // duck" says the same thing and says who.
          stats.textContent =
            `${since(duck.created)} · ${t("mine.04", { names: nameList(names) })}`;
        }
        paint();
      },
      // A screen that shows your duck is still a screen worth having.
      () => {},
    );
  }

  /**
   * "Mika, Jo, and Lu" — in whatever language is on.
   *
   * `Intl.ListFormat` because the joining word is not translatable by
   * substitution: English wants "and" with an Oxford comma, Chinese wants a
   * different separator and a different final word. The browser knows.
   */
  function nameList(names: string[]): string {
    try {
      return new Intl.ListFormat(document.documentElement.lang || "en", {
        style: "long", type: "conjunction",
      }).format(names);
    } catch {
      return names.join(", ");
    }
  }

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
