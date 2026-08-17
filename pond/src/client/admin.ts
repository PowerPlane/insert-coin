/**
 * The pondkeeper.
 *
 * Its own bundle, deliberately: nothing here needs the water, the camera or
 * the sprites, and loading 80 kB of canvas code to render a list of
 * contacts would be silly.
 *
 * ══ THE ONE SCREEN THAT SHOWS A CONTACT ══
 * Everything else in this codebase is built so a contact CANNOT be read —
 * the public module may not name the table, the release may only insert.
 * Here it is read, behind a password, and shown with the scope it was given
 * under stated in NAMES beside it. UI.md § 9: "shared with Sam and you",
 * never "scope: 2".
 *
 * ══ READING IS THE COMMON ACT ══
 * See docs/pond/ADMIN.md for the design record. The short version: every
 * row used to show every one of its buttons all the time, which made the
 * Ducks tab twelve phone screens tall at a third of the real batch and put
 * Delete under the thumb that was only trying to scroll. A row is now a
 * summary; the rare and dangerous things unfold behind a tap.
 */

import { button, el, field, screen , copyText} from "./dom.js";

interface AdminDuck {
  id: string;
  slug: string;
  name: string;
  message: string;
  created: number;
  hidden: number;
  fortune: number;
  keeper: string | null;
  card: string | null;
  reports: number;
  contact: string | null;
  scope: string | null;
  /* Who the contact was actually shared with — the tenure it was given
     to, which is not always the duck's current one. */
  contactKeeper: string | null;
  replied: number | null;
  postcard: number | null;
  editKey: string;
}

interface AdminCard {
  id: string;
  label: string;
  created: number;
  disabled: number;
  keeper: string | null;
  lang: string | null;
  ducks: number;
  /* Claimed and unnamed are different states; `keeper` alone conflates
     them, and the difference is the whole question when deciding whether
     to assign somebody. */
  claimed: boolean;
  orphans: number;
  /* The high-water mark. Four blows work only above this. */
  claimCounter: number;
}

type Tab = "ducks" | "contacts" | "cards";

/**
 * A saved question about the list, tapped from a count.
 *
 * ══ A NUMBER THAT DESCRIBES A PROBLEM SHOULD TAKE YOU TO IT ══
 * The header said "3 reported" and stopped there. The screen already knew
 * which three; finding them meant scrolling the whole list reading badges.
 * Every count on this page is now the control that filters to it.
 */
type Flag = "reported" | "waiting" | "free" | "disabled" | null;

const root = document.getElementById("pond")!;
const FORTUNES = ["大吉", "小吉", "末吉", "凶"];

const day = (t: number | null): string =>
  t ? new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

/**
 * What an empty tab says.
 *
 * Each names the event that would fill it, because the only useful thing an
 * empty screen can do is tell you what you are waiting for. English only,
 * like the rest of this page: one reader, and it is David.
 */
const EMPTY: Record<Tab, string> = {
  ducks: "No ducks yet. They appear here as people release them.",
  contacts: "Nobody has left a contact. They only appear when somebody chooses to share one.",
  cards: "No cards yet. A card appears here the first time one of its taps reaches the pond.",
};

/** The scope, said as people. Never as a value. */
function scopeLabel(scope: string | null, keeper: string | null): string {
  if (!scope) return "";
  if (scope === "david") return "shared with you";
  if (scope === "keeper") return `shared with ${keeper ?? "the card keeper"}`;
  return `shared with ${keeper ?? "the card keeper"} and you`;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/** The password gate. A wrong one gets a 404, so this says the same thing. */
function signIn(): void {
  screen(root, () => {
    root.replaceChildren();
    const wrap = el("div", "a-screen a-centre");
    wrap.append(el("h1", "a-title", "Admin"));

    const pw = field({ label: "Password", placeholder: "", max: 200 });
    (pw.input as HTMLInputElement).type = "password";
    wrap.append(pw.wrap);

    const status = el("p", "p-note", "");
    const go = button("p-btn", "Open", () => {
      void fetch("/api/admin/in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: pw.input.value }),
      }).then((r) => {
        if (r.ok) void load();
        else status.textContent = "No.";
      });
    });
    pw.input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") go.click();
    });

    wrap.append(go, status);
    root.append(wrap);
    pw.input.focus();
  });
}

