/**
 * s34 wave 10 (E5, 2026-04-28) — client-side thread auto-archive.
 *
 * Boss ask (chat UI/UX roadmap §E5): "auto-archive threads idle >90d
 * (column + sweeper job)". The BE column + sweeper are gated on
 * alembic 4-heads consolidation (still pending). Until that lands
 * we ship the user-visible affordance entirely client-side so the
 * rail isn't dominated by months-old conversations the user
 * already moved on from.
 *
 * Two ways a thread becomes archived in the rail:
 *
 *   1. AUTO: any non-legacy thread whose `updated_at` is older than
 *      ARCHIVE_AGE_DAYS (90) is treated as archived for rail
 *      filtering purposes. No persistent state — purely a derived
 *      flag from the upstream timestamp.
 *
 *   2. MANUAL: the user can explicitly archive a thread via the
 *      kebab menu (wired in s34 wave 10 alongside this module).
 *      That id is persisted in localStorage under
 *      `samga.chat.archivedThreads`, identical schema to the pin
 *      storage payload.
 *
 * The rail also gets a "Show archived" toggle (also persisted, key
 * `samga.chat.showArchived`). Toggling on reveals all archived
 * rows under a separator below the active list. Toggling off (the
 * default) hides them completely.
 *
 * Same caveat as pinning: per-browser, not per-user. Once the BE
 * column ships we can swap this out for a server-truth source —
 * the helper API stays stable so the migration is a one-file
 * change in the React layer.
 *
 * Pure helpers in this module so vitest pins the contract; the
 * React side reads them in `useThreadArchive`.
 */

export const ARCHIVED_KEY = "samga.chat.archivedThreads";
export const SHOW_ARCHIVED_KEY = "samga.chat.showArchived";

/** Age in days at which a non-legacy thread is auto-archived. Boss
 *  asked for 90 in the roadmap — kept here so the constant is
 *  searchable and so the BE sweeper job can adopt the same value
 *  when it lands. */
export const ARCHIVE_AGE_DAYS = 90 as const;

interface ArchivePayload {
  v: 1;
  ids: number[];
}

interface ShowArchivedPayload {
  v: 1;
  show: boolean;
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
    const probe = "__samga.archive.probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/* ── Manual-archive id set ──────────────────────────────────────── */

/** Read the archived ids set. Returns [] on any failure so callers
 *  can chain freely. */
export function loadArchivedIds(
  storage: StorageLike | null = getStorage(),
): number[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<ArchivePayload>;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ids)) {
      storage.removeItem(ARCHIVED_KEY);
      return [];
    }
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
      storage.removeItem(ARCHIVED_KEY);
    } catch {
      /* noop */
    }
    return [];
  }
}

/** Persist the archived ids set. Idempotent dedup. */
export function saveArchivedIds(
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
    }
    const payload: ArchivePayload = { v: 1, ids: cleaned };
    storage.setItem(ARCHIVED_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / disabled — silently skip */
  }
}

/** Toggle a thread id in the archived set. Returns the resulting
 *  array. Idempotent on null/non-positive input. */
export function toggleArchivedId(
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
  return [...current, threadId];
}

/** Quick predicate for manual-archive membership. */
export function isThreadManuallyArchived(
  archivedIds: readonly number[],
  threadId: number | null | undefined,
): boolean {
  if (threadId === null || threadId === undefined) return false;
  if (!Number.isFinite(threadId)) return false;
  return archivedIds.includes(threadId as number);
}

/* ── Show-archived toggle ────────────────────────────────────────── */

/** Read the "show archived rows" boolean. Defaults to false so a
 *  fresh user / private-mode browser sees the active-only rail. */
export function loadShowArchived(
  storage: StorageLike | null = getStorage(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(SHOW_ARCHIVED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<ShowArchivedPayload>;
    if (!parsed || parsed.v !== 1 || typeof parsed.show !== "boolean") {
      storage.removeItem(SHOW_ARCHIVED_KEY);
      return false;
    }
    return parsed.show;
  } catch {
    try {
      storage.removeItem(SHOW_ARCHIVED_KEY);
    } catch {
      /* noop */
    }
    return false;
  }
}

/** Persist the "show archived rows" boolean. */
export function saveShowArchived(
  show: boolean,
  storage: StorageLike | null = getStorage(),
): void {
  if (!storage) return;
  try {
    const payload: ShowArchivedPayload = { v: 1, show: Boolean(show) };
    storage.setItem(SHOW_ARCHIVED_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / disabled — silently skip */
  }
}

/* ── Auto-archive predicate (derived from updated_at) ───────────── */

/** True when a thread's `updated_at` is older than ARCHIVE_AGE_DAYS.
 *  Returns false on null/invalid input so callers can chain. */
export function isAutoArchivedByAge(
  updatedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!updatedAt || typeof updatedAt !== "string") return false;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return false;
  const ageMs = now.getTime() - d.getTime();
  if (ageMs <= 0) return false;
  const cutoffMs = ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > cutoffMs;
}

/** Top-level predicate that combines manual + auto-archive. */
export function isThreadArchived(args: {
  threadId: number | null | undefined;
  updatedAt: string | null | undefined;
  archivedIds: readonly number[];
  now?: Date;
}): boolean {
  if (isThreadManuallyArchived(args.archivedIds, args.threadId)) return true;
  // Legacy bucket (id === null) is never auto-archived — it's the
  // catch-all and would always be old by definition.
  if (args.threadId === null || args.threadId === undefined) return false;
  return isAutoArchivedByAge(args.updatedAt, args.now);
}

/** Split a thread list into [active, archived] preserving input
 *  order within each partition. */
export function partitionThreadsByArchived<
  T extends { id: number | null; updated_at?: string | null },
>(
  threads: readonly T[] | null | undefined,
  archivedIds: readonly number[],
  now: Date = new Date(),
): { active: T[]; archived: T[] } {
  if (!Array.isArray(threads)) return { active: [], archived: [] };
  const active: T[] = [];
  const archived: T[] = [];
  for (const t of threads) {
    if (!t) continue;
    const isArch = isThreadArchived({
      threadId: t.id,
      updatedAt: t.updated_at ?? null,
      archivedIds,
      now,
    });
    if (isArch) archived.push(t);
    else active.push(t);
  }
  return { active, archived };
}
