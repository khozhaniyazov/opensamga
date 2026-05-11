/**
 * s32 (E2, 2026-04-27) — client-side thread pinning.
 *
 * E2 ships pinned-on-top affordance entirely in localStorage. We
 * deliberately did NOT add a `is_pinned` column to `chat_threads`
 * this wave because the alembic tree currently has 4 heads
 * (scale02_composite_indexes, d2c3606882dd, s22d_drop_dead_tables,
 * s26p7_competition_quota) — a new migration here is risky until
 * the heads are consolidated, and that's a separate boss-call.
 *
 * Tradeoffs:
 *   - Pins are per-browser, not per-user — a pinned thread on
 *     desktop won't appear pinned on mobile until E2's BE column
 *     ships.
 *   - The legacy / orphan thread (id === null) cannot be pinned;
 *     it's always rendered as the topmost item by ThreadRail
 *     anyway, so no behaviour is missing.
 *
 * Storage layout: a single localStorage key
 * `samga.chat.pinnedThreads` holding a JSON array of thread ids.
 * One global blob (not per-key) because the entire set is needed
 * on every render for sorting; per-key would mean N storage reads
 * per ThreadRail mount.
 *
 * Pure helpers in this module so vitest pins the contract; the
 * React side reads them in `useThreadPins`.
 */

export const PINNED_KEY = "samga.chat.pinnedThreads";
/** Hard cap to keep the storage payload bounded — boss UX guidance:
 *  pinning is an "above-the-fold" signal, not a folder system. If a
 *  user wants more than this, they probably want E3 folders. */
export const MAX_PINNED = 12;

interface PinPayload {
  v: 1;
  ids: number[];
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    const probe = "__samga.pin.probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Read the pinned ids set. Returns an empty array on any failure
 *  (private-mode storage, JSON corruption, schema drift) — the
 *  caller treats this as "nothing pinned". */
export function loadPinnedIds(
  storage: StorageLike | null = getStorage(),
): number[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PinPayload>;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ids)) {
      storage.removeItem(PINNED_KEY);
      return [];
    }
    // Coerce to integers, drop NaN / non-positive — defensive against
    // legacy junk OR a future thread-id-as-string drift.
    const cleaned: number[] = [];
    for (const v of parsed.ids) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
        cleaned.push(n);
      }
    }
    return cleaned;
  } catch {
    try {
      storage.removeItem(PINNED_KEY);
    } catch {
      /* noop */
    }
    return [];
  }
}

/** Persist the pinned ids set. Whitespace/empty is OK — we keep an
 *  empty array rather than removing the key so the schema version
 *  is still pinned. Truncates to MAX_PINNED. */
export function savePinnedIds(
  ids: number[],
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;
  try {
    const cleaned: number[] = [];
    const seen = new Set<number>();
    for (const v of ids) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      cleaned.push(n);
      if (cleaned.length >= MAX_PINNED) break;
    }
    const payload: PinPayload = { v: 1, ids: cleaned };
    storage.setItem(PINNED_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / disabled — silently skip */
  }
}

/** Toggle a thread id in the pinned set. Returns the resulting
 *  array (already truncated to MAX_PINNED + dedup'd by `savePinnedIds`'s
 *  contract). Idempotent on null/non-positive input — returns the
 *  current set unchanged. */
export function togglePinnedId(
  current: readonly number[],
  threadId: number | null | undefined,
): number[] {
  if (threadId === null || threadId === undefined) return current.slice();
  if (!Number.isFinite(threadId) || !Number.isInteger(threadId)) {
    return current.slice();
  }
  if (threadId <= 0) return current.slice();
  const has = current.includes(threadId);
  if (has) return current.filter((id) => id !== threadId);
  // New pins go to the FRONT of the list — so a freshly-pinned
  // thread visually leads the pinned section, not the bottom of it.
  return [threadId, ...current].slice(0, MAX_PINNED);
}

/** Quick predicate. */
export function isThreadPinned(
  pinnedIds: readonly number[],
  threadId: number | null | undefined,
): boolean {
  if (threadId === null || threadId === undefined) return false;
  if (!Number.isFinite(threadId)) return false;
  return pinnedIds.includes(threadId as number);
}

/** Sort a thread list so pinned threads come first, in their pinned
 *  order; everything else preserves input order (caller's recency
 *  sort). The input is treated as readonly — returns a new array. */
export function sortThreadsWithPinned<T extends { id: number | null }>(
  threads: readonly T[],
  pinnedIds: readonly number[],
): T[] {
  if (!Array.isArray(threads)) return [];
  if (pinnedIds.length === 0) return threads.slice();
  const pinnedSet = new Set(pinnedIds);
  const pinnedRows: T[] = [];
  const otherRows: T[] = [];
  // First split by membership.
  for (const t of threads) {
    if (t && typeof t.id === "number" && pinnedSet.has(t.id)) {
      pinnedRows.push(t);
    } else {
      otherRows.push(t);
    }
  }
  // Then re-order pinnedRows by their position in pinnedIds so the
  // user's pin order is honoured.
  pinnedRows.sort((a, b) => {
    const ai = pinnedIds.indexOf(a.id as number);
    const bi = pinnedIds.indexOf(b.id as number);
    return ai - bi;
  });
  return [...pinnedRows, ...otherRows];
}
