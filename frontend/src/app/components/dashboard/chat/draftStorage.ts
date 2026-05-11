/**
 * Phase C (s22): small, pure helper module for persisting the chat
 * composer draft to localStorage.
 *
 * s31 wave 2 (F3, 2026-04-27): drafts are now scoped per thread.
 * Switching from one thread to another no longer clobbers the
 * other thread's half-typed prompt. Storage layout:
 *
 *   - DRAFT_KEY_LEGACY (`samga.chat.composerDraft`)
 *       Holds the draft for the *unsaved* / orphan thread (the
 *       composer-on-empty-rail case). Same key as before so existing
 *       drafts written by s22 builds keep loading on first paint.
 *   - DRAFT_KEY_PREFIX + threadId (`samga.chat.composerDraft.42`)
 *       One key per saved thread. We never list-and-prune these:
 *       deleting a thread is rare, the TTL drops them on its own,
 *       and DOMStorage quota in modern browsers is ~5MB which fits
 *       thousands of empty-string drafts.
 *
 * Why this exists as its own file:
 *   - Keeps the React component focused on UI; the I/O + SSR/private-
 *     browsing fallbacks live here.
 *   - Lets the Node harness exercise every branch without spinning up
 *     jsdom (just inject a Storage-shaped stub).
 *
 * Key behaviour:
 *   - `loadDraft(threadId?)` returns "" on any failure (private-mode
 *     Safari, storage disabled, JSON corruption, expired payload).
 *   - `saveDraft(text, threadId?)` is a no-op when the text is only
 *     whitespace so we don't leak an empty string into storage and
 *     get a ghost focus artifact on reload.
 *   - Drafts expire after 24h so a stale half-typed prompt from
 *     yesterday doesn't silently resurrect itself.
 *   - `clearDraft(threadId?)` is idempotent.
 *   - `threadId === null` / `undefined` ⇒ orphan/legacy bucket.
 */

/** Legacy key — used for the unsaved/orphan thread. */
export const DRAFT_KEY_LEGACY = "samga.chat.composerDraft";
export const DRAFT_KEY_PREFIX = "samga.chat.composerDraft.";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Resolve the localStorage key for a given thread id. Defensive on
 *  non-finite or non-positive ids (collapse to the legacy key — a
 *  freshly-created thread that hasn't been persisted yet has id=null
 *  on the FE). */
export function draftKeyFor(threadId: number | null | undefined): string {
  if (threadId === null || threadId === undefined) return DRAFT_KEY_LEGACY;
  if (typeof threadId !== "number") return DRAFT_KEY_LEGACY;
  if (!Number.isFinite(threadId) || !Number.isInteger(threadId)) {
    return DRAFT_KEY_LEGACY;
  }
  if (threadId <= 0) return DRAFT_KEY_LEGACY;
  return `${DRAFT_KEY_PREFIX}${threadId}`;
}

interface DraftPayload {
  v: 1;
  text: string;
  /** ms since epoch */
  at: number;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    // Access `.localStorage` inside a try — private Safari throws on
    // mere access to this property in some older builds.
    const s = window.localStorage;
    // Probe write — Safari private mode returns a storage object that
    // throws QuotaExceededError on .setItem.
    const probeKey = "__samga.probe__";
    s.setItem(probeKey, "1");
    s.removeItem(probeKey);
    return s;
  } catch {
    return null;
  }
}

export function loadDraft(
  threadId: number | null | undefined = null,
  now: () => number = () => Date.now(),
  storage: StorageLike | null = getStorage(),
): string {
  if (!storage) return "";
  const key = draftKeyFor(threadId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (!parsed || parsed.v !== 1 || typeof parsed.text !== "string") {
      // Shape drift — discard silently.
      storage.removeItem(key);
      return "";
    }
    if (typeof parsed.at !== "number" || now() - parsed.at > DRAFT_TTL_MS) {
      storage.removeItem(key);
      return "";
    }
    return parsed.text;
  } catch {
    // JSON corruption or any other parse error — drop it.
    try {
      storage.removeItem(key);
    } catch {
      /* noop */
    }
    return "";
  }
}

export function saveDraft(
  text: string,
  threadId: number | null | undefined = null,
  now: () => number = () => Date.now(),
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;
  const key = draftKeyFor(threadId);
  // Don't persist whitespace-only drafts.
  if (!text || !text.trim()) {
    try {
      storage.removeItem(key);
    } catch {
      /* noop */
    }
    return;
  }
  try {
    const payload: DraftPayload = { v: 1, text, at: now() };
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage full / disabled — silently skip */
  }
}

export function clearDraft(
  threadId: number | null | undefined = null,
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;
  const key = draftKeyFor(threadId);
  try {
    storage.removeItem(key);
  } catch {
    /* noop */
  }
}
