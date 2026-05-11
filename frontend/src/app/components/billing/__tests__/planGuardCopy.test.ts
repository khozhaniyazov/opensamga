import { describe, expect, it, vi } from "vitest";
import {
  planGuardChipLabel,
  planGuardCopy,
  type PlanGuardFeature,
} from "../planGuardCopy";

/**
 * v3.74 (B17, 2026-05-02): pure-helper test surface for the
 * locked-page copy convergence. Pre-v3.74 the title/description/hero
 * lived in three nested feature-quiz ternaries inside PlanGuard.tsx
 * and looked like "4 different copies" of the locked page. v3.74
 * lifts the decision into planGuardCopy() — same strings, single
 * shape, fully testable.
 */

const NON_QUIZ_FEATURES: PlanGuardFeature[] = [
  "exams",
  "mistakes",
  "training",
  "gap-analysis",
];

describe("planGuardCopy — quiz variant", () => {
  it("renders the quiz-specific title in RU", () => {
    const out = planGuardCopy("quiz", "ru", () => "i18n-key");
    expect(out.title).toBe("Быстрый тест внутри Premium");
    expect(out.description).toContain("Premium-тренировки");
    expect(out.hero).toContain("Premium-тренировки");
  });

  it("renders the quiz-specific title in KZ", () => {
    const out = planGuardCopy("quiz", "kz", () => "i18n-key");
    expect(out.title).toBe("Жылдам тест Premium ішінде");
    expect(out.description).toContain("Premium жаттығу");
    expect(out.hero).toContain("Premium жаттығу");
  });

  it("does NOT call resolveI18n for the quiz variant", () => {
    const resolver = vi.fn(() => "should-not-be-used");
    planGuardCopy("quiz", "ru", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("planGuardCopy — generic variant (non-quiz features converge)", () => {
  it.each(NON_QUIZ_FEATURES)(
    "uses the same generic title for %s in RU",
    (feature) => {
      const out = planGuardCopy(feature, "ru", () => "ignored");
      expect(out.title).toBe("Эта страница пока закрыта");
    },
  );

  it.each(NON_QUIZ_FEATURES)(
    "uses the same generic title for %s in KZ",
    (feature) => {
      const out = planGuardCopy(feature, "kz", () => "ignored");
      expect(out.title).toBe("Бұл бет әзірге жабық");
    },
  );

  it("delegates description to the resolveI18n callback for guard.locked", () => {
    const resolver = vi.fn((key: string) => `[${key}]`);
    const out = planGuardCopy("exams", "ru", resolver);
    expect(resolver).toHaveBeenCalledWith("guard.locked");
    expect(out.description).toBe("[guard.locked]");
  });

  it("renders distinct RU and KZ hero copy for the generic variant", () => {
    const ru = planGuardCopy("exams", "ru", () => "x");
    const kz = planGuardCopy("exams", "kz", () => "x");
    expect(ru.hero).not.toBe(kz.hero);
    expect(ru.hero).toContain("Samga Premium");
    expect(kz.hero).toContain("Samga Premium");
  });
});

describe("planGuardCopy — convergence guard (B17)", () => {
  it("returns identical title shape for every non-quiz feature × language", () => {
    // The whole point of B17 is that the locked-page copy converges.
    // Pre-v3.74 four features rendered the same generic strings only
    // because of the JSX-shape ternary cascade. Lock that down.
    for (const lang of ["ru", "kz"] as const) {
      const reference = planGuardCopy("exams", lang, () => `desc-${lang}`);
      for (const feature of NON_QUIZ_FEATURES) {
        const out = planGuardCopy(feature, lang, () => `desc-${lang}`);
        expect(out).toEqual(reference);
      }
    }
  });
});

describe("planGuardChipLabel", () => {
  it("returns the feature name fallback for non-quiz features", () => {
    for (const f of NON_QUIZ_FEATURES) {
      expect(planGuardChipLabel(f, "ru", "Разборы ошибок")).toBe(
        "Разборы ошибок",
      );
      expect(planGuardChipLabel(f, "kz", "Қателерді талдау")).toBe(
        "Қателерді талдау",
      );
    }
  });

  it("returns the localized 'Premium-тренировка' label for quiz", () => {
    expect(planGuardChipLabel("quiz", "ru", "X")).toBe("Premium-тренировка");
    expect(planGuardChipLabel("quiz", "kz", "X")).toBe("Premium жаттығу");
  });
});
