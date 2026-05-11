/**
 * v3.35 (2026-05-01) — pure helpers for the admin retake-guide
 * fetch-stats page.
 *
 * The backend at `/api/admin/retake-guide/fetch-stats` (added in
 * v3.34) returns the dict shape produced by
 * `backend/app/services/retake_guide.get_fetch_stats()`. Helpers
 * below validate that payload, humanize epoch timestamps into
 * relative ages, and classify the worker's health into a tone the
 * page can render. They live separately from the React component
 * so vitest can pin the contract without jsdom.
 */

export interface RetakeGuideFetchStats {
  success_count: number;
  failure_count: number;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_reason: string | null;
}

export interface RetakeGuideFetchStatsPayload {
  schedule_url: string;
  stats: RetakeGuideFetchStats;
}

/** Health classification rules — keep in lockstep with the page
 * legend so the user can see which bucket their state landed in. */
export type FetchStatsTone = "ok" | "warn" | "dead" | "idle";

/**
 * Humanize an epoch-seconds timestamp into "X minutes ago" / "Y
 * hours ago" relative to ``now`` (also epoch seconds).
 *
 * - Returns "—" for null/undefined/non-finite (display placeholder).
 * - Returns "just now" for ages under 30 seconds.
 * - Negative ages (clock skew) are coerced to "just now" rather
 *   than "in the future" — the dashboard shouldn't lie if the
 *   worker's clock drifted.
 *
 * Output is plain ASCII so RU and KZ pages can wrap it in their
 * own ``"назад" / "бұрын"`` suffix without duplicating the math.
 */
export function humanizeEpochSeconds(
  ts: number | null | undefined,
  nowSec: number,
): string {
  if (ts === null || ts === undefined) return "—";
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "—";
  const ageSec = Math.max(0, nowSec - ts);
  if (ageSec < 30) return "just now";
  if (ageSec < 60) return `${Math.round(ageSec)}s`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h`;
  const ageDay = Math.floor(ageHr / 24);
  return `${ageDay}d`;
}

/**
 * Classify the fetcher's overall health into a tone:
 *
 * - "idle"  : never run (success == 0 && failure == 0). Greenfield
 *             worker, no signal yet — neither good nor bad.
 * - "ok"    : last_success_at within the last 24h.
 * - "warn"  : last success older than 24h OR more failures than
 *             successes in the lifetime of the worker.
 * - "dead"  : never succeeded but has failures (success == 0 &&
 *             failure > 0). The current prod state.
 *
 * The cut-off is 24h because the cache TTL is 6h — by 24h every
 * worker should have at least four cache-miss attempts. If none
 * succeeded, something is wrong.
 */
export function classifyFetchStats(
  stats: RetakeGuideFetchStats,
  nowSec: number,
): FetchStatsTone {
  const success = stats.success_count ?? 0;
  const failure = stats.failure_count ?? 0;
  if (success === 0 && failure === 0) return "idle";
  if (success === 0 && failure > 0) return "dead";
  const lastSuccess = stats.last_success_at;
  if (lastSuccess !== null && lastSuccess !== undefined) {
    const ageSec = Math.max(0, nowSec - lastSuccess);
    const ONE_DAY_SEC = 24 * 3600;
    if (ageSec <= ONE_DAY_SEC) return "ok";
  }
  return "warn";
}

/**
 * Validate a raw fetch from the BE. Returns the typed payload or
 * throws — the page's catch block will surface ``e.message``. We're
 * defensive because v3.34 returns a copy of the dict and a future
 * BE change could drift the shape silently.
 */
export function validateFetchStatsPayload(
  raw: unknown,
): RetakeGuideFetchStatsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("payload not an object");
  }
  const obj = raw as Record<string, unknown>;
  const url = obj.schedule_url;
  const stats = obj.stats;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("schedule_url missing or empty");
  }
  if (!stats || typeof stats !== "object") {
    throw new Error("stats missing or not an object");
  }
  const s = stats as Record<string, unknown>;
  const requiredKeys = [
    "success_count",
    "failure_count",
    "last_success_at",
    "last_failure_at",
    "last_failure_reason",
  ];
  for (const k of requiredKeys) {
    if (!(k in s)) {
      throw new Error(`stats.${k} missing`);
    }
  }
  // Numeric coercions — accept null for the *_at and reason fields.
  const success_count = toFiniteNumber(s.success_count, 0);
  const failure_count = toFiniteNumber(s.failure_count, 0);
  const last_success_at = nullableEpoch(s.last_success_at);
  const last_failure_at = nullableEpoch(s.last_failure_at);
  const last_failure_reason =
    s.last_failure_reason === null || s.last_failure_reason === undefined
      ? null
      : String(s.last_failure_reason);
  return {
    schedule_url: url,
    stats: {
      success_count,
      failure_count,
      last_success_at,
      last_failure_at,
      last_failure_reason,
    },
  };
}

function toFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function nullableEpoch(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