/*
 * ══ WHERE YOU WERE, ACROSS A RELOAD ══
 * Every action here ends in `load()`, and `load()` re-rendered hard-coded
 * to the Ducks tab. So marking a postcard sent — an action that only
 * exists on the Contacts tab — threw you back to Ducks, away from the row
 * you had just touched.
 *
 * Which also made it feel one-way. Both marks have always been toggles,
 * on the server and in the request the client already sends; you simply
 * could not get back to the row to tap it again without navigating there
 * and finding it. Reported as "hard to uncheck if I pressed it
 * accidentally", and that is exactly what it was.
 *
 * So the screen remembers where it was — and that now has to include the
 * search text and the active filter, or every action would silently drop
 * the question you were in the middle of asking. Same bug, two more ways
 * to have it.
 */
let where: { tab: Tab; card: string | null; q: string; flag: Flag } = {
  tab: "ducks", card: null, q: "", flag: null,
};

/*
 * Whether the server can verify a card at all. Module scope because it is
 * a fact about the deployment rather than about a row, and the banner is
 * drawn on every tab.
 */
let cardSecretOk = true;

async function load(): Promise<void> {
  let state: { ducks: AdminDuck[]; cards: AdminCard[]; cardSecret?: boolean };
  try {
    state = await api<{ ducks: AdminDuck[]; cards: AdminCard[]; cardSecret?: boolean }>("");
  } catch {
    return signIn();
  }
  cardSecretOk = state.cardSecret !== false;
  view(state.ducks, state.cards);
}

/**
 * Which card a duck came from, said the way a person would.
 *
 * ══ THE KEEPER'S NAME IS OPTIONAL; THE SERIAL IS NOT ══
 * Provenance used to be "via Sam" and nothing else, which vanished
 * entirely the moment a card had no keeper name — and a freshly
 * provisioned card has none until somebody blows on it. So the row that
 * exists to answer "where did this duck come from" answered nothing at
 * all for exactly the cards that were newest.
 *
 * The serial is the durable half: eight characters printed on the thing in
 * your hand, and the only identity that cannot be renamed. The keeper name
 * is the memorable half. Both, when both exist; the serial alone when it
 * is all there is.
 */
function provenance(d: AdminDuck): string {
  if (!d.card) return "no card";
  return d.keeper ? `${d.keeper} · ${d.card}` : d.card;
}

/**
 * Does this row answer the search?
 *
 * ══ ONE BOX, NOT A FIELD PER COLUMN ══
 * When you are hunting for something you remember ONE fact about it — a
 * name, or eight characters off a card, or a phrase from a message — and
 * usually not which kind of fact it was. Asking which column to search in
 * is asking a question the searcher cannot answer.
 *
 * Everything is already in one request, so this costs no round trip.
 */
function hit(haystack: (string | null | undefined)[], q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((h) => (h ?? "").toLowerCase().includes(needle));
}

/** A duck is "waiting" when somebody left a contact and got no reply. */
const waiting = (d: AdminDuck): boolean => Boolean(d.contact) && !d.replied;

