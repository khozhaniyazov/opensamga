/**
 * v3.15 (chat-UI I2 dashboard, 2026-04-30) — pure helpers for the
 * admin trust-signal page.
 *
 * The backend at `/api/admin/chat/trust-signal-rollup?days=N`
 * returns the wire shape produced by
 * `backend/app/services/trust_signal_rollup.py:build_rollup_payload`.
 * Helpers below format that payload for the dashboard without
 * touching the network — they live separately from the React page
 * so vitest can pin the math + formatting without jsdom.
 */

export type TrustSignalBucket = "agent" | "legacy" | "unknown" | string;

export interface TrustSignalRow {
  bucket: TrustSignalBucket;
  turns: number;
  redactions_total: number;
  turns_with_redaction: number;
  redaction_pct: number;
  turns_with_failed_tool: number;
  failed_tool_pct: number;
  turns_general_knowledge: number;
  general_knowledge_pct: number;
  turns_with_sources: number;
  sourced_pct: number;
  avg_redactions: number | null;
}

export interface TrustSignalTotals {
  turns: number;
  redactions_total: number;
  redaction_pct: number;
  failed_tool_pct: number;
  general_knowledge_pct: number;
  sourced_pct: number;
}

export interface TrustSignalRollup {
  window_days: number;
  rows: TrustSignalRow[];
  totals: TrustSignalTotals;
}

/** Window selector — mirrors RagStatsPage's `WINDOWS` shape so the
 * two admin pages feel like siblings. */
export const TRUST_SIGNAL_WINDOWS: ReadonlyArray<{
  label: string;
  days: number;
}> = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export const DEFAULT_TRUST_SIGNAL_DAYS = 7;

/**
 * Format a percentage with one decimal place. The BE already returns
 * one-decimal floats from `safe_pct`, but parsing through JSON loses
 * the formatting (`5.0` becomes `5`), so we re-stringify on the FE.
 */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

/**
 * Format average redactions per turn. AVG can return `null` when
 * the bucket has zero rows (the BE preserves that with
 * `coalesce_float`); render as em-dash so the "no data" case is
 * visually distinct from "literal zero".
 */
export function formatAvg(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(2);
}

/**
 * Format an integer count with locale-aware thousands separators.
 * The dashboard hits big numbers (10k+ turns over a 90-day window)
 * so unformatted ints are hard to scan.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return Math.trunc(value).toLocaleString("ru-RU");
}

/**
 * Validate the BE payload shape minimally — enough to refuse a
 * payload that's been mangled by a proxy (e.g. HTML 502 page) or
 * that's been re-shaped without bumping the FE in lockstep.
 *
 * Returns the payload unchanged on success, throws on failure.
 * Centralised so both the page hook and any future tests can call
 * the same validator.
 */
export function validateRollupPayload(value: unknown): TrustSignalRollup {
  if (!value || typeof value !== "object") {
    throw new Error("trust_signal_rollup: payload is not an object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.window_days !== "number") {
    throw new Error("trust_signal_rollup: window_days is not a number");
  }
  if (!Array.isArray(obj.rows)) {
    throw new Error("trust_signal_rollup: rows is not an array");
  }
  if (!obj.totals || typeof obj.totals !== "object") {
    throw new Error("trust_signal_rollup: totals is not an object");
  }
  return {
    window_days: obj.window_days,
    rows: obj.rows as TrustSignalRow[],
    totals: obj.totals as TrustSignalTotals,
  };
}

/**
 * Stable bucket sort: rows with the most turns first, ties broken
 * alphabetically by bucket name. The BE already sorts by turns desc
 * (see `build_rollup_payload`), but if a row count tie occurs the
 * BE order can vary across runs; we re-sort on the FE so the table
 * reads identically every refresh.
 */
export function sortRowsForDisplay(rows: TrustSignalRow[]): TrustSignalRow[] {
  return [...rows].sort((a, b) => {
    if (b.turns !== a.turns) return b.turns - a.turns;
    return a.bucket.localeCompare(b.bucket);
  });
}

/**
 * Tone helper for the redaction-rate cell. >= 5% redactions is the
 * "look at this" threshold (matches the existing alerting heuristic
 * in trust_signal_rollup tests); under that we leave it neutral.
 */
export function redactionTone(pct: number | null | undefined): "warn" | "ok" {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "ok";
  return pct >= 5 ? "warn" : "ok";
}
