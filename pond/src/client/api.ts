// ABOUTME: Provides the browser's typed Pond API and resilient local interaction state.
// ABOUTME: Keeps unfinished intention artwork across mobile reloads without treating it as durable identity.

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
  /**
   * Whether this card is going spare.
   *
   * Answered by the server, never inferred here from `keeper === null`.
   * Those are different questions: a keeper who left their name blank has
   * still claimed the card, and offering it to the next visitor would be
   * offering something already taken.
   */
  keeperOffer?: boolean;
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
  /*
   * `editKey` is optional and only ever affects `keeperOffer`. The server
   * needs it to answer the later-visit case: a fresh tap that has not
   * released a duck, by somebody who already has one from that card. It
   * is sent as a query parameter to match the GET, and left off entirely
   * when there is no duck, so an empty value never reads as a malformed
   * credential.
   */
  session: (editKey?: string | null) =>
    request<SessionState>(
      editKey ? `/session?editKey=${encodeURIComponent(editKey)}` : "/session",
    ),

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
  claim: (
    card: string,
    counter: number,
    token: string,
    editKey?: string | null,
    // Only after the person has been shown whose card it is and said yes.
    confirm = false,
  ) =>
    request<{ ok: boolean; orphans?: number; takeover?: boolean; keeper?: string }>("/claim", {
      method: "POST",
      // The duck this browser already has, if any. The server links it as
      // the keeper's own only when this card minted it — which is what
      // leaves a way back into card settings after the cookie expires.
      body: JSON.stringify({
        card, counter, token,
        ...(editKey ? { editKey } : {}),
        ...(confirm ? { confirm: true } : {}),
      }),
    }),

  /**
   * Keep the card you just used.
   *
   * The session cookie is the claim: it is what proves somebody is holding
   * this card right now, and the server already knows which card it came
   * from. `editKey` is only needed on a LATER visit, where the fresh tap
   * has released no duck of its own and the key answers which duck from
   * that card is theirs. Neither alone is enough.
   *
   * A 409 means somebody else got there first, which is not a failure —
   * it is a reason to take the offer down rather than to retry it.
   */
  claimFirst: (editKey?: string | null) =>
    request<{ ok: boolean; orphans?: number }>("/claim/first", {
      method: "POST",
      // Only needed when this session has not released a duck of its own.
      // Harmless when it has: the server prefers `spent_duck`.
      body: JSON.stringify(editKey ? { editKey } : {}),
    }),

  /**
   * Hand the card on.
   *
   * Ends the tenure and nothing else: every duck stays in the pond and
   * keeps the `via` it had, because it WAS from that card. The private
   * link is accepted as well as the cookie, since the cookie lasts an
   * hour and a decision like this is usually made later than that.
   */
  keeperEnd: (editKey?: string) => request<{ ok: true }>("/keeper/end", {
    method: "POST",
    body: JSON.stringify(editKey ? { editKey } : {}),
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
    request<{ ok: boolean; text?: string; cooldown?: number; retryAfter?: number }>("/say", {
      method: "POST",
      body: JSON.stringify({ editKey, text }),
    }),

  mine: (editKey: string) => request<{ duck: Record<string, unknown> }>(`/duck/${editKey}`),

  /**
   * A duck by its public address. No key involved — this is what anybody
   * sees, and it is how the card setup screen can show the keeper the duck
   * they linked rather than the string they linked it with.
   */
  bySlug: (slug: string) =>
    request<{ duck: PondDuck; bumpers: Bumper[] }>(
      `/duck/by-slug/${encodeURIComponent(slug)}`,
    ),

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
   * The response says only that it is done. Whether there WAS one is not
   * reported and cannot be asked: it is the same fact this route refuses
   * to serve over GET, and spending it destructively would not make it
   * less of a leak. See src/worker/contact.ts.
   */
  /**
   * Set or replace the contact left with a duck.
   *
   * There is no matching read, and there never will be: the screen that
   * calls this shows an EMPTY field, so this is "replace", not "edit".
   * See src/worker/release.ts.
   */
  setContact: (editKey: string, contact: string) =>
    request<{ ok: true }>(`/duck/${editKey}/contact`, {
      method: "PUT",
      body: JSON.stringify({ contact }),
    }),

  withdrawContact: (editKey: string) =>
    request<{ ok: true }>(`/duck/${editKey}/contact`, { method: "DELETE" }),
};

/**
 * Draft persistence.
 *
 * The single most likely way to lose someone's work is the OS reclaiming a
 * backgrounded Safari tab while they're picking a hat. Every change writes
 * here; nothing is cleared until the server has confirmed the release.
 */
const DRAFT_KEY = "pond.intention-draft.v1";
const DRAFT_TTL_MS = 60 * 60 * 1000;

export interface Draft {
  tint: number;
  stickers: { id: string; x: number; y: number }[];
  paint: string;
  intention: string;
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

/**
 * When this duck may speak again, in epoch seconds.
 *
 * ══ WHY THIS IS REMEMBERED AT ALL ══
 * The say button greys out and counts down, so it has to know the deadline
 * before anything is tapped — and there is nowhere else to learn it. A say
 * vanishes from the pond payload after SAY_VISIBLE_SEC, and the cooldown
 * outlives it by four minutes, so for most of the quiet period the pond
 * cannot say when it ends.
 *
 * The server supplies a DURATION and this turns it into a local deadline,
 * so the two clocks never have to agree — an absolute time from the server
 * compared against a phone's clock would free the button early or hold it
 * shut long after the pond would take another message.
 *
 * This only carries the deadline across a reload.
 * It is a convenience, never the enforcement: the cooldown is checked in
 * one atomic INSERT on the server, and a cleared localStorage buys nothing
 * but a refusal a second later.
 */
const QUIET_UNTIL = "pond.quietUntil.v1";

export function rememberQuiet(seconds: number): void {
  try {
    localStorage.setItem(QUIET_UNTIL, String(Math.ceil(Date.now() / 1000) + seconds));
  } catch {
    /* The button just stays alive and the server refuses. No harm. */
  }
}

/** Seconds still to wait, or 0 when it may speak now. */
export function quietFor(): number {
  try {
    const at = Number(localStorage.getItem(QUIET_UNTIL) ?? 0);
    if (!Number.isFinite(at) || at <= 0) return 0;
    return Math.max(0, Math.ceil(at - Date.now() / 1000));
  } catch {
    return 0;
  }
}

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