function view(ducks: AdminDuck[], cards: AdminCard[]): void {
  screen(root, () => {
    root.replaceChildren();
    const wrap = el("div", "a-screen");

    const head = el("div", "a-head");
    head.append(el("h1", "a-title", "Admin"), el("span", "p-eyebrow", "ducky.davidyang.work"));
    wrap.append(head);

    const withContacts = ducks.filter((d) => d.contact);
    const tabs = el("div", "p-tabs");
    for (const [key, label] of [
      ["ducks", `Ducks ${ducks.length}`],
      ["contacts", `Contacts ${withContacts.length}`],
      ["cards", `Cards ${cards.length}`],
    ] as [Tab, string][]) {
      const b = button("p-tab", label, () => {
        /*
         * Changing tab keeps the card filter — going Ducks → Cards → Ducks
         * to check something should not silently drop what you were looking
         * at — but drops the flag, because the flags are per-tab questions
         * and "reported" means nothing on the Cards list.
         */
        where = { ...where, tab: key, flag: null };
        view(ducks, cards);
      });
      b.classList.toggle("on", where.tab === key);
      tabs.append(b);
    }
    wrap.append(tabs);

    /*
     * ══ A MISSING KEY IS SILENT AND STOPS EVERYTHING ══
     * Without a correctly shaped CARD_SECRET nothing verifies: no card
     * registers, no duck gets provenance, no card can be claimed or kept
     * — and nothing errors. The pond keeps working and cards simply stop
     * being cards, which is the hardest kind of breakage to notice. So it
     * is stated at the top of every tab, not tucked into Cards.
     */
    if (!cardSecretOk) {
      wrap.append(el(
        "p", "a-flag",
        "CARD_SECRET is missing or malformed. No card can register, be "
          + "claimed, or attribute a duck until it is set to 32 hex characters.",
      ));
    }

    // ── the search box ──────────────────────────────────────────────────
    //
    // Rendered once and never replaced. The list repaints underneath it on
    // every keystroke, so re-rendering the whole view here would take the
    // focus and the caret away mid-word.
    const search = el("input", "p-input a-search") as HTMLInputElement;
    search.type = "search";
    search.value = where.q;
    search.placeholder = where.tab === "cards"
      ? "Search serial, keeper or label"
      : where.tab === "contacts"
        ? "Search name, contact or message"
        : "Search name, message, serial or link";
    search.setAttribute("aria-label", "Search");
    wrap.append(search);

    // ── the counts, which are also the filters ──────────────────────────
    const reported = ducks.filter((d) => d.reports > 0).length;
    const unanswered = withContacts.filter(waiting).length;
    const free = cards.filter((c) => !c.claimed).length;
    const off = cards.filter((c) => c.disabled).length;

    const flags = el("div", "a-flags");
    const flagChip = (key: Exclude<Flag, null>, label: string, tone = ""): void => {
      const b = button(`p-chip a-flag-chip ${tone}`.trim(), label, () => {
        where = { ...where, flag: where.flag === key ? null : key };
        view(ducks, cards);
      });
      b.classList.toggle("on", where.flag === key);
      b.setAttribute("aria-pressed", String(where.flag === key));
      flags.append(b);
    };
    if (where.tab === "ducks" && reported) {
      flagChip("reported", `${reported} reported`, "a-chip-hot");
    }
    if (where.tab === "contacts" && unanswered) {
      flagChip("waiting", `${unanswered} waiting`);
    }
    if (where.tab === "cards") {
      // A card batch is a stock list: the useful summary is what is spare
      // and what is out of action, and both are things you then want to see.
      flags.append(el("span", "a-row-meta", `${cards.length} cards`));
      if (free) flagChip("free", `${free} free`);
      if (off) flagChip("disabled", `${off} off`);
    }
    if (flags.childElementCount) wrap.append(flags);

    /*
     * The card filter, when one is on. Shaped like the pond's own whistle
     * bar — what it is, and an ✕ — because it is the same idea in a
     * different room, and the admin should not invent a second vocabulary
     * for "you are looking at a subset".
     */
    if (where.card) {
      const named = cards.find((c) => c.id === where.card);
      const bar = el("div", "a-filter");
      bar.append(
        el("span", "a-filter-who",
          named?.keeper ? `${named.keeper} · ${where.card}` : where.card),
        button("p-chip", "✕", () => {
          where = { ...where, card: null };
          view(ducks, cards);
        }, "Show every card again"),
      );
      wrap.append(bar);
    }

    const list = el("div", "a-list");
    wrap.append(list);

    /** Show every duck from one card — reached from either direction. */
    const show = (card: string | null): void => {
      where = { ...where, tab: "ducks", card, flag: null };
      view(ducks, cards);
    };

    /*
     * ══ REPAINT THE LIST, NOT THE PAGE ══
     * Called on every keystroke. Rebuilding the whole view instead would
     * replace the search input the person is currently typing into.
     */
    function paint(): void {
      const q = where.q;
      let rows: HTMLElement[] = [];

      if (where.tab === "ducks") {
        rows = ducks
          .filter((d) => !where.card || d.card === where.card)
          .filter((d) => where.flag !== "reported" || d.reports > 0)
          .filter((d) => hit([d.name, d.message, d.slug, d.card, d.keeper, d.contact], q))
          .map((d) => duckRow(d, show, cards));
      }
      if (where.tab === "contacts") {
        rows = withContacts
          .filter((d) => !where.card || d.card === where.card)
          .filter((d) => where.flag !== "waiting" || waiting(d))
          .filter((d) => hit([d.name, d.contact, d.message, d.card, d.keeper], q))
          .map((d) => contactRow(d, show));
      }
      if (where.tab === "cards") {
        rows = cards
          .filter((c) => where.flag !== "free" || !c.claimed)
          .filter((c) => where.flag !== "disabled" || c.disabled)
          .filter((c) => hit([c.id, c.keeper, c.label], q))
          .map((c) => cardRow(c, show));
      }

      /*
       * ══ AN EMPTY LIST STILL HAS TO SAY SOMETHING ══
       * All three tabs rendered nothing at all when they were empty: a
       * heading, three counts reading zero, and a blank page. That is
       * indistinguishable from the page having failed to load, which on
       * the one screen that reports on a live product is the worst thing
       * it could be mistaken for.
       *
       * "Nothing matched" and "there is nothing here" are different facts
       * and get different sentences — the first is about the question just
       * asked, the second about the pond.
       */
      if (!rows.length) {
        const searching = Boolean(q.trim()) || where.flag || where.card;
        list.replaceChildren(el(
          "p", "a-empty",
          searching ? "Nothing matched. Try fewer words." : EMPTY[where.tab],
        ));
        return;
      }
      list.replaceChildren(...rows);
    }

    search.addEventListener("input", () => {
      where = { ...where, q: search.value };
      paint();
    });
    paint();

    // Nothing to download when there is nothing to download.
    if (where.tab === "contacts" && withContacts.length) {
      const csv = el("a", "p-btn p-btn-quiet", "Download CSV");
      csv.href = "/api/admin/csv";
      // Generated on demand, never synced: a spreadsheet drifts out of step
      // with a deleted contact, and "take my duck out" has to mean it
      // everywhere.
      wrap.append(csv);
    }

    root.append(wrap);
  });
}

