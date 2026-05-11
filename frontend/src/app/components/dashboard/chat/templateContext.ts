export interface TemplateContext {
  unresolved_mistakes_count: number;
  exam_attempts_count: number;
  weakness_topic_tag: string | null;
  has_library_activity: boolean;
  profile_subjects: string[];
  weakest_subject: string | null;
  last_test_results_count: number;
  target_university_name: string | null;
  has_onboarding_profile: boolean;
}

export const DEFAULT_TEMPLATE_CONTEXT: TemplateContext = {
  unresolved_mistakes_count: 0,
  exam_attempts_count: 0,
  weakness_topic_tag: null,
  has_library_activity: false,
  profile_subjects: [],
  weakest_subject: null,
  last_test_results_count: 0,
  target_university_name: null,
  has_onboarding_profile: false,
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function countTestResults(value: unknown): number {
  const record = asRecord(value);
  return Object.values(record).reduce<number>((count, scores) => {
    if (!Array.isArray(scores)) return count;
    return (
      count +
      scores.filter(
        (score) => typeof score === "number" && Number.isFinite(score),
      ).length
    );
  }, 0);
}

export function coerceTemplateContext(input: unknown): TemplateContext {
  const raw = asRecord(input);
  const profile = asRecord(raw.profile);
  const targetUniversity = asRecord(raw.target_university);
  const profileTargetUniversity = asRecord(profile.target_university);

  const profileSubjects =
    asStringArray(raw.profile_subjects).length > 0
      ? asStringArray(raw.profile_subjects)
      : asStringArray(profile.profile_subjects).length > 0
        ? asStringArray(profile.profile_subjects)
        : asStringArray(profile.chosen_subjects);

  const weakestSubject =
    asStringOrNull(raw.weakest_subject) ??
    asStringOrNull(profile.weakest_subject);
  const targetUniversityName =
    asStringOrNull(raw.target_university_name) ??
    asStringOrNull(profile.target_university_name) ??
    asStringOrNull(raw.dream_university) ??
    asStringOrNull(profile.dream_university) ??
    asStringOrNull(targetUniversity.name) ??
    asStringOrNull(profileTargetUniversity.name);
  const resultCount =
    asNumber(raw.last_test_results_count, -1) >= 0
      ? asNumber(raw.last_test_results_count)
      : asNumber(profile.last_test_results_count, -1) >= 0
        ? asNumber(profile.last_test_results_count)
        : countTestResults(raw.last_test_results) ||
          countTestResults(profile.last_test_results);

  const hasProfile =
    asBoolean(raw.has_onboarding_profile) ||
    asBoolean(profile.has_onboarding_profile) ||
    profileSubjects.length > 0 ||
    Boolean(weakestSubject) ||
    Boolean(targetUniversityName) ||
    resultCount > 0;

  return {
    unresolved_mistakes_count: asNumber(raw.unresolved_mistakes_count),
    exam_attempts_count: asNumber(raw.exam_attempts_count),
    weakness_topic_tag: asStringOrNull(raw.weakness_topic_tag),
    has_library_activity: asBoolean(raw.has_library_activity),
    profile_subjects: profileSubjects,
    weakest_subject: weakestSubject,
    last_test_results_count: resultCount,
    target_university_name: targetUniversityName,
    has_onboarding_profile: hasProfile,
  };
}
