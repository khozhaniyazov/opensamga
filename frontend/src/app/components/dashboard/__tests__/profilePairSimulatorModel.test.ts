/**
 * v3.25 — Profile pair simulator FE model contract tests.
 *
 * No-render, pure-helper assertions. The interactive component is
 * exercised by StrategyLabPage's existing render path; here we just pin
 * the URL builder, the risk label/i18n surface, and the first-wave id
 * mapping that StrategyLabPage relies on.
 */

import { describe, expect, test } from "vitest";

import {
  PROFILE_PAIR_FIRST_WAVE,
  profilePairQueryString,
  profilePairRiskLabel,
  profilePairSeverityClasses,
  profilePairSeverityLabel,
} from "../profilePairSimulatorModel";

describe("PROFILE_PAIR_FIRST_WAVE", () => {
  test("contains the five issue #15 AC#4 pairs", () => {
    const ids = PROFILE_PAIR_FIRST_WAVE.map((p) => p.id);
    expect(ids).toEqual([
      "math-it",
      "bio-chem",
      "phys-math",
      "geo-math",
      "history-law",
    ]);
  });

  test("uses canonical English subject names (not RU/KZ aliases)", () => {
    const subjects = PROFILE_PAIR_FIRST_WAVE.flatMap((p) => p.subjects);
    // Every subject must be ASCII-only canonical English. Catches accidental
    // localization of the BE query param.
    for (const s of subjects) {
      expect(s).toMatch(/^[A-Za-z][A-Za-z\s]*$/);
    }
  });

  test("history-law uses 'Fundamentals of Law' canonical name", () => {
    const pair = PROFILE_PAIR_FIRST_WAVE.find((p) => p.id === "history-law");
    expect(pair?.subjects).toContain("Fundamentals of Law");
    expect(pair?.subjects).toContain("World History");
  });
});

describe("profilePairQueryString", () => {
  test("sorts subjects alphabetically and URL-encodes", () => {
    const qs = profilePairQueryString({
      id: "phys-math",
      subjects: ["Mathematics", "Physics"],
    });
    // Mathematics before Physics → subject1=Mathematics&subject2=Physics
    expect(qs).toBe("subject1=Mathematics&subject2=Physics");
  });

  test("orders consistently regardless of FE input order", () => {
    const a = profilePairQueryString({
      id: "x",
      subjects: ["Physics", "Mathematics"],
    });
    const b = profilePairQueryString({
      id: "x",
      subjects: ["Mathematics", "Physics"],
    });
    expect(a).toBe(b);
  });

  test("URL-encodes spaces in canonical names", () => {
    const qs = profilePairQueryString({
      id: "history-law",
      subjects: ["World History", "Fundamentals of Law"],
    });
    // After alphabetical sort: Fundamentals of Law, World History.
    expect(qs).toBe("subject1=Fundamentals+of+Law&subject2=World+History");
  });
});

describe("profilePairRiskLabel", () => {
  test.each([
    ["narrow_major_range", "ru", "Узкий выбор направлений"],
    ["narrow_major_range", "kz", "Бағыттар тізімі тар"],
    ["high_competition", "ru", "Высокий проходной балл"],
    ["high_competition", "kz", "Өту балы жоғары"],
    ["low_grant_count", "ru", "Мало грантов"],
    ["low_grant_count", "kz", "Грант саны аз"],
  ] as const)("flag=%s lang=%s → %s", (flag, lang, expected) => {
    expect(profilePairRiskLabel(flag, lang)).toBe(expected);
  });

  test("falls back to raw flag for unknown values", () => {
    expect(profilePairRiskLabel("unknown_future_flag", "ru")).toBe(
      "unknown_future_flag",
    );
  });
});

describe("profilePairSeverityClasses", () => {
  test.each(["low", "medium", "high"] as const)(
    "%s severity returns non-empty class string",
    (sev) => {
      const cls = profilePairSeverityClasses(sev);
      expect(cls.length).toBeGreaterThan(0);
    },
  );

  test("each severity yields a distinct color family", () => {
    const low = profilePairSeverityClasses("low");
    const med = profilePairSeverityClasses("medium");
    const high = profilePairSeverityClasses("high");
    expect(new Set([low, med, high]).size).toBe(3);
  });
});

describe("profilePairSeverityLabel", () => {
  test("RU labels for each severity", () => {
    expect(profilePairSeverityLabel("low", "ru")).toBe("Низкий риск");
    expect(profilePairSeverityLabel("medium", "ru")).toBe("Средний риск");
    expect(profilePairSeverityLabel("high", "ru")).toBe("Высокий риск");
  });

  test("KZ labels for each severity", () => {
    expect(profilePairSeverityLabel("low", "kz")).toBe("Төмен тәуекел");
    expect(profilePairSeverityLabel("medium", "kz")).toBe("Орташа тәуекел");
    expect(profilePairSeverityLabel("high", "kz")).toBe("Жоғары тәуекел");
  });
});
