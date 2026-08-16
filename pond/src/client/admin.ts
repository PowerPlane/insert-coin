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
}

type Tab = "ducks" | "contacts" | "cards";

const root = document.getElementById("pond")!;
const FORTUNES = ["大吉", "小吉", "末吉", "凶"];

const day = (t: number | null): string =>
  t ? new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

/** The scope, said as people. Never as a value. */
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
  cards: "No cards claimed yet. A card appears here once somebody blows on it four times.",
};

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
 * So the screen remembers where it was, including which card it was
 * filtered to.
 */
let where: { tab: Tab; card: string | null } = { tab: "ducks", card: null };

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
  view(state.ducks, state.cards, where.tab, where.card);
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

function view(
  ducks: AdminDuck[],
  cards: AdminCard[],
  tab: Tab,
  /**
   * Showing one card's ducks only.
   *
   * ══ A RELATIONSHIP YOU CAN FOLLOW, NOT ONE YOU CAN READ ══
   * Every duck knows its card and every card knows how many ducks it has,
   * and neither fact was reachable from the other. The question this
   * screen is actually asked — "what came off the card I handed to
   * Sam?" — could only be answered by reading every row.
   *
   * So the provenance chip on a duck and the count on a card are the same
   * control from two directions, and both land here.
   */
  cardFilter: string | null = null,
): void {
  // Recorded on every render, so the next `load()` comes back here.
  where = { tab, card: cardFilter };
  screen(root, () => {
    root.replaceChildren();
    const wrap = el("div", "a-screen");

    const head = el("div", "a-head");
    head.append(el("h1", "a-title", "Admin"), el("span", "p-eyebrow", "ducky.davidyang.work"));
    wrap.append(head);

    const tabs = el("div", "p-tabs");
    const withContacts = ducks.filter((d) => d.contact);
    const reported = ducks.filter((d) => d.reports > 0).length;
    for (const [key, label] of [
      ["ducks", `Ducks ${ducks.length}`],
      ["contacts", `Contacts ${withContacts.length}`],
      ["cards", `Cards ${cards.length}`],
    ] as [Tab, string][]) {
      // Changing tab keeps the filter: going Ducks -> Cards -> Ducks to
      // check something should not silently drop what you were looking at.
      const b = button("p-tab", label, () => view(ducks, cards, key, cardFilter));
      b.classList.toggle("on", tab === key);
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

    if (reported && tab === "ducks") {
      wrap.append(el("p", "a-flag", `${reported} reported`));
    }

    /*
     * The filter, when one is on. Shaped like the pond's own whistle bar —
     * what it is, and an ✕ — because it is the same idea in a different
     * room, and the admin should not invent a second vocabulary for
     * "you are looking at a subset".
     */
    const show = (next: string | null) => view(ducks, cards, "ducks", next);
    if (cardFilter) {
      const named = cards.find((c) => c.id === cardFilter);
      const bar = el("div", "a-filter");
      bar.append(
        el("span", "a-filter-who",
          named?.keeper ? `${named.keeper} · ${cardFilter}` : cardFilter),
        button("p-chip", "✕", () => show(null), "Show every card again"),
      );
      wrap.append(bar);
    }

    const shown = cardFilter ? ducks.filter((d) => d.card === cardFilter) : ducks;
    const shownContacts = withContacts.filter((d) => !cardFilter || d.card === cardFilter);

    const list = el("div", "a-list");
    if (tab === "ducks") shown.forEach((d) => list.append(duckRow(d, show, cards)));
    if (tab === "contacts") shownContacts.forEach((d) => list.append(contactRow(d, ducks, cards)));
    if (tab === "cards") cards.forEach((c) => list.append(cardRow(c, show)));

    /*
     * ══ AN EMPTY LIST STILL HAS TO SAY SOMETHING ══
     * All three tabs rendered nothing at all when they were empty: a
     * heading, three counts reading zero, and a blank page. That is
     * indistinguishable from the page having failed to load, which on the
     * one screen that reports on a live product is the worst thing it could
     * be mistaken for.
     *
     * Each says what would put something here, so an empty tab reports a
     * fact about the pond rather than a fact about the request.
     */
    if (!list.childElementCount) {
      list.append(el("p", "a-empty", EMPTY[tab]));
    }
    wrap.append(list);

    // Nothing to download when there is nothing to download.
    if (tab === "contacts" && withContacts.length) {
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
   *
   * A duck with no card cannot lead anywhere, so it says so and stays
   * inert rather than looking live and doing nothing.
   */
  const from = el("div", "a-from");
  from.append(el("span", "a-from-label", "from"));
  if (d.card) {
    from.append(button("p-chip", provenance(d), () => show(d.card),
      `Show every duck from card ${d.card}`));
  } else {
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
    from.append(el("span", "a-row-meta", provenance(d)));
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
    from.append(pick);
  }
  row.append(from);

  const actions = el("div", "a-actions");
  actions.append(
    button("p-chip", d.hidden ? "Unhide" : "Hide", () => {
      void api("/hide", { id: d.id, hidden: !d.hidden }).then(load);
    }),
  );
  if (d.reports) {
    actions.append(button("p-chip", "Clear reports", () => {
      void api("/resolve", { id: d.id }).then(load);
    }));
  }
  const open = el("a", "p-chip", "Open");
  open.href = `/d/${d.slug}`;
  open.target = "_blank";
  open.rel = "noreferrer";
  actions.append(open);

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
  const recover = button("p-chip", "Copy link", () => {
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
        recover.textContent = "Copy link";
        recover.setAttribute("aria-label", `Copy the private link for ${who}`);
      }, 1600);
    });
  }, `Copy the private link for ${who}`);
  actions.append(recover);
  row.append(actions);
  return row;
}