/**
 * A panel that is not built until it is opened.
 *
 * ══ FOLDED AWAY, AND NOT BUILT AT ALL ══
 * Rare actions hide behind one tap. Lazily, because the alternative is
 * building six controls for every one of a hundred rows on first paint, to
 * be looked at approximately never.
 *
 * Returns the chip; the caller decides where it sits.
 */
function foldout(
  panel: HTMLElement,
  label: string,
  title: string,
  build: (into: HTMLElement) => void,
): HTMLButtonElement {
  panel.hidden = true;
  const chip = button("p-chip", label, () => {
    if (!panel.childElementCount) build(panel);
    panel.hidden = !panel.hidden;
    chip.setAttribute("aria-expanded", String(!panel.hidden));
  }, title);
  chip.setAttribute("aria-expanded", "false");
  return chip;
}

function meta(d: AdminDuck): string {
  return [FORTUNES[d.fortune] ?? "", d.keeper ? `via ${d.keeper}` : "", day(d.created)]
    .filter(Boolean)
    .join(" · ");
}

function duckRow(
  d: AdminDuck,
  show: (card: string | null) => void,
  // Every registered card, so a duck with none can be pointed at one.
  // Passed in rather than re-fetched: the caller already has them.
  cardList: AdminCard[],
): HTMLElement {
  const row = el("div", "a-row");
  const head = el("p", "a-row-name", d.name || "(no name)");
  if (d.hidden) head.append(el("span", "a-badge", "hidden"));
  if (d.reports) head.append(el("span", "a-badge a-badge-hot", `${d.reports} reported`));
  row.append(head, el("p", "a-row-meta", meta(d)));
  if (d.message) row.append(el("p", "a-row-msg", `“${d.message}”`));

  /*
   * Where it came from, as a control rather than a caption. Reading a
   * serial tells you which card; tapping it shows you the rest of that
   * card's ducks, which is the question the serial was making you ask.
   */
  const actions = el("div", "a-actions");
  if (d.card) {
    actions.append(button("p-chip", provenance(d), () => show(d.card),
      `Show every duck from card ${d.card}`));
  } else {
    actions.append(el("span", "a-row-meta", "no card"));
  }

  // The one thing you do to a duck often enough to keep in reach.
  const open = el("a", "p-chip", "Open");
  open.href = `/d/${d.slug}`;
  open.target = "_blank";
  open.rel = "noreferrer";
  actions.append(open);

  /*
   * ══ EVERYTHING THAT CHANGES SOMETHING, BEHIND ONE TAP ══
   * Hide, Delete, the attach picker and the private link used to sit open
   * on every row. Delete in particular was permanently exposed at the
   * bottom of a scrolling list, which is where a thumb lands when it is
   * only trying to move the page.
   */
  const panel = el("div", "a-fold");
  actions.append(foldout(panel, "Manage", `Manage ${d.name || "this duck"}`, (into) => {
    const safe = el("div", "a-actions");
    safe.append(
      button("p-chip", d.hidden ? "Unhide" : "Hide", () => {
        void api("/hide", { id: d.id, hidden: !d.hidden }).then(load);
      }),
    );
    if (d.reports) {
      safe.append(button("p-chip", "Clear reports", () => {
        void api("/resolve", { id: d.id }).then(load);
      }));
    }

    /*
     * ══ GIVING SOMEBODY THEIR DUCK BACK ══
     * People lose the private link. Without it their duck is stranded —
     * still in the pond, still being bumped, and no longer theirs to name,
     * redecorate or take out. There is no account to recover from, so this
     * screen is the only place it can come from.
     *
     * COPIED, never printed. The key is the whole credential, and a row
     * that displays it puts it in every screenshot of this page and every
     * shoulder-glance at it. The chip says what it did and says nothing
     * about what it holds.
     */
    const who = d.name || d.slug;
    const recover = button("p-chip", "Copy private link", () => {
      void copyText(`${location.origin}/e/${d.editKey}`).then((ok) => {
        /*
         * The label AND the accessible name, together. Changing only the
         * visible text left a screen reader hearing "Copy the private link
         * for Mika" after the copy had already happened or failed — the one
         * moment the control has something new to say.
         */
        recover.textContent = ok ? "Copied" : "Copy failed";
        recover.setAttribute("aria-label", ok
          ? `Copied the private link for ${who}`
          : `Could not copy the private link for ${who}`);
        window.setTimeout(() => {
          recover.textContent = "Copy private link";
          recover.setAttribute("aria-label", `Copy the private link for ${who}`);
        }, 1600);
      });
    }, `Copy the private link for ${who}`);
    safe.append(recover);
    into.append(safe);

    /*
     * ══ "FROM NO CARD" IS REPAIRABLE ══
     * A duck reads this when the card it came off was not in `cards` at
     * the time — `mintSession` stores NULL for a serial it has never
     * heard of, because `sessions.card_id` is a foreign key and `?c=` is
     * typed text. Cards register themselves now, so no NEW duck lands
     * here; the ones written before that cannot be repaired by anything
     * automatic, because the fact was never recorded.
     *
     * So admin can say where it came from. A picker of known cards rather
     * than a text field: the serial is on the card in David's hand, and
     * typing eight Crockford characters from memory is how you attach a
     * duck to the wrong one.
     */
    if (!d.card) {
      into.append(el("p", "a-hint", "This duck predates its card being registered. Point it at the card it came from."));
      const pick = el("select", "p-input a-attach");
      const none = el("option", "", "attach to a card…");
      none.value = "";
      pick.append(none);
      for (const c of cardList) {
        const opt = el("option", "", `${c.id}${c.label ? ` · ${c.label}` : ""}`);
        opt.value = c.id;
        pick.append(opt);
      }
      pick.addEventListener("change", () => {
        if (!pick.value) return;
        void api("/card/attach", { card: pick.value, duck: d.id }).then(load);
      });
      into.append(pick);
    }

    /*
     * ══ REMOVING ONE DUCK ══
     * Hide is one tap back and is what almost everything here should be.
     * This is not: it is for a test duck, a duplicate, or somebody who
     * asked in a message rather than through their own private link — all
     * of which Hide leaves in the pond forever, invisible and counted.
     *
     * Below a rule, at the bottom, and it still asks twice — the second
     * time naming the duck, because the row it sits in looks like every
     * other row and a mis-tap here cannot be undone.
     */
    const gone = el("div", "a-danger");
    gone.append(el("p", "a-hint", "Deleting takes the duck and anything attached to it. There is no undo."));
    const bar = el("div", "a-actions");
    bar.append(button("p-chip a-chip-danger", "Delete this duck", () => {
      bar.replaceChildren(
        el("p", "a-row-meta",
          `Delete ${d.name || "this duck"}${d.contact ? " and its contact" : ""}?`),
        button("p-chip a-chip-danger", "Yes, delete", () => {
          void api("/duck/delete", { id: d.id }).then(load);
        }),
        button("p-chip", "Keep it", () => load()),
      );
    }));
    gone.append(bar);
    into.append(gone);
  }));

  row.append(actions, panel);
  return row;
}

