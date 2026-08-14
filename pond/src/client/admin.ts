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

import { button, el, field, screen } from "./dom.js";

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
}

interface AdminCard {
  id: string;
  label: string;
  created: number;
  disabled: number;
  keeper: string | null;
  lang: string | null;
  ducks: number;
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

async function load(): Promise<void> {
  let state: { ducks: AdminDuck[]; cards: AdminCard[] };
  try {
    state = await api<{ ducks: AdminDuck[]; cards: AdminCard[] }>("");
  } catch {
    return signIn();
  }
  view(state.ducks, state.cards, "ducks");
}

function view(ducks: AdminDuck[], cards: AdminCard[], tab: Tab): void {
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
      const b = button("p-tab", label, () => view(ducks, cards, key));
      b.classList.toggle("on", tab === key);
      tabs.append(b);
    }
    wrap.append(tabs);

    if (reported && tab === "ducks") {
      wrap.append(el("p", "a-flag", `${reported} reported`));
    }

    const list = el("div", "a-list");
    if (tab === "ducks") ducks.forEach((d) => list.append(duckRow(d, ducks, cards)));
    if (tab === "contacts") withContacts.forEach((d) => list.append(contactRow(d, ducks, cards)));
    if (tab === "cards") cards.forEach((c) => list.append(cardRow(c)));

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

function duckRow(d: AdminDuck, ducks: AdminDuck[], cards: AdminCard[]): HTMLElement {
  const row = el("div", "a-row");
  const head = el("p", "a-row-name", d.name || "(no name)");
  if (d.hidden) head.append(el("span", "a-badge", "hidden"));
  if (d.reports) head.append(el("span", "a-badge a-badge-hot", `${d.reports} reported`));
  row.append(head, el("p", "a-row-meta", meta(d)));
  if (d.message) row.append(el("p", "a-row-msg", `“${d.message}”`));

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
  row.append(actions);
  void ducks;
  void cards;
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
      void navigator.clipboard?.writeText(d.contact ?? "");
    }),
  );
  row.append(actions);
  void ducks;
  void cards;
  return row;
}

function cardRow(c: AdminCard): HTMLElement {
  const row = el("div", "a-row");
  const head = el("p", "a-row-name", c.keeper ?? c.label ?? c.id);
  if (c.disabled) head.append(el("span", "a-badge", "disabled"));
  row.append(head);
  // The serial IS shown here and nowhere else: this is the one reader who
  // needs to match a row to a card in their hand.
  row.append(
    el("p", "a-row-meta", [c.id, `${c.ducks} ducks`, c.lang ?? "", day(c.created)]
      .filter(Boolean)
      .join(" · ")),
  );
  return row;
}

void load();
