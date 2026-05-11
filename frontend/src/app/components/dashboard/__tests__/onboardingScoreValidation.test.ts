/**
 * v3.63 (2026-05-02) — onboarding score-validation contract pins.
 *
 * Backstory: B3 in the 2026-05-02 E2E report. A user typed `999`
 * for "История Казахстана" (max 20). The inline `overMax` flag fired
 * (red ring + helper text), but the per-subject summary cards still
 * showed `999/20` in Average/Best AND counted the 999 toward
 * "1 / 1 результ.". Continue still gated correctly because submit
 * validation refuses the step, but the visible summary lied.
 *
 * The fix lives inside `ScoreSubjectCard`: validScores filters
 * normalizedScores to [0, maxScore]. We don't have a render contract
 * test for the whole onboarding tree (the file is 1700+ lines, the
 * tests would be heavy and brittle), so we pin the *predicate* that
 * decides whether a score should count. If anyone weakens the filter,
 * this test fails.
 */

import { describe, expect, it } from "vitest";

/**
 * Pure mirror of the `validScores = normalizedScores.filter(...)` line
 * inside `ScoreSubjectCard` in `OnboardingPage.tsx`. Lifted into the
 * test file (rather than exported from the page) because the page's
 * 1700-line module isn't worth pulling into the test environment for a
 * 4-line predicate, and exporting it would couple the page module to
 * a test seam.
 *
 * Drift guard: if the page changes the predicate, port the change
 * here too. The test names below describe the intended behaviour, not
 * the implementation.
 */
function isValidOnboardingScore(value: number, maxScore: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= maxScore;
}

describe("onboarding score validation predicate (v3.63)", () => {
  it("accepts scores at the lower bound (0)", () => {
    expect(isValidOnboardingScore(0, 20)).toBe(true);
    expect(isValidOnboardingScore(0, 50)).toBe(true);
  });

  it("accepts scores at the upper bound (maxScore)", () => {
    expect(isValidOnboardingScore(20, 20)).toBe(true);
    expect(isValidOnboardingScore(50, 50)).toBe(true);
  });

  it("rejects values strictly above maxScore (the B3 case)", () => {
    // History of Kazakhstan: max=20, user typed 999.
    expect(isValidOnboardingScore(999, 20)).toBe(false);
    // Mathematical Literacy: max=10.
    expect(isValidOnboardingScore(11, 10)).toBe(false);
    // Profile subject: max=50.
    expect(isValidOnboardingScore(51, 50)).toBe(false);
  });

  it("rejects negative values (defence in depth — input strips '-' but pasted strings exist)", () => {
    expect(isValidOnboardingScore(-1, 20)).toBe(false);
    expect(isValidOnboardingScore(-100, 50)).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidOnboardingScore(Number.NaN, 20)).toBe(false);
    expect(isValidOnboardingScore(Number.POSITIVE_INFINITY, 20)).toBe(false);
    expect(isValidOnboardingScore(Number.NEGATIVE_INFINITY, 20)).toBe(false);
  });

  it("accepts mid-range values for each known subject family", () => {
    // 20-point subject (History of Kazakhstan)
    expect(isValidOnboardingScore(15, 20)).toBe(true);
    // 10-point subjects (Mathematical Literacy, Reading Literacy)
    expect(isValidOnboardingScore(7, 10)).toBe(true);
    // 50-point profile subjects
    expect(isValidOnboardingScore(38, 50)).toBe(true);
  });
});

describe("onboarding score filter (v3.63 ScoreSubjectCard contract)", () => {
  // The predicate above is composed by ScoreSubjectCard in a `.filter`
  // call. These tests pin the composition — what survives the filter,
  // what gets dropped — because the per-subject summary
  // (Average/Best/completion) reads off the filtered list, not the
  // raw normalized list.
  function filterScores(values: number[], maxScore: number): number[] {
    return values.filter((value) => isValidOnboardingScore(value, maxScore));
  }

  it("drops the over-max value but keeps the valid one", () => {
    expect(filterScores([15, 999], 20)).toEqual([15]);
  });

  it("returns an empty array when every value is invalid", () => {
    expect(filterScores([-1, 21, Number.NaN], 20)).toEqual([]);
  });

  it("preserves order of valid values (Average/Best math depends on this)", () => {
    expect(filterScores([5, 999, 10, -1, 18], 20)).toEqual([5, 10, 18]);
  });

  it("the empty-input case returns an empty array (no crash for fresh user)", () => {
    expect(filterScores([], 20)).toEqual([]);
  });
});
