import { describe, expect, it } from "vitest";
import { buildUntPrepPlanPrompt, rankTemplates } from "../ChatTemplates";
import {
  DEFAULT_TEMPLATE_CONTEXT,
  type TemplateContext,
} from "../templateContext";

function context(overrides: Partial<TemplateContext>): TemplateContext {
  return { ...DEFAULT_TEMPLATE_CONTEXT, ...overrides };
}

describe("ChatTemplates prep-plan flow", () => {
  it("prioritizes the prep-plan template when profile signals exist", () => {
    const ranked = rankTemplates(
      context({
        has_onboarding_profile: true,
        profile_subjects: ["mathematics", "informatics"],
        last_test_results_count: 1,
        target_university_name: "Astana IT University",
      }),
    );

    expect(ranked[0].id).toBe("prep_plan");
  });

  it("keeps mistake review ahead of prep planning when unresolved mistakes exist", () => {
    const ranked = rankTemplates(
      context({
        unresolved_mistakes_count: 2,
        has_onboarding_profile: true,
        last_test_results_count: 1,
      }),
    );

    expect(ranked[0].id).toBe("explain_mistake");
    expect(ranked.map((template) => template.id)).toContain("prep_plan");
  });

  it("RU prep-plan prompt asks for the required planning inputs", () => {
    const prompt = buildUntPrepPlanPrompt(
      context({
        profile_subjects: ["mathematics", "informatics"],
        weakest_subject: "mathematics",
        target_university_name: "Astana IT University",
        last_test_results_count: 2,
      }),
      "ru",
    );

    expect(prompt).toContain("Мой профиль Samga");
    expect(prompt).toContain("Astana IT University");
    expect(prompt).toContain("текущий балл");
    expect(prompt).toContain("целевой балл");
    expect(prompt).toContain("слабые темы");
    expect(prompt).toContain("язык подготовки");
    expect(prompt).toContain("часы в неделю");
    expect(prompt).toContain("следующего пробника");
    expect(prompt).toContain("практика -> разбор ошибок -> повтор");
  });

  it("KZ prep-plan prompt asks clarifying questions when context is incomplete", () => {
    const prompt = buildUntPrepPlanPrompt(DEFAULT_TEMPLATE_CONTEXT, "kz");

    expect(prompt).toContain("ағымдағы балл");
    expect(prompt).toContain("мақсатты балл");
    expect(prompt).toContain("әлсіз тақырыптар");
    expect(prompt).toContain("дайындық тілі");
    expect(prompt).toContain("аптасына бөлетін сағат");
    expect(prompt).toContain("келесі пробник");
    expect(prompt).toContain("қысқа нақты сұрақтар");
  });
});
