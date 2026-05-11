/**
 * s34 wave 8 (E6, 2026-04-28): pure helpers for the
 * "Continue this conversation" home-page teaser.
 *
 * The dashboard home page has space for a single contextual tile
 * that points the returning user back at their most-recently-active
 * chat thread. Boss ask (chat UI/UX roadmap §E6): "latest active
 * thread teaser" — one tile, short title, cue to continue.
 *
 * What goes into "most recent": the highest `updated_at` among
 * threads with `message_count > 0`. We deliberately filter out
 * empty threads (the legacy bucket sometimes shows up with 0
 * messages on a fresh account, and surfacing it as a teaser would
 * point at nothing).
 *
 * Recency rule: only show the teaser if the thread was active
 * within RECENT_THREAD_WINDOW_DAYS. Older than that and the user
 * has clearly moved on; no point pulling them back to a stale
 * conversation. Kept generous (30 days) so weekly studiers still
 * see continuity.
 *
 * Stays pure (no React, no DOM, no fetch) so it's vitest-pinnable
 * and reusable. The DashboardHome integration owns the network
 * fetch and the JSX.
 */

import type { ChatThread } from "./MessagesContext";

/** Recency window in days. Beyond this, hide the teaser. */
export const RECENT_THREAD_WINDOW_DAYS = 30 as const;

/** Approximate maximum chars before the teaser title gets ellipsized. */
export const RECENT_THREAD_TITLE_MAX_CHARS = 60 as const;

/** Localized fallback used when a thread has no title. Returned by
 *  resolveTeaserTitle only when both the thread title and the
 *  legacy bucket label are empty (defensive). */
export const TEASER_FALLBACK_TITLE = "" as const;

/** Shape returned by selectMostRecentThread. */
export interface RecentThreadTeaser {
  thread: ChatThread;
  /** Number of messages in the thread, mirrored for convenience. */
  messageCount: number;
  /** ISO-8601 string of `updated_at`, mirrored. Null only when the
   *  upstream record was missing it (defensive — should not happen
   *  for non-legacy rows the BE returns). */
  updatedAt: string | null;
}

/** Defensive parse of a possibly-null/invalid ISO date string.
 *  Returns null when the date can't be interpreted. */
export function parseUpdatedAt(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Is the given updated_at within RECENT_THREAD_WINDOW_DAYS of `now`?
 *  Returns false on null/invalid input so callers can chain freely. */
export function isThreadRecentlyActive(
  updatedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const d = parseUpdatedAt(updatedAt);
  if (!d) return false;
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < 0) return true; // future timestamps treated as fresh
  const windowMs = RECENT_THREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return ageMs <= windowMs;
}

/** Pick the most recent thread eligible for the home-page teaser.
 *
 *  Eligibility:
 *    - message_count > 0 (no empty buckets)
 *    - has a parseable updated_at within the recency window
 *    - not the legacy bucket (it has no stable title and the user
 *      probably already migrated to threaded chat by the time E6
 *      becomes useful — if they haven't, the rail is the right
 *      surface, not the home page)
 *
 *  Ties broken by id descending (newer ids = newer threads on the BE),
 *  so a freshly-created empty thread can't outrank a recent one
 *  through equal updated_at. Returns null when no row qualifies.
 */
export function selectMostRecentThread(
  threads: readonly ChatThread[] | null | undefined,
  now: Date = new Date(),
): RecentThreadTeaser | null {
  if (!Array.isArray(threads) || threads.length === 0) return null;
  let best: { thread: ChatThread; ts: number } | null = null;
  for (const t of threads) {
    if (!t) continue;
    if (t.isLegacy) continue;
    if ((t.message_count ?? 0) <= 0) continue;
    const d = parseUpdatedAt(t.updated_at);
    if (!d) continue;
    if (!isThreadRecentlyActive(t.updated_at, now)) continue;
    const ts = d.getTime();
    if (!best || ts > best.ts) {
      best = { thread: t, ts };
      continue;
    }
    if (ts === best.ts) {
      const aId = typeof t.id === "number" ? t.id : -1;
      const bId = typeof best.thread.id === "number" ? best.thread.id : -1;
      if (aId > bId) best = { thread: t, ts };
    }
  }
  if (!best) return null;
  return {
    thread: best.thread,
    messageCount: best.thread.message_count ?? 0,
    updatedAt: best.thread.updated_at,
  };
}

/** Resolve the display title for the teaser. Falls back through the
 *  legacy bucket label and finally to a caller-supplied default,
 *  truncating to RECENT_THREAD_TITLE_MAX_CHARS so the home-page
 *  card never overflows. */
export function resolveTeaserTitle(
  thread: Pick<ChatThread, "title" | "isLegacy">,
  fallback: string = TEASER_FALLBACK_TITLE,
): string {
  const raw = (thread.title || "").trim();
  if (raw.length === 0) return fallback;
  if (raw.length > RECENT_THREAD_TITLE_MAX_CHARS) {
    return raw.slice(0, RECENT_THREAD_TITLE_MAX_CHARS - 1) + "…";
  }
  return raw;
}

/** Format a "last active" hint for the teaser.
 *
 *  Buckets:
 *    - within the last hour              → "только что" / "жаңа ғана"
 *    - same day                          → "сегодня" / "бүгін"
 *    - 1 day ago                         → "вчера" / "кеше"
 *    - 2-7 days ago                      → "N дн. назад" / "N күн бұрын"
 *    - older (still inside window)       → ISO date "YYYY-MM-DD"
 *
 *  Returns the empty string when the timestamp can't be parsed —
 *  callers can short-circuit cleanly without conditional rendering. */
export function formatLastActiveLabel(
  updatedAt: string | null | undefined,
  lang: "ru" | "kz",
  now: Date = new Date(),
): string {
  const d = parseUpdatedAt(updatedAt);
  if (!d) return "";
  const ageMs = now.getTime() - d.getTime();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (ageMs < hourMs) {
    return lang === "kz" ? "жаңа ғана" : "только что";
  }
  // Same calendar day comparison via UTC ISO date prefix.
  const sameDay =
    d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) {
    return lang === "kz" ? "бүгін" : "сегодня";
  }
  const days = Math.floor(ageMs / dayMs);
  if (days === 1) {
    return lang === "kz" ? "кеше" : "вчера";
  }
  if (days >= 2 && days <= 7) {
    return lang === "kz" ? `${days} күн бұрын` : `${days} дн. назад`;
  }
  return d.toISOString().slice(0, 10);
}

/** Build the deep-link URL for the teaser. The chat page reads the
 *  `thread` query param on mount and seeds activeThreadId from it
 *  (wired up in s34 wave 8 alongside the teaser tile). */
export function buildTeaserHref(thread: Pick<ChatThread, "id">): string {
  if (typeof thread.id !== "number") return "/dashboard/chat";
  return `/dashboard/chat?thread=${thread.id}`;
}
