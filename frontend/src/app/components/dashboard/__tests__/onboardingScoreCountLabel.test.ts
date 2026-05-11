import { describe, expect, it } from "vitest";
import { onboardingScoreCountLabel } from "../onboardingScoreCountLabel";

/**
 * v3.72 (B14 + B19, 2026-05-02): pluralized + de-duplicated label
 * for the score-summary line on each ScoreSubjectCard. Pure helper
 * — full vitest coverage instead of static-source.
 */

describe("onboardingScoreCountLabel — RU plural rule", () => {
  it.each([
    [0, 1, "0 / 1 результат"], // total=1 → 0
    [1, 1, "1 / 1 результат"],
    [0, 2, "0 / 2 результата"], // total=2 → 1
    [3, 4, "3 / 4 результата"], // total=4 → 1
    [0, 5, "0 / 5 результатов"], // total=5 → 2
    [9, 10, "9 / 10 результатов"], // total=10 → 2
    [0, 11, "0 / 11 результатов"], // 11 falls in 11–14 zone → 2
    [0, 14, "0 / 14 результатов"], // 14 falls in 11–14 zone → 2
    [0, 21, "0 / 21 результат"], // mod10=1, mod100=21 → 0
    [0, 22, "0 / 22 результата"], // mod10=2 → 1
    [0, 25, "0 / 25 результатов"], // mod10=5 → 2
    [0, 100, "0 / 100 результатов"], // mod10=0 → 2
    [0, 101, "0 / 101 результат"], // mod10=1, mod100=1 → 0
  ])("(%i / %i, ru) ⇒ %s", (valid, total, expected) => {
    expect(onboardingScoreCountLabel(valid, total, "ru")).toBe(expected);
  });
});

describe("onboardingScoreCountLabel — KZ", () => {
  // KZ doesn't paucal-pluralize the noun. We keep the existing copy
  // ("нәтиже") for every numeric form.
  it.each([
    [0, 1, "0 / 1 нәтиже"],
    [3, 4, "3 / 4 нәтиже"],
    [0, 11, "0 / 11 нәтиже"],
  ])("(%i / %i, kz) ⇒ %s", (valid, total, expected) => {
    expect(onboardingScoreCountLabel(valid, total, "kz")).toBe(expected);
  });
});

describe("onboardingScoreCountLabel — defensive arg handling", () => {
  it("clamps NaN / negative / float inputs to non-negative integers", () => {
    expect(onboardingScoreCountLabel(Number.NaN, 1, "ru")).toBe(
      "0 / 1 результат",
    );
    expect(onboardingScoreCountLabel(-3, 1, "ru")).toBe("0 / 1 результат");
    expect(onboardingScoreCountLabel(1.7, 5.9, "ru")).toBe("1 / 5 результатов");
  });

  it("does not include any 'Максимум' tail (B19 dedup)", () => {
    expect(onboardingScoreCountLabel(0, 1, "ru")).not.toMatch(/Максимум/);
    expect(onboardingScoreCountLabel(0, 1, "kz")).not.toMatch(/Максимум/);
  });

  it("does not include the clipped 'результ.' abbreviation (B14)", () => {
    expect(onboardingScoreCountLabel(0, 1, "ru")).not.toMatch(/результ\./);
  });
});