function contactRow(d: AdminDuck, ducks: AdminDuck[], cards: AdminCard[]): HTMLElement {
  const row = el("div", "a-row");
  row.append(
    el("p", "a-row-name", d.name || "(no name)"),
    // The consent, in names, on every row it appears on.
    el("p", "a-row-meta", `${scopeLabel(d.scope, d.keeper)} · ${day(d.created)}`),
  );
  if (d.message) row.append(el("p", "a-row-msg", `“${d.message}”`));
  row.append(el("p", "a-contact", d.contact ?? ""));

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
    }),
  );
  row.append(actions);
  void ducks;
  void cards;
  return row;
}

function cardRow(c: AdminCard, show: (card: string | null) => void): HTMLElement {
  const row = el("div", "a-row");
  /*
   * ══ THREE STATES, NOT TWO ══
   * A card with no keeper NAME reads the same as a card nobody has
   * claimed, and they are not the same thing at all: the first is taken
   * and the second is going spare. Deciding whether to set somebody up as
   * keeper is exactly the decision that turns on it.
   */
  const head = el(
    "p", "a-row-name",
    c.keeper || c.label || (c.claimed ? "kept · no name" : "not claimed"),
  );
  if (!c.claimed) head.append(el("span", "a-badge", "free"));
  if (c.disabled) head.append(el("span", "a-badge", "disabled"));
  row.append(head);
  // The serial IS shown here and nowhere else: this is the one reader who
  // needs to match a row to a card in their hand.
  row.append(
    el("p", "a-row-meta", [c.id, c.lang ?? "", day(c.created)].filter(Boolean).join(" · ")),
  );

  /*
   * The duck count, as the way in. It was a word in a list — the one
   * number on this screen somebody actually wants to act on, set as
   * though it were the language code next to it.
   *
   * A card with none is not a link to an empty list; it says so plainly.
   */
  const actions = el("div", "a-actions");
  if (c.ducks > 0) {
    actions.append(button("p-chip", `${c.ducks} ${c.ducks === 1 ? "duck" : "ducks"}`,
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
  const edit = el("div", "a-edit");
  edit.hidden = true;
  actions.append(button("p-chip", "Edit", () => {
    edit.hidden = !edit.hidden;
  }, `Edit card ${c.id}`));
  row.append(actions);

  const note = el("p", "a-row-meta", "");
  const field = (label: string, value: string, max: number): HTMLInputElement => {
    const wrap = el("label", "a-field");
    const input = el("input", "p-input");
    input.type = "text";
    input.value = value;
    input.maxLength = max;
    wrap.append(el("span", "a-field-label", label), input);
    edit.append(wrap);
    return input;
  };

  const label = field("Label — admin only", c.label ?? "", 40);
  const keeper = field("Keeper name — shown as “via …”", c.keeper ?? "", 18);

  /*
   * The keeper's default language. A pair of chips rather than a select,
   * because there are two and a native select on this screen would be the
   * only one in the product.
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
  edit.append(el("span", "a-field-label", "Language this card opens in"), langs);

  const save = el("div", "a-actions");
  save.append(button("p-chip", "Save card", () => {
    note.textContent = "";
    void api("/card/label", { card: c.id, label: label.value })
      .then(() => api("/card/keeper", { card: c.id, name: keeper.value, lang }))
      .then(load, async (err: unknown) => {
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

  /*
   * Disabled, not deleted. `mintSession` refuses a disabled card, so this
   * stops new fortunes and claims dead while every duck that came off it
   * keeps its keeper — and it is one tap back, which delete never is.
   */
  save.append(button("p-chip", c.disabled ? "Switch back on" : "Switch off", () => {
    void api("/card/disabled", { card: c.id, disabled: !c.disabled }).then(load);
  }));

  /*
   * ══ DELETE ONLY WHEN IT COSTS NOTHING ══
   * The server refuses a card with any ducks or any epochs, because
   * deleting one cascades its epochs away and strips every duck that came
   * off it of its keeper — for people who never asked — and adding the
   * serial back cannot undo it. So the button is only offered for a card
   * that has never been used, and it still asks twice.
   */
  /*
   * ══ MAKING A CARD NEW AGAIN ══
   * "Reset this card" sounds like one thing and is three with very
   * different consequences, so it is three chips. None of them deletes a
   * duck; the one that does is below, behind a typed confirmation.
   *
   *   Reset keeper  — ends the tenure. Ducks stay, and keep their `via`,
   *                   because they WERE from that keeper's card.
   *   Unlink ducks  — detaches them from every tenure. They stay in the
   *                   pond, lose the `via`, and become adoptable again.
   *   Empty card    — deletes them, contacts and all.
   */
  const reset = el("div", "a-actions");
  if (c.claimed) {
    reset.append(button("p-chip", "Reset keeper", () => {
      void api("/card/reset", { card: c.id }).then(load);
    }));
  }
  if (c.ducks > c.orphans) {
    reset.append(button("p-chip", `Unlink ${c.ducks - c.orphans} duck(s)`, () => {
      void api("/card/unlink", { card: c.id }).then(load);
    }));
  }
  if (reset.children.length) save.append(...[...reset.children]);

  if (c.ducks > 0) {
    /*
     * The destructive one. Typed rather than tapped: it takes contacts
     * with it — the trigger sees to that, which is the point — and a
     * second tap is not enough friction for a thing that cannot be
     * undone and affects people who are not in the room.
     */
    const empty = el("div", "a-actions");
    empty.append(button("p-chip a-chip-danger", `Delete all ${c.ducks} ducks`, () => {
      const typed = el("input", "p-input");
      typed.placeholder = c.id;
      empty.replaceChildren(
        el("p", "a-row-meta",
          `Deletes ${c.ducks} duck(s) and every contact on them. Type ${c.id} to confirm.`),
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
    edit.append(empty);
  }

  if (c.ducks === 0) {
    const danger = el("div", "a-actions");
    danger.append(button("p-chip a-chip-danger", "Delete card", () => {
      danger.replaceChildren(
        el("p", "a-row-meta", `Delete ${c.id}? Only possible because nothing hangs off it.`),
        button("p-chip a-chip-danger", "Yes, delete", () => {
          void api("/card/delete", { card: c.id }).then(load, () => {
            note.textContent = "That card is in use. Switch it off instead.";
          });
        }),
        button("p-chip", "Keep it", () => load()),
      );
    }));
    edit.append(save, danger, note);
  } else {
    edit.append(save, note);
  }

  row.append(edit);
  return row;
}

void load();
