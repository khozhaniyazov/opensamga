// Pure helpers + types for the Weak Topic Mode page (v3.23).
// Mirrors `backend/app/services/weak_topic_mode.py` data shapes.
//
// Kept free of React imports so it can be unit-tested with vitest +
// jsdom without rendering. RU/KZ labels are co-located with the
// component-side helpers but not coupled to any React context.

import type { Lang } from "../LanguageContext";

export type WeakTopicActionKind = "learn" | "tutor" | "practice" | "retest";
export type WeakTopicPriority = "HIGH" | "MEDIUM" | "LOW";
export type WeakTopicPlanIntent = "learn" | "practice" | "review" | "retest";

export interface WeakTopicAction {
  kind: WeakTopicActionKind | string;
  href: string;
  subject?: string | null;
}

export interface WeakTopicEntry {
  topic: string;
  subject: string;
  points_lost: number;
  mistake_count: number;
  pages_to_read: number;
  priority: WeakTopicPriority | string;
  actions: WeakTopicAction[];
}

export interface WeakTopicSubjectGroup {
  subject: string;
  total_points_lost: number;
  topics: WeakTopicEntry[];
}

export interface WeakTopicPlanDay {
  day: number;
  intent: WeakTopicPlanIntent | string;
  topic?: string | null;
  subject?: string | null;
  href: string;
}

export interface WeakTopicModeResponse {
  target_university: string | null;
  grant_threshold: number | null;
  current_score: number | null;
  current_score_source: string | null;
  gap: number | null;
  total_recoverable_points: number;
  expected_subjects: string[];
  subject_groups: WeakTopicSubjectGroup[];
  seven_day_plan: WeakTopicPlanDay[];
}

export function weakTopicActionLabel(
  kind: WeakTopicActionKind | string,
  lang: Lang,
): string {
  const ru: Record<string, string> = {
    learn: "Учебник",
    tutor: "AI-разбор",
    practice: "Тренировка",
    retest: "Ретест",
  };
  const kz: Record<string, string> = {
    learn: "Оқулық",
    tutor: "AI түсіндіру",
    practice: "Жаттығу",
    retest: "Қайта тапсыру",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[kind] ?? kind;
}

export function weakTopicPriorityLabel(
  priority: WeakTopicPriority | string,
  lang: Lang,
): string {
  const normalized = String(priority || "").toUpperCase();
  const ru: Record<string, string> = {
    HIGH: "Высокий приоритет",
    MEDIUM: "Средний приоритет",
    LOW: "Низкий приоритет",
  };
  const kz: Record<string, string> = {
    HIGH: "Жоғары басымдық",
    MEDIUM: "Орташа басымдық",
    LOW: "Төмен басымдық",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[normalized] ?? normalized;
}

export function weakTopicPriorityClasses(
  priority: WeakTopicPriority | string,
): string {
  const normalized = String(priority || "").toUpperCase();
  if (normalized === "HIGH") {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  }
  if (normalized === "MEDIUM") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
  return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
}

export function weakTopicPlanIntentLabel(
  intent: WeakTopicPlanIntent | string,
  lang: Lang,
): string {
  const ru: Record<string, string> = {
    learn: "Изучить",
    practice: "Потренироваться",
    review: "Разбор ошибок",
    retest: "Ретест",
  };
  const kz: Record<string, string> = {
    learn: "Үйрену",
    practice: "Жаттығу",
    review: "Қателерді талдау",
    retest: "Қайта тапсыру",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[intent] ?? intent;
}

// Day labels: short prefix for the per-day card. The backend always
// returns days 1..7 in the same order; the FE doesn't reshuffle.
export function weakTopicPlanDayLabel(day: number, lang: Lang): string {
  const ru = `День ${day}`;
  const kz = `${day}-күн`;
  return lang === "kz" ? kz : ru;
}

// Total points across all weak topics, summed at the response level.
// The backend already provides this, but FE empty-state copy needs it
// before render to decide whether to show the gap-map section.
export function totalWeakPoints(response: WeakTopicModeResponse): number {
  return response.subject_groups.reduce(
    (acc, group) => acc + (group.total_points_lost || 0),
    0,
  );
}

// Boolean helper: does the response carry any actionable weak topics?
// Used by the empty-state branch.
export function hasWeakTopics(response: WeakTopicModeResponse): boolean {
  return response.subject_groups.some((g) => g.topics.length > 0);
}
