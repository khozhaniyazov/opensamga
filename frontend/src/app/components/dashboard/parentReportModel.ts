/**
 * parentReportModel.ts
 * --------------------
 *
 * v3.27 — pure helpers + types for the Parent Report panel
 * (Issue #15 AC#5).  Mirrors the BE service module
 * `app.services.parent_report` so the FE can format dates / labels
 * without an extra round-trip.
 *
 * No JSX, no React, no fetch — render layer lives in
 * `ParentReportPage.tsx` (student-side mint UI) and
 * `ParentReportSharedPage.tsx` (parent-side public view).
 */

export interface ParentReportTokenSummary {
  id: number;
  token: string;
  expires_at: string;
  is_revoked: boolean;
  created_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
}

export interface ParentReportPayloadStudent {
  first_name: string;
  grade: number | null;
  competition_quota: string | null;
  is_premium: boolean;
}

export interface ParentReportExamRow {
  subjects: string[];
  score: number;
  max_score: number;
  submitted_at: string | null;
}

export interface ParentReportTargetUni {
  id: number;
  name: string;
  city: string | null;
}

export interface ParentReportPayload {
  language: "ru" | "kz";
  strings: Record<string, string>;
  student: ParentReportPayloadStudent;
  current_score: number | null;
  exam_attempts: ParentReportExamRow[];
  chosen_subjects: string[];
  target_universities: ParentReportTargetUni[];
  target_majors: string[];
  generated_at: string;
}

/** Default share-link TTL in days. Mirror of
 *  ``parent_report.PARENT_REPORT_DEFAULT_TTL_DAYS``. Boss-decision
 *  2026-05-01: 30 days (long enough for parents to read at leisure,
 *  short enough to bound PII exposure). */
export const PARENT_REPORT_DEFAULT_TTL_DAYS = 30;
export const PARENT_REPORT_MAX_TTL_DAYS = 90;

/** Build the parent-facing share URL for a given token, anchored
 *  at the FE origin. Used both in copy-to-clipboard and the displayed
 *  text so they can never drift. */
export function parentReportShareUrl(token: string): string {
  if (typeof window === "undefined") {
    return `/parent-report/${encodeURIComponent(token)}`;
  }
  return `${window.location.origin}/parent-report/${encodeURIComponent(token)}`;
}

/** True if `iso` parses to a future timestamp (i.e., still in window). */
export function isTokenStillActive(row: ParentReportTokenSummary): boolean {
  if (row.is_revoked) {
    return false;
  }
  const ms = Date.parse(row.expires_at);
  if (Number.isNaN(ms)) {
    return false;
  }
  return ms > Date.now();
}

/** Locale-respecting day-only date string ("01.05.2026"). */
export function formatTokenDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleDateString();
}

/** Clamp a TTL the user typed in. Mirror of `clamp_ttl_days`. */
export function clampTtlDays(input: number | null | undefined): number {
  if (input == null || !Number.isFinite(input) || input <= 0) {
    return PARENT_REPORT_DEFAULT_TTL_DAYS;
  }
  return Math.min(Math.floor(input), PARENT_REPORT_MAX_TTL_DAYS);
}
