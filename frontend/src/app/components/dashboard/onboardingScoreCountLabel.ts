/**
 * onboardingScoreCountLabel.ts — v3.72 (B14, 2026-05-02)
 *
 * Pure helper for the score-summary line on each `ScoreSubjectCard`
 * in `OnboardingPage.tsx`. Pre-v3.72 the label was hard-coded as
 *
 *   `${valid} / ${total} результ. · Максимум ${maxScore}`
 *
 * Two issues:
 *   - **B14** "результ." is a clipped abbreviation. Real RU UNT prep
 *     copy uses full "результат / результата / результатов" with the
 *     standard 0/1/2 plural rule.
 *   - **B19** "Максимум: 20" was repeated verbatim in the small chip
 *     to the right of the count, so the same number appeared twice
 *     in ~80px of vertical real-estate.
 *
 * v3.72 produces a single, well-pluralized phrase per language. The
 * separate "Максимум" hint is dropped from the count line — the
 * dedicated chip already shows it.
 *
 * Mirrors the well-tested 0/1/2 rule from
 * `chat/formatRelativeTime.ts:ruPluralIndex` (and several siblings).
 */

export type OnboardingScoreLang = "ru" | "kz";

/** Pick the RU plural form (0=1, 1=2-4, 2=5+/11-14). */
function ruPluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 2;
  if (mod10 === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4) return 1;
  return 2;
}

/**
 * Render the "{valid} / {total} {plural-result}" line for a single
 * score-summary card. Returned string contains no trailing
 * "Максимум" — the dedicated chip on the right of the same row
 * already shows that, see B19.
 *
 * Defensive: NaN-safe; clamps both args to non-negative integers.
 */
export function onboardingScoreCountLabel(
  valid: number,
  total: number,
  lang: OnboardingScoreLang,
): string {
  const v = clamp(valid);
  const t = clamp(total);
  if (lang === "kz") {
    // KZ has no quantitative gender; one form suffices and is the
    // current copy choice ("нәтиже"). Pre-v3.72 was already this.
    return `${v} / ${t} нәтиже`;
  }
  const idx = ruPluralIndex(t);
  if (idx === 0) return `${v} / ${t} результат`;
  if (idx === 1) return `${v} / ${t} результата`;
  return `${v} / ${t} результатов`;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