function contactRow(d: AdminDuck, show: (card: string | null) => void): HTMLElement {
  const row = el("div", "a-row");

  /*
   * ══ THE CONTACT IS THE POINT OF THIS TAB ══
   * It used to be a line of body text below the message, the same size as
   * everything else. Somebody left an address so they could be written
   * to; the address is the payload and the rest is context, so it leads.
   */
  row.append(el("p", "a-contact", d.contact ?? ""));

  const who = el("p", "a-row-meta", "");
  who.textContent = [
    d.name || "(no name)",
    scopeLabel(d.scope, d.contactKeeper ?? d.keeper),
    day(d.created),
  ].filter(Boolean).join(" · ");
  row.append(who);

  if (d.message) row.append(el("p", "a-row-msg", `“${d.message}”`));

  /*
   * The worklist actions stay in the open. They are the job of this tab,
   * they are all reversible, and folding them away would put a tap in
   * front of the only thing anybody comes here to do.
   */
  const actions = el("div", "a-actions");
  actions.append(
    button("p-chip", d.replied ? `✓ Replied ${day(d.replied)}` : "Mark replied", () => {
      void api("/replied", { id: d.id, done: !d.replied }).then(load);
    }),
    button("p-chip", d.postcard ? `✓ Posted ${day(d.postcard)}` : "Postcard sent", () => {
      void api("/postcard", { id: d.id, done: !d.postcard }).then(load);
    }),
    button("p-chip", "Copy", () => {
      void copyText(d.contact ?? "");
    }, `Copy the contact for ${d.name || "this duck"}`),
  );
  // Which card this came off, so a contact can be traced without crossing
  // to another tab and searching for the name again.
  if (d.card) {
    actions.append(button("p-chip", d.card, () => show(d.card),
      `Show every duck from card ${d.card}`));
  }
  row.append(actions);
  return row;
}

