/**
 * s33 (C5) — vitest pins for the "Explain further" helpers.
 */

import { describe, expect, it } from "vitest";
import {
  EXPLAIN_FURTHER_MIN_WORDS,
  buildExplainFurtherPrompt,
  explainFurtherLabel,
  isExplainFurtherEligible,
} from "../explainFurther";

describe("isExplainFurtherEligible", () => {
  it("accepts paragraphs at the threshold", () => {
    const text = Array.from(
      { length: EXPLAIN_FURTHER_MIN_WORDS },
      () => "x",
    ).join(" ");
    expect(isExplainFurtherEligible(text)).toBe(true);
  });

  it("rejects paragraphs below the threshold", () => {
    const text = Array.from(
      { length: EXPLAIN_FURTHER_MIN_WORDS - 1 },
      () => "x",
    ).join(" ");
    expect(isExplainFurtherEligible(text)).toBe(false);
  });

  it("rejects empty / whitespace / null / undefined / non-string", () => {
    expect(isExplainFurtherEligible("")).toBe(false);
    expect(isExplainFurtherEligible("    ")).toBe(false);
    expect(isExplainFurtherEligible(null)).toBe(false);
    expect(isExplainFurtherEligible(undefined)).toBe(false);
    expect(isExplainFurtherEligible(42 as unknown as string)).toBe(false);
  });

  it("counts whitespace-separated tokens as words", () => {
    // "intro short text" — 3 words; below the threshold.
    expect(isExplainFurtherEligible("intro short text")).toBe(false);
    // 12 short words → eligible.
    expect(
      isExplainFurtherEligible(
        "this paragraph has exactly twelve words to test the eligibility threshold here",
      ),
    ).toBe(true);
  });
});

describe("buildExplainFurtherPrompt", () => {
  it("composes the RU phrasing with the quoted paragraph", () => {
    expect(buildExplainFurtherPrompt("теорема Пифагора", "ru")).toBe(
      "Объясни этот абзац подробнее: «теорема Пифагора»",
    );
  });

  it("composes the KZ phrasing with the quoted paragraph", () => {
    expect(buildExplainFurtherPrompt("Пифагор теоремасы", "kz")).toBe(
      "Осы абзацты толығырақ түсіндіріп беріңіз: «Пифагор теоремасы»",
    );
  });

  it("collapses whitespace in the source paragraph", () => {
    const out = buildExplainFurtherPrompt("foo   bar\n\nbaz", "ru");
    expect(out).toContain("«foo bar baz»");
  });

  it("clips overly long paragraphs to ~280 chars", () => {
    const long = "a ".repeat(400).trim(); // 800 chars
    const out = buildExplainFurtherPrompt(long, "ru");
    expect(out).toContain("…»");
    // Quote portion should be at most ~280 chars + ellipsis.
    const quoted = out.match(/«(.+)»/)?.[1] ?? "";
    expect(quoted.length).toBeLessThanOrEqual(280);
  });

  it("handles empty / null input gracefully", () => {
    // Empty paragraph still yields a valid prompt frame; the
    // assistant will see an empty quote but won't crash.
    expect(buildExplainFurtherPrompt("", "ru")).toBe(
      "Объясни этот абзац подробнее: «»",
    );
  });
});

describe("explainFurtherLabel", () => {
  it("returns the RU label", () => {
    expect(explainFurtherLabel("ru")).toBe("Объяснить подробнее");
  });

  it("returns the KZ label", () => {
    expect(explainFurtherLabel("kz")).toBe("Толығырақ түсіндіру");
  });
});

describe("EXPLAIN_FURTHER_MIN_WORDS", () => {
  it("is the documented threshold (12)", () => {
    expect(EXPLAIN_FURTHER_MIN_WORDS).toBe(12);
  });
});
