import { describe, expect, it } from "vitest";
import {
  hasWeakTopics,
  totalWeakPoints,
  weakTopicActionLabel,
  weakTopicPlanDayLabel,
  weakTopicPlanIntentLabel,
  weakTopicPriorityClasses,
  weakTopicPriorityLabel,
  type WeakTopicModeResponse,
} from "../weakTopicModeModel";

const baseResponse: WeakTopicModeResponse = {
  target_university: "KIMEP",
  grant_threshold: 130,
  current_score: 110,
  current_score_source: "mock_exam",
  gap: 20,
  total_recoverable_points: 18,
  expected_subjects: ["Mathematics", "Physics"],
  subject_groups: [],
  seven_day_plan: [],
};

describe("weakTopicModeModel", () => {
  it("labels actions in RU and KZ", () => {
    expect(weakTopicActionLabel("learn", "ru")).toBe("Учебник");
    expect(weakTopicActionLabel("learn", "kz")).toBe("Оқулық");
    expect(weakTopicActionLabel("tutor", "ru")).toBe("AI-разбор");
    expect(weakTopicActionLabel("practice", "kz")).toBe("Жаттығу");
    expect(weakTopicActionLabel("retest", "ru")).toBe("Ретест");
  });

  it("falls back to raw action kind for unknown types", () => {
    expect(weakTopicActionLabel("future_kind", "ru")).toBe("future_kind");
  });

  it("labels priorities in RU and KZ regardless of casing", () => {
    expect(weakTopicPriorityLabel("HIGH", "ru")).toBe("Высокий приоритет");
    expect(weakTopicPriorityLabel("medium", "kz")).toBe("Орташа басымдық");
    expect(weakTopicPriorityLabel("LOW", "ru")).toBe("Низкий приоритет");
  });

  it("returns priority CSS classes that include a ring", () => {
    expect(weakTopicPriorityClasses("HIGH")).toContain("rose");
    expect(weakTopicPriorityClasses("medium")).toContain("amber");
    expect(weakTopicPriorityClasses("LOW")).toContain("zinc");
    expect(weakTopicPriorityClasses("UNKNOWN")).toContain("zinc");
  });

  it("labels plan intents distinctly across languages", () => {
    expect(weakTopicPlanIntentLabel("learn", "ru")).toBe("Изучить");
    expect(weakTopicPlanIntentLabel("practice", "kz")).toBe("Жаттығу");
    expect(weakTopicPlanIntentLabel("review", "ru")).toBe("Разбор ошибок");
    expect(weakTopicPlanIntentLabel("retest", "kz")).toBe("Қайта тапсыру");
  });

  it("labels day numbers in localized format", () => {
    expect(weakTopicPlanDayLabel(1, "ru")).toBe("День 1");
    expect(weakTopicPlanDayLabel(7, "kz")).toBe("7-күн");
  });

  it("counts total weak points across subject groups", () => {
    const r: WeakTopicModeResponse = {
      ...baseResponse,
      subject_groups: [
        {
          subject: "Mathematics",
          total_points_lost: 12,
          topics: [],
        },
        {
          subject: "Physics",
          total_points_lost: 5,
          topics: [],
        },
      ],
    };
    expect(totalWeakPoints(r)).toBe(17);
  });

  it("hasWeakTopics is false when no group has topics", () => {
    expect(hasWeakTopics(baseResponse)).toBe(false);

    const r: WeakTopicModeResponse = {
      ...baseResponse,
      subject_groups: [
        {
          subject: "Mathematics",
          total_points_lost: 12,
          topics: [
            {
              topic: "Mathematics",
              subject: "Mathematics",
              points_lost: 12,
              mistake_count: 6,
              pages_to_read: 18,
              priority: "HIGH",
              actions: [
                { kind: "learn", href: "/dashboard/library?q=Mathematics" },
              ],
            },
          ],
        },
      ],
    };
    expect(hasWeakTopics(r)).toBe(true);
  });
});
