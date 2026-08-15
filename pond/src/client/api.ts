/**
 * Talking to the Worker.
 *
 * Mobile-first means assuming the network is bad, the tab gets backgrounded,
 * and the page may be reloaded by the OS under memory pressure at any point.
 * So: every write is retryable, nothing is destroyed locally until the
 * server has confirmed, and a draft survives a reload.
 */

import type { PondDuck, Sticker } from "./types.js";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    // Offline, airplane mode, tunnel. Distinguish it from a 4xx so the UI
    // can say "try again" rather than "something went wrong".
    throw new ApiError("offline", 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body is fine for some responses */
  }

  if (!res.ok) {
    const data = (body ?? {}) as { error?: string; retryAfter?: number };
    throw new ApiError(data.error ?? `http ${res.status}`, res.status, data.retryAfter ?? 0);
  }
  return body as T;
}

/** A duck that keeps bumping this one — enough to draw it, and to name it. */
export interface Bumper {
  slug: string;
  name: string;
  count: number;
  fortune: number;
  tint: number;
  stickers: Sticker[];
  paint: string;
}

export interface SessionState {
  active: boolean;
  fortune?: number;
  spent?: boolean;
  /** The keeper of the card that was tapped, if they named themselves. */
  keeper?: string | null;
}

/**
 * Who a contact may be read by.
 *
 * Stated to the person in NAMES on every screen it appears on — "shared
 * with Sam and David", never "scope: 2". Choosing nobody is not a value
 * here: it means no contact is sent at all, so there is no row and nothing
 * to leak. See docs/pond/UI.md § 9.
 *
 * Omitting it means `"david"`, which is the only thing the contact screen
 * promises out loud. Widening it has to be something the person did.
 */
export type ContactScope = "david" | "keeper" | "keeper_and_david";

/** The four buttons on the report sheet, in the order they appear. */
export type ReportReason = "rude" | "private" | "spam" | "other";

export const api = {
  session: () => request<SessionState>("/session"),

  pond: () => request<{ ducks: PondDuck[]; now: number }>("/pond"),
  /** Who keeps bumping this duck. Fetched when its card opens, not before. */
  bumpers: (duck: string) =>
    request<{ bumpers: Bumper[] }>(`/bumpers?duck=${encodeURIComponent(duck)}`),

  release: (duck: {
    tint: number;
    stickers: { id: string; x: number; y: number }[];
    paint: string;
    name: string;
    message: string;
    contact?: string;
    scope?: ContactScope;
  }) =>
    request<{ id: string; slug: string; editKey: string }>("/duck", {
      method: "POST",
      body: JSON.stringify(duck),
    }),

  /**
   * Bump another duck.
   *
   * Takes YOUR edit key as well as their id, because a bump is a thing one
   * duck does to another — "Make a duck to bump" is not a nag, it is the
   * shape of the feature. The server refuses an unauthenticated `from`, so
   * nobody can spend your ten unreturned bumps for you.
   *
   * A 409 means the cap: bump them back to free a slot.
   */
  bump: (editKey: string, id: string) =>
    request<{ ok: true; bumps: number; unreturned: number; from: string }>("/bump", {
      method: "POST",
      body: JSON.stringify({ editKey, id }),
    }),

  /**
   * Claim a card that arrived armed.
   *
   * Every refusal comes back the same — a forged token and a spent counter
   * are indistinguishable from outside, so somebody walking the counter
   * space learns nothing about how close they got.
   */
  claim: (card: string, counter: number, token: string) =>
    request<{ ok: boolean; orphans?: number }>("/claim", {
      method: "POST",
      body: JSON.stringify({ card, counter, token }),
    }),

  /** Idempotent: reporting twice is the same report, and says so. */
  report: (id: string, reason: ReportReason, note?: string) =>
    request<{ ok: true; filed: boolean }>("/report", {
      method: "POST",
      body: JSON.stringify({ id, reason, note }),
    }),

  /** Being late is not an error — the server says so explicitly. */
  extinguish: (id: string) =>
    request<{ ok: true; alreadyOut: boolean; credited: boolean }>(`/fire/${id}/out`, {
      method: "POST",
    }),

  say: (editKey: string, text: string) =>
    request<{ ok: boolean; text?: string; retryAfter?: number }>("/say", {
      method: "POST",
      body: JSON.stringify({ editKey, text }),
    }),

  mine: (editKey: string) => request<{ duck: Record<string, unknown> }>(`/duck/${editKey}`),

  /**
   * Is this public address free?
   *
   * Answers only about the one it was asked about, so it leaks nothing that
   * visiting /d/<slug> would not already reveal.
   */
  slugFree: (slug: string) =>
    request<{ ok: boolean; slug: string; reason: string | null }>(
      `/slug/check?s=${encodeURIComponent(slug)}`,
    ),

  /** Rename a duck's public address. 409 means somebody already has it. */
  rename: (editKey: string, slug: string) =>
    request<{ ok: true; slug: string }>("/slug", {
      method: "POST",
      body: JSON.stringify({ editKey, slug }),
    }),

  update: (
    editKey: string,
    duck: {
      tint: number;
      stickers: { id: string; x: number; y: number }[];
      paint: string;
      name: string;
      message: string;
    },
  ) => request<{ ok: true }>(`/duck/${editKey}`, { method: "PATCH", body: JSON.stringify(duck) }),

  remove: (editKey: string) => request<{ ok: true }>(`/duck/${editKey}`, { method: "DELETE" }),

  /**
   * Take back the contact left with a duck, keeping the duck.
   *
   * `removed` says whether there was one to take. There is deliberately no
   * way to ASK that question — the answer only exists as a consequence of
   * withdrawing, so a private link cannot be used to find out whether
   * somebody left their number. See src/worker/contact.ts.
   */
  withdrawContact: (editKey: string) =>
    request<{ ok: true; removed: boolean }>(`/duck/${editKey}/contact`, { method: "DELETE" }),
};

/**
 * Draft persistence.
 *
 * The single most likely way to lose someone's work is the OS reclaiming a
 * backgrounded Safari tab while they're picking a hat. Every change writes
 * here; nothing is cleared until the server has confirmed the release.
 */
const DRAFT_KEY = "pond.draft.v1";
const DRAFT_TTL_MS = 60 * 60 * 1000;

export interface Draft {
  tint: number;
  stickers: { id: string; x: number; y: number }[];
  paint: string;
  name: string;
  message: string;
  contact: string;
  scope: ContactScope;
  savedAt: number;
}

export function saveDraft(d: Omit<Draft, "savedAt">): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    // Private mode, quota, or a locked-down in-app browser. Losing the
    // draft is bad but not worth taking the whole flow down for.
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || typeof d !== "object") return null;
    if (Date.now() - (d.savedAt ?? 0) > DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The edit key, kept locally so "find my duck" works without the emailed
 * link. This is a convenience copy — the link is still the real credential,
 * because localStorage does not survive a new device or a cleared browser.
 */
const KEY_STORE = "pond.editKey.v1";

export function rememberEditKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORE, key);
  } catch {
    /* the emailed link is the durable copy */
  }
}

export function recallEditKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}
