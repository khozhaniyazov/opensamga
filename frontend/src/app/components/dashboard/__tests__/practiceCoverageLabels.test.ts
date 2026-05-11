import { describe, expect, it } from "vitest";
import {
  practiceConfidenceLabel,
  practiceGapSummary,
  practiceSubtopicLabel,
  practiceTrackLabel,
} from "../practiceCoverageLabels";

describe("practiceCoverageLabels", () => {
  it("labels known tracks in RU and KZ", () => {
    expect(practiceTrackLabel("standard_unt", "ru")).toBe("Стандарт ЕНТ");
    expect(practiceTrackLabel("standard_unt", "kz")).toBe("ҰБТ стандарты");
    expect(practiceTrackLabel("tipo_shortened", "ru")).toContain("TiPO");
    expect(practiceTrackLabel("creative_exam", "kz")).toBe(
      "Шығармашылық емтихан",
    );
  });

  it("falls back to unknown coverage for missing tracks", () => {
    expect(practiceTrackLabel(null, "ru")).toBe("Покрытие неизвестно");
    expect(practiceTrackLabel("custom_future_track", "kz")).toBe(
      "Қамту белгісіз",
    );
  });

  it("labels confidence defensively", () => {
    expect(practiceConfidenceLabel("high", "ru")).toBe("высокая уверенность");
    expect(practiceConfidenceLabel("medium", "kz")).toBe("сенім орташа");
    expect(practiceConfidenceLabel("future", "ru")).toBe("низкая уверенность");
  });

  it("labels informatics subtopics", () => {
    expect(practiceSubtopicLabel("python", "ru")).toBe("Python");
    expect(practiceSubtopicLabel("algorithms", "kz")).toBe("Алгоритмдер");
    expect(practiceSubtopicLabel("custom", "ru")).toBe("custom");
  });

  it("summarizes known coverage gaps", () => {
    expect(
      practiceGapSummary({ gaps: ["informatics_subtopic_unknown"] }, "ru"),
    ).toContain("Подтема информатики");
    expect(practiceGapSummary({ gaps: ["missing_grade"] }, "kz")).toContain(
      "Сынып дерегі жоқ",
    );
    expect(practiceGapSummary({ gaps: [] }, "ru")).toBeNull();
  });
});
