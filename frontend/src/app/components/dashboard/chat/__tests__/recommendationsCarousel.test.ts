/**
 * s33 (B2) — vitest pins for the recommendation tile scoring.
 */

import { describe, expect, it } from "vitest";
import {
  computeRecommendations,
  shouldShowRecommendationsCarousel,
  topRecommendations,
  type Recommendation,
} from "../recommendationsCarousel";
import {
  DEFAULT_TEMPLATE_CONTEXT,
  type TemplateContext,
} from "../templateContext";

function ctx(overrides: Partial<TemplateContext>): TemplateContext {
  return { ...DEFAULT_TEMPLATE_CONTEXT, ...overrides };
}

describe("computeRecommendations", () => {
  it("returns nothing for an empty context", () => {
    expect(computeRecommendations(ctx({}), "ru")).toEqual([]);
  });

  it("emits drill_weakest when weakest_subject is set", () => {
    const recs = computeRecommendations(
      ctx({ weakest_subject: "Математика" }),
      "ru",
    );
    expect(recs.map((r) => r.id)).toContain("drill_weakest");
  });

  it("emits compare_to_dream_uni only with both uni AND results", () => {
    const onlyUni = computeRecommendations(
      ctx({ target_university_name: "КазНУ" }),
      "ru",
    );
    expect(onlyUni.map((r) => r.id)).not.toContain("compare_to_dream_uni");

    const both = computeRecommendations(
      ctx({
        target_university_name: "КазНУ",
        last_test_results_count: 3,
      }),
      "ru",
    );
    expect(both.map((r) => r.id)).toContain("compare_to_dream_uni");
  });

  it("emits review_mistakes when unresolved count > 0", () => {
    const recs = computeRecommendations(
      ctx({ unresolved_mistakes_count: 7 }),
      "ru",
    );
    expect(recs.map((r) => r.id)).toContain("review_mistakes");
  });

  it("plan_this_week ONLY fires as a fallback (no other signal)", () => {
    const fallback = computeRecommendations(
      ctx({ has_onboarding_profile: true }),
      "ru",
    );
    expect(fallback.map((r) => r.id)).toContain("plan_this_week");

    const withWeakest = computeRecommendations(
      ctx({ has_onboarding_profile: true, weakest_subject: "Физика" }),
      "ru",
    );
    expect(withWeakest.map((r) => r.id)).not.toContain("plan_this_week");
  });

  it("drill_weakest gets a +5 boost when mistakes are also present", () => {
    const without = computeRecommendations(
      ctx({ weakest_subject: "Биология" }),
      "ru",
    ).find((r) => r.id === "drill_weakest")!;
    const withMistakes = computeRecommendations(
      ctx({ weakest_subject: "Биология", unresolved_mistakes_count: 5 }),
      "ru",
    ).find((r) => r.id === "drill_weakest")!;
    expect(withMistakes.score).toBeGreaterThan(without.score);
  });

  it("KZ wording differs from RU wording", () => {
    const ru = computeRecommendations(
      ctx({ weakest_subject: "Химия" }),
      "ru",
    )[0];
    const kz = computeRecommendations(
      ctx({ weakest_subject: "Химия" }),
      "kz",
    )[0];
    expect(ru.title).not.toBe(kz.title);
    expect(ru.prompt).not.toBe(kz.prompt);
  });
});

describe("topRecommendations", () => {
  it("returns at most `limit` items, sorted by descending score", () => {
    const recs = topRecommendations(
      ctx({
        weakest_subject: "Математика",
        target_university_name: "КазНУ",
        last_test_results_count: 4,
        unresolved_mistakes_count: 9,
      }),
      "ru",
    );
    expect(recs.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < recs.length; i += 1) {
      expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
    }
    // Top of the list should be drill_weakest (highest score).
    expect(recs[0].id).toBe("drill_weakest");
  });

  it("respects the limit option (default 3)", () => {
    const all = topRecommendations(
      ctx({
        weakest_subject: "Математика",
        target_university_name: "КазНУ",
        last_test_results_count: 4,
        unresolved_mistakes_count: 9,
      }),
      "ru",
      { limit: 1 },
    );
    expect(all.length).toBe(1);
  });

  it("returns [] for limit <= 0", () => {
    expect(
      topRecommendations(ctx({ weakest_subject: "Математика" }), "ru", {
        limit: 0,
      }),
    ).toEqual([]);
    expect(
      topRecommendations(ctx({ weakest_subject: "Математика" }), "ru", {
        limit: -1,
      }),
    ).toEqual([]);
  });

  it("dedups by id (no duplicate tile in output)", () => {
    const recs = topRecommendations(
      ctx({
        weakest_subject: "Физика",
        target_university_name: "КазНУ",
        last_test_results_count: 4,
        unresolved_mistakes_count: 2,
      }),
      "ru",
    );
    const ids = recs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("shouldShowRecommendationsCarousel", () => {
  it("hides on empty list", () => {
    expect(shouldShowRecommendationsCarousel([])).toBe(false);
  });

  it("shows on any non-empty list", () => {
    const fake = [{ id: "drill_weakest" } as unknown as Recommendation];
    expect(shouldShowRecommendationsCarousel(fake)).toBe(true);
  });

  it("defends against non-array input", () => {
    expect(
      shouldShowRecommendationsCarousel(null as unknown as Recommendation[]),
    ).toBe(false);
    expect(
      shouldShowRecommendationsCarousel(
        undefined as unknown as Recommendation[],
      ),
    ).toBe(false);
  });
});