/** "1 duck", "3 ducks". Admin is English and read by one person, but a
 *  screen that says "1 ducks" is a screen that was not looked at. */
const ducksWord = (n: number): string => `${n} duck${n === 1 ? "" : "s"}`;

function cardRow(c: AdminCard, show: (card: string | null) => void): HTMLElement {
  const row = el("div", "a-row");

  /*
   * ══ THE SERIAL IS THE HEADING ══
   * The big text used to be the keeper name, OR the label, OR a state
   * string like "kept · no name" — three different kinds of thing in one
   * slot, depending on the row. A column that means something different
   * on every line cannot be scanned, so the list had to be read.
   *
   * The serial is the only identity a card cannot lose or have renamed,
   * and it is the thing printed on the card in your hand. Every row now
   * starts with eight characters in the same monospace slot, which is
   * exactly the shape of the question "which row is this card".
   */
  const head = el("p", "a-row-serial", c.id);
  if (!c.claimed) head.append(el("span", "a-badge", "free"));
  if (c.disabled) head.append(el("span", "a-badge a-badge-hot", "off"));
  row.append(head);

  /*
   * Who has it and what state it is in — demoted to context, because it
   * is what you read AFTER you have found the row.
   *
   * `claim N` is a diagnostic, so it says what it is for rather than
   * printing a bare number: it is the mark four blows have to beat, and
   * on its own it is unreadable.
   */
  const state = c.keeper || (c.claimed ? "kept · no name" : "not claimed");
  row.append(el("p", "a-row-meta",
    [
      state, c.label, c.lang ?? "", day(c.created),
      /*
       * The claim mark rides in the meta line rather than taking a line of
       * its own. On its own row it cost a line on all hundred cards to
       * answer a question asked while debugging one — the tab got TALLER.
       * `> 7` is the whole fact: a claim is accepted only above it.
       */
      `claim > ${c.claimCounter}`,
    ].filter(Boolean).join(" · ")));

  const actions = el("div", "a-actions");
  if (c.ducks > 0) {
    actions.append(button("p-chip", ducksWord(c.ducks),
      () => show(c.id), `Show every duck from card ${c.id}`));
  } else {
    actions.append(el("span", "a-row-meta", "no ducks yet"));
  }

  /*
   * ══ EDITING A CARD IS RARE AND CONSEQUENTIAL ══
   * Folded away behind one chip rather than laid out on every row. There
   * are a hundred of these and the common act is reading them; naming a
   * keeper happens once per card, and a form on every row would drown the
   * list it is attached to.
   */
  const edit = el("div", "a-fold");
  actions.append(foldout(edit, "Edit", `Edit card ${c.id}`, (into) => {
    const note = el("p", "a-note", "");
    const mkField = (label: string, value: string, max: number, hint = ""): HTMLInputElement => {
      const wrap = el("label", "a-field");
      const input = el("input", "p-input a-input") as HTMLInputElement;
      input.type = "text";
      input.value = value;
      input.maxLength = max;
      wrap.append(el("span", "a-field-label", label), input);
      if (hint) wrap.append(el("span", "a-hint", hint));
      into.append(wrap);
      return input;
    };

    const label = mkField("Label", c.label ?? "", 40, "A note to yourself. Nobody else sees it.");
    const keeper = mkField("Keeper name", c.keeper ?? "", 18,
      "Shown on every duck from this card as “via …”. Leave blank for none.");

    /*
     * The keeper's default language. A pair of chips rather than a select,
     * because there are two and a native select on this screen would be
     * the only one in the product.
     */
    let lang = c.lang === "zh-Hant" ? "zh-Hant" : "en";
    const langs = el("div", "p-chip-row");
    const langBtns: [string, string][] = [["en", "English"], ["zh-Hant", "繁體中文"]];
    const paintLangs = () => {
      [...langs.children].forEach((b, i) => {
        const on = langBtns[i]![0] === lang;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    };
    langBtns.forEach(([value, text]) => {
      langs.append(button("p-chip", text, () => { lang = value; paintLangs(); }));
    });
    paintLangs();
    into.append(el("span", "a-field-label", "Language this card opens in"), langs);
    into.append(el("p", "a-hint",
      "A default, not a lock. A visitor whose phone asks for the other language gets it."));

    // ── save, on its own, directly under what it saves ──────────────────
    const saveRow = el("div", "a-actions");
    saveRow.append(button("p-btn a-save", "Save card", () => {
      note.textContent = "";
      void api("/card/label", { card: c.id, label: label.value })
        .then(() => api("/card/keeper", { card: c.id, name: keeper.value, lang }))
        .then(load, (err: unknown) => {
          /*
           * The one refusal somebody can act on gets its own sentence. A
           * keeper called "admin" or "pond" would be quoting the pond
           * itself on every duck from this card, which is why the
           * four-blow path refuses it too.
           */
          note.textContent = String(err).includes("409")
            ? "That keeper name is kept for the pond itself. Try another."
            : "Could not save.";
        });
    }));
    into.append(saveRow, note);

    /*
     * ══ ORDERED BY WHAT THEY COST ══
     * Everything below this rule changes who owns what, rather than what
     * a field says. It used to be mixed in with Save on one undifferen-
     * tiated row of grey chips — and "Delete all 12 ducks" sat ABOVE Save
     * in reading order, so the most destructive control on the page came
     * before the most ordinary one.
     *
     * The explanations were written in the comments here, where the
     * person choosing between these buttons could not read them. They are
     * captions now.
     */
    const stateOps = el("div", "a-section");
    stateOps.append(el("p", "a-section-title", "Change this card"));

    const ops = el("div", "a-actions");
    /*
     * Disabled, not deleted. `mintSession` refuses a disabled card, so this
     * stops new fortunes and claims dead while every duck that came off it
     * keeps its keeper — and it is one tap back, which delete never is.
     */
    ops.append(button("p-chip", c.disabled ? "Switch back on" : "Switch off", () => {
      void api("/card/disabled", { card: c.id, disabled: !c.disabled }).then(load);
    }));
    if (c.claimed) {
      ops.append(button("p-chip", "Reset keeper", () => {
        void api("/card/reset", { card: c.id }).then(load);
      }));
    }
    if (c.ducks > c.orphans) {
      ops.append(button("p-chip", `Unlink ${ducksWord(c.ducks - c.orphans)}`, () => {
        void api("/card/unlink", { card: c.id }).then(load);
      }));
    }
    stateOps.append(ops);
    stateOps.append(el("p", "a-hint",
      c.disabled
        ? "Switch back on — lets this card deal fortunes again."
        : "Switch off — stops this card dealing fortunes. Ducks it already made are untouched."));
    if (c.claimed) {
      stateOps.append(el("p", "a-hint",
        "Reset keeper — ends this keeper's turn so somebody else can claim it. "
          + "Ducks stay in the pond and keep their “via”."));
    }
    if (c.ducks > c.orphans) {
      stateOps.append(el("p", "a-hint",
        "Unlink — detaches ducks from every keeper's turn. They stay in the pond, "
          + "lose the “via”, and can be adopted again."));
    }
    into.append(stateOps);

    // ── the things that cannot be undone ────────────────────────────────
    const danger = el("div", "a-danger");
    danger.append(el("p", "a-section-title", "Cannot be undone"));

    if (c.ducks > 0) {
      /*
       * Typed rather than tapped: it takes contacts with it — the trigger
       * sees to that, which is the point — and a second tap is not enough
       * friction for a thing that cannot be undone and affects people who
       * are not in the room.
       */
      danger.append(el("p", "a-hint",
        `Empty card — deletes all ${ducksWord(c.ducks)} from this card and every contact on them.`));
      const empty = el("div", "a-actions");
      empty.append(button("p-chip a-chip-danger", `Delete all ${ducksWord(c.ducks)}`, () => {
        const typed = el("input", "p-input a-input") as HTMLInputElement;
        typed.placeholder = c.id;
        typed.setAttribute("aria-label", `Type ${c.id} to confirm`);
        empty.replaceChildren(
          el("p", "a-row-meta", `Type ${c.id} to confirm.`),
          typed,
          button("p-chip a-chip-danger", "Delete them", () => {
            if (typed.value.trim().toUpperCase() !== c.id) {
              note.textContent = "That is not the serial.";
              return;
            }
            void api("/card/ducks/delete", { card: c.id }).then(load);
          }),
          button("p-chip", "Keep them", () => load()),
        );
      }));
      danger.append(empty);
    } else {
      /*
       * ══ DELETE ONLY WHEN IT COSTS NOTHING ══
       * The server refuses a card with any ducks or any epochs, because
       * deleting one cascades its epochs away and strips every duck that
       * came off it of its keeper — for people who never asked — and
       * adding the serial back cannot undo it. So the button is only
       * offered for a card that has never been used, and it still asks
       * twice.
       */
      danger.append(el("p", "a-hint",
        "Delete card — removes the serial entirely. Only possible because nothing hangs off it."));
      const gone = el("div", "a-actions");
      gone.append(button("p-chip a-chip-danger", "Delete card", () => {
        gone.replaceChildren(
          el("p", "a-row-meta", `Delete ${c.id}?`),
          button("p-chip a-chip-danger", "Yes, delete", () => {
            void api("/card/delete", { card: c.id }).then(load, () => {
              note.textContent = "That card is in use. Switch it off instead.";
            });
          }),
          button("p-chip", "Keep it", () => load()),
        );
      }));
      danger.append(gone);
    }
    into.append(danger);
  }));

  row.append(actions, edit);
  return row;
}

void load();
