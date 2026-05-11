import { describe, expect, it } from "vitest";
import {
  buildGrantPlanningSummary,
  buildFourChoiceStrategy,
  classifyGrantBand,
  countMissingThresholds,
  countPlaceholderThresholds,
  resolveGrantThreshold,
  type StrategyUniversityOption,
} from "../strategyLabModel";

const universities: StrategyUniversityOption[] = [
  {
    id: 1,
    label: "High safety",
    city: "Almaty",
    median_grant_threshold: 80,
    prestige_score: 70,
  },
  {
    id: 2,
    label: "Balanced fit",
    city: "Almaty",
    median_grant_threshold: 91,
    prestige_score: 80,
  },
  {
    id: 3,
    label: "Ambitious fit",
    city: "Almaty",
    median_grant_threshold: 102,
    prestige_score: 95,
  },
  {
    id: 4,
    label: "Backup fit",
    city: "Astana",
    median_grant_threshold: 70,
    prestige_score: 50,
  },
  {
    id: 5,
    label: "Zero placeholder",
    city: "Almaty",
    median_grant_threshold: 0,
    max_grant_threshold: null,
  },
];

describe("strategyLabModel", () => {
  it("treats zero-like thresholds as missing data", () => {
    expect(resolveGrantThreshold(universities[4])).toBeNull();
    expect(countMissingThresholds(universities)).toBe(1);
    expect(countPlaceholderThresholds(universities)).toBe(1);
  });

  it("uses backend confidence metadata before raw threshold values", () => {
    expect(
      resolveGrantThreshold({
        id: 6,
        label: "Backend placeholder",
        median_grant_threshold: 96,
        max_grant_threshold: null,
        data_confidence: {
          median_grant_threshold: {
            status: "placeholder",
            reason: "zero_placeholder",
          },
        },
      }),
    ).toBeNull();

    expect(
      resolveGrantThreshold({
        id: 7,
        label: "Backend verified",
        median_grant_threshold: 96,
        max_grant_threshold: null,
        data_confidence: {
          median_grant_threshold: {
            status: "verified",
            reason: "positive_score",
          },
        },
      }),
    ).toBe(96);

    expect(
      countPlaceholderThresholds([
        {
          id: 8,
          label: "Marked placeholder",
          median_grant_threshold: 96,
          max_grant_threshold: null,
          data_confidence: {
            median_grant_threshold: {
              status: "placeholder",
              reason: "zero_placeholder",
            },
          },
        },
      ]),
    ).toBe(1);
  });

  it("classifies score margins into strategy bands", () => {
    expect(classifyGrantBand(100, 80)).toEqual({ band: "safe", margin: 20 });
    expect(classifyGrantBand(100, 96)).toEqual({
      band: "balanced",
      margin: 4,
    });
    expect(classifyGrantBand(100, 108)).toEqual({
      band: "ambitious",
      margin: -8,
    });
    expect(classifyGrantBand(100, 125)).toEqual({
      band: "backup",
      margin: -25,
    });
    expect(classifyGrantBand(100, 0)).toEqual({
      band: "backup",
      margin: null,
    });
  });

  it("builds distinct four-choice strategy rows from verified thresholds", () => {
    const choices = buildFourChoiceStrategy(universities, 95, "all");

    expect(choices).toHaveLength(4);
    expect(choices.map((choice) => choice.band)).toEqual([
      "safe",
      "balanced",
      "ambitious",
      "backup",
    ]);
    expect(choices[0].university?.label).toBe("High safety");
    expect(choices[1].university?.label).toBe("Balanced fit");
    expect(choices[2].university?.label).toBe("Ambitious fit");
    expect(choices[3].university?.label).toBe("Backup fit");
    expect(new Set(choices.map((choice) => choice.university?.id)).size).toBe(
      4,
    );
  });

  it("summarizes grant uncertainty without trusting placeholder rows", () => {
    const summary = buildGrantPlanningSummary(universities, 95, "all");

    expect(summary).toMatchObject({
      totalOptions: 5,
      verifiedOptions: 4,
      realisticOptions: 3,
      reachOptions: 1,
      backupOptions: 0,
      missingDataOptions: 1,
      placeholderOptions: 1,
      coverageRatio: 80,
      bestMargin: 25,
      nearestGap: -7,
      status: "uncertain",
      primaryAction: "verify_data",
    });
  });

  it("marks a city filter with no options as limited", () => {
    expect(
      buildGrantPlanningSummary(universities, 95, "Shymkent"),
    ).toMatchObject({
      totalOptions: 0,
      verifiedOptions: 0,
      realisticOptions: 0,
      reachOptions: 0,
      missingDataOptions: 0,
      status: "limited",
      primaryAction: "expand_city",
    });
  });
});
