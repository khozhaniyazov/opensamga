/**
 * v3.25 — Profile pair simulator (Issue #15 AC#4) FE model.
 *
 * Pure helpers + types for the data-driven Strategy Lab subject-pair section.
 * The five pairs surfaced first-wave match the issue acceptance criteria
 * verbatim. Backend canonical names are used for the API call; RU/KZ display
 * comes from the backend's curated career copy.
 */

export interface ProfilePair {
  /** Stable id used as React key + selection state. */
  id: string;
  /** Canonical English subject names. Sent to the BE as ?subject1+subject2. */
  subjects: [string, string];
}

/**
 * The five pairs called out by Issue #15 AC#4.
 *
 *   Math+Informatics, Biology+Chemistry, Physics+Math,
 *   Geography+Math, World History+Law
 *
 * The backend canonical names use "Fundamentals of Law" for the law
 * subject (see app/constants/subjects.py). The simulator's career-copy
 * registry covers all 12 PROFILE_SUBJECT_COMBINATIONS, so adding more
 * pairs here later is purely a UI choice.
 */
export const PROFILE_PAIR_FIRST_WAVE: ProfilePair[] = [
  { id: "math-it", subjects: ["Mathematics", "Informatics"] },
  { id: "bio-chem", subjects: ["Biology", "Chemistry"] },
  { id: "phys-math", subjects: ["Mathematics", "Physics"] },
  { id: "geo-math", subjects: ["Geography", "Mathematics"] },
  { id: "history-law", subjects: ["World History", "Fundamentals of Law"] },
];

export interface ProfilePairCareerCopy {
  title: string;
  majors: string;
  pressure: string;
  next: string;
}

export interface ProfilePairMajorEntry {
  code: string | null;
  name: string | null;
  university_count: number;
  median_grant_threshold: number | null;
  max_grant_threshold: number | null;
  total_grants_awarded: number;
  deep_link: string | null;
}

export interface ProfilePairSummary {
  major_count: number;
  median_grant_threshold: number | null;
  max_grant_threshold: number | null;
  total_grants_awarded: number;
}

export interface ProfilePairRisks {
  flags: string[];
  severity: "low" | "medium" | "high";
}

export interface ProfilePairSimulatorResponse {
  pair: string[];
  career_copy: { ru: ProfilePairCareerCopy; kz: ProfilePairCareerCopy } | null;
  majors: ProfilePairMajorEntry[];
  summary: ProfilePairSummary;
  risks: ProfilePairRisks;
}

/**
 * Build the BE query string. Always sorts subjects alphabetically so the BE
 * cache (if any) sees the same key regardless of FE ordering.
 */
export function profilePairQueryString(pair: ProfilePair): string {
  const sorted = [...pair.subjects].sort();
  const sp = new URLSearchParams({
    subject1: sorted[0] ?? "",
    subject2: sorted[1] ?? "",
  });
  return sp.toString();
}

/**
 * Translate a risk flag to a localized label.
 *
 * Unknown flags fall back to the raw string so a future BE flag at least
 * shows something while the FE catches up.
 */
export function profilePairRiskLabel(flag: string, lang: "ru" | "kz"): string {
  const map: Record<string, { ru: string; kz: string }> = {
    narrow_major_range: {
      ru: "Узкий выбор направлений",
      kz: "Бағыттар тізімі тар",
    },
    high_competition: {
      ru: "Высокий проходной балл",
      kz: "Өту балы жоғары",
    },
    low_grant_count: {
      ru: "Мало грантов",
      kz: "Грант саны аз",
    },
  };
  return map[flag]?.[lang] ?? flag;
}

export function profilePairSeverityClasses(
  severity: ProfilePairRisks["severity"],
): string {
  switch (severity) {
    case "high":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    case "medium":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "low":
    default:
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }
}

export function profilePairSeverityLabel(
  severity: ProfilePairRisks["severity"],
  lang: "ru" | "kz",
): string {
  if (severity === "high")
    return lang === "kz" ? "Жоғары тәуекел" : "Высокий риск";
  if (severity === "medium")
    return lang === "kz" ? "Орташа тәуекел" : "Средний риск";
  return lang === "kz" ? "Төмен тәуекел" : "Низкий риск";
}

/**
 * v3.61 (2026-05-02) — resolve a user's stored profile subject pair to
 * the matching `PROFILE_PAIR_FIRST_WAVE` id, so Strategy Lab can default
 * its pair-simulator selection to the user's actual subjects instead of
 * always falling back to the first pair (Math+IT).
 *
 * Backstory: B7 in the 2026-05-02 E2E report. A profile with
 * Math+Physics was rendered as Math+Informatics in the
 * "ВЫБРАННАЯ ПАРА" preview because the FE used `SUBJECT_PAIRS[0].id`
 * unconditionally as the initial state.
 *
 * Pure function. Returns `null` when the profile pair isn't part of
 * the first wave (e.g. KazLang+KazLit, Foreign+World) — caller should
 * fall back to a sensible default in that case. The existing five
 * first-wave pairs cover the dominant STEM and humanities tracks.
 *
 * Implementation note: we sort + lowercase both sides so we don't depend
 * on the order chosen_subjects happens to come back in. We deliberately
 * do NOT pull the heavier `normalizeSubjectName` from
 * `lib/subjectLabels` here, to keep this model file dependency-free
 * (it ships as part of the StrategyLab chunk and we don't want to
 * couple Strategy Lab loads to subject-aliasing churn). The five
 * canonical pair-ids hardcode the canonical English names already.
 */
export function resolveProfilePairId(
  chosenSubjects: readonly string[] | null | undefined,
): string | null {
  if (!chosenSubjects || chosenSubjects.length !== 2) return null;
  const target = [...chosenSubjects]
    .map((s) => (s ?? "").trim().toLowerCase())
    .sort()
    .join("::");
  if (!target || target === "::") return null;
  for (const pair of PROFILE_PAIR_FIRST_WAVE) {
    const candidate = [...pair.subjects]
      .map((s) => s.trim().toLowerCase())
      .sort()
      .join("::");
    if (candidate === target) return pair.id;
  }
  return null;
}
