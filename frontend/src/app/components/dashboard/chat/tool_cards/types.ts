/**
 * Phase B (s21, 2026-04-22): shapes of structured tool-result payloads
 * that the chat surface knows how to render inline.
 *
 * DESIGN_CHAT_FLAGSHIP.md §6 calls out four cards we need:
 *   GrantChanceGauge              — shows %-chance for a single (uni, major)
 *   UniComparisonTable            — side-by-side for up to 3 universities
 *   HistoricalThresholdSparkline  — multi-year threshold trend
 *   RecommendationList            — top-N universities the score clears
 *
 * None of the cards care where the data came from. The orchestration layer
 * (backend chat.py → Phase C) fills `MessagePart[]` with `tool_call` parts
 * carrying a `tool` name and a `result` payload shaped like one of the
 * discriminated-union members below. The renderer dispatches purely on
 * the `tool` string.
 *
 * Keep this file *data-only*. Runtime behaviour (no-op for unknown tools,
 * graceful empty-state rendering) lives in the individual card files.
 */

/** Shared envelope used by the dispatcher. Every concrete card owns the
 *  shape of `data` via the union below. */
export type ToolResult =
  | { tool: "grant_chance"; data: GrantChanceData }
  | { tool: "compare_universities"; data: UniComparisonData }
  | { tool: "historical_thresholds"; data: HistoricalThresholdData }
  | { tool: "recommend_universities"; data: RecommendationListData }
  // s24 memory-tool cards
  | { tool: "user_profile"; data: UserProfileData }
  | { tool: "recent_mistakes"; data: RecentMistakesData }
  | { tool: "recent_test_attempts"; data: RecentTestAttemptsData }
  | { tool: "practice_summary"; data: PracticeSummaryData }
  | { tool: "dream_university_progress"; data: DreamUniProgressData }
  | { tool: "chat_summary"; data: ChatSummaryData };

// -----------------------------------------------------------------
// grant_chance
// -----------------------------------------------------------------
export interface GrantChanceData {
  /** Student's UNT/ENT score on the 140-point scale. */
  score: number;
  /** Uni name (pre-resolved, display-ready). */
  university: string;
  /** Major group code (e.g. "B057"). */
  major_code?: string | null;
  /** Major display name. */
  major?: string | null;
  /** Historical threshold — highest score still admitted last cycle. */
  threshold: number;
  /** Server-computed probability in [0, 1]. Optional — when absent the
   *  card derives a crude estimate from (score - threshold) margin. */
  probability?: number | null;
  /** Grant quota tag the student belongs to. */
  quota_type?: "GENERAL" | "RURAL" | "ORPHAN" | null;
  /** Optional source year for the threshold (s26 phase 3 trust signal). */
  year?: number | null;
}

// -----------------------------------------------------------------
// compare_universities
// -----------------------------------------------------------------
export interface UniComparisonRow {
  name: string;
  /** 4-digit int like 2026 */
  founding_year?: number | null;
  total_students?: number | null;
  has_dorm?: boolean | null;
  military_chair?: boolean | null;
  website?: string | null;
  /** Dominant location city. */
  city?: string | null;
}
export interface UniComparisonData {
  unis: UniComparisonRow[];
}

// -----------------------------------------------------------------
// historical_thresholds
// -----------------------------------------------------------------
export interface HistoricalThresholdPoint {
  year: number;
  threshold: number;
}
export interface HistoricalThresholdData {
  university: string;
  major_code?: string | null;
  major?: string | null;
  /** Sorted ascending by year. */
  points: HistoricalThresholdPoint[];
  /** Optional overlay line — the student's own score for quick comparison. */
  user_score?: number | null;
}

// -----------------------------------------------------------------
// recommend_universities
// -----------------------------------------------------------------
export interface RecommendationItem {
  university: string;
  threshold: number;
  major_code?: string | null;
  major?: string | null;
  city?: string | null;
  probability?: number | null;
}
export interface RecommendationListData {
  score: number;
  quota_type?: "GENERAL" | "RURAL" | "ORPHAN";
  /** Top-N, pre-sorted by threshold desc. */
  items: RecommendationItem[];
}

// -----------------------------------------------------------------
// s24 memory-tool cards
// -----------------------------------------------------------------
export interface UserProfileData {
  name?: string | null;
  current_grade?: number | null;
  chosen_subjects?: string[];
  target_majors?: string[];
  target_universities?: string[];
  subscription_tier?: string | null;
}

export interface RecentMistakeItem {
  id?: number;
  subject?: string | null;
  topic_tag?: string | null;
  user_answer?: string | null;
  correct_answer?: string | null;
  diagnosis?: string | null;
  is_resolved?: boolean;
}
export interface RecentMistakesData {
  count: number;
  items: RecentMistakeItem[];
}

export interface RecentTestAttemptItem {
  id?: number;
  subjects?: string[];
  score?: number | null;
  max_score?: number | null;
  percent?: number | null;
  submitted_at?: string | null;
}
export interface RecentTestAttemptsData {
  count: number;
  attempts: RecentTestAttemptItem[];
}

export interface WeakestSubjectRow {
  subject?: string | null;
  accuracy_pct?: number | null;
  sessions?: number | null;
  answered?: number | null;
}
export interface PracticeSummaryData {
  window_days?: number | null;
  session_count?: number;
  weakest: WeakestSubjectRow[];
}

// -----------------------------------------------------------------
// dream_university_progress (s25)
// -----------------------------------------------------------------
export interface DreamUniProgressRow {
  uni_name?: string | null;
  major_code?: string | null;
  year?: number | null;
  threshold?: number | null;
  your_score?: number | null;
  /** Positive = above threshold, negative = below. */
  gap?: number | null;
}
export interface DreamUniProgressData {
  quota_type?: "GENERAL" | "RURAL" | "ORPHAN" | null;
  current_score?: number | null;
  target_majors: string[];
  target_universities: string[];
  rows: DreamUniProgressRow[];
}

// -----------------------------------------------------------------
// chat_summary (s25)
// -----------------------------------------------------------------
export interface ChatSummaryThread {
  thread_id?: number;
  title?: string | null;
  updated_at?: string | null;
  last_user_preview?: string | null;
}
export interface ChatSummaryData {
  count: number;
  threads: ChatSummaryThread[];
}
