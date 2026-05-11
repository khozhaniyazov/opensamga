import { describe, it, expect } from "vitest";
import {
  gaugeProbabilityPercent,
  grantChanceGaugeValueText,
} from "../grantChanceGaugeAria";

describe("gaugeProbabilityPercent", () => {
  it("clamps and rounds", () => {
    expect(gaugeProbabilityPercent(0)).toBe(0);
    expect(gaugeProbabilityPercent(1)).toBe(100);
    expect(gaugeProbabilityPercent(0.5)).toBe(50);
    expect(gaugeProbabilityPercent(0.737)).toBe(74);
    expect(gaugeProbabilityPercent(0.732)).toBe(73);
  });

  it("clamps negatives and >1", () => {
    expect(gaugeProbabilityPercent(-0.2)).toBe(0);
    expect(gaugeProbabilityPercent(1.5)).toBe(100);
  });

  it("non-numbers → 0", () => {
    expect(gaugeProbabilityPercent(null)).toBe(0);
    expect(gaugeProbabilityPercent(undefined)).toBe(0);
    expect(gaugeProbabilityPercent("0.5")).toBe(0);
    expect(gaugeProbabilityPercent(NaN)).toBe(0);
  });
});

describe("grantChanceGaugeValueText — RU", () => {
  it("estimated path", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.73,
        isEstimate: true,
        score: 130,
        threshold: 125,
        lang: "ru",
      }),
    ).toBe("Ваш балл 130, порог 125, оценочная вероятность 73%");
  });

  it("real-data path", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.85,
        isEstimate: false,
        score: 140,
        threshold: 130,
        lang: "ru",
      }),
    ).toBe("Ваш балл 140, порог 130, вероятность поступления 85%");
  });

  it("rounds score / threshold", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.5,
        isEstimate: true,
        score: 130.4,
        threshold: 125.6,
        lang: "ru",
      }),
    ).toBe("Ваш балл 130, порог 126, оценочная вероятность 50%");
  });

  it("0% and 100% extremes", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0,
        isEstimate: true,
        score: 80,
        threshold: 130,
        lang: "ru",
      }),
    ).toBe("Ваш балл 80, порог 130, оценочная вероятность 0%");
    expect(
      grantChanceGaugeValueText({
        probability: 1,
        isEstimate: false,
        score: 140,
        threshold: 100,
        lang: "ru",
      }),
    ).toBe("Ваш балл 140, порог 100, вероятность поступления 100%");
  });
});

describe("grantChanceGaugeValueText — KZ", () => {
  it("estimated path KZ", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.73,
        isEstimate: true,
        score: 130,
        threshold: 125,
        lang: "kz",
      }),
    ).toBe("Сіздің балл 130, шекті балл 125, болжамды ықтималдық 73%");
  });

  it("real-data path KZ", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.85,
        isEstimate: false,
        score: 140,
        threshold: 130,
        lang: "kz",
      }),
    ).toBe("Сіздің балл 140, шекті балл 130, грант алу ықтималдығы 85%");
  });
});

describe("grantChanceGaugeValueText — defensive", () => {
  it("non-numeric score / threshold → 0", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.5,
        isEstimate: true,
        score: "abc",
        threshold: null,
        lang: "ru",
      }),
    ).toBe("Ваш балл 0, порог 0, оценочная вероятность 50%");
  });

  it("non-boolean isEstimate → falsy → real-data verdict", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.5,
        isEstimate: "yes",
        score: 100,
        threshold: 100,
        lang: "ru",
      }),
    ).toBe("Ваш балл 100, порог 100, вероятность поступления 50%");
  });

  it("unrecognized lang → defaults to RU", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.5,
        isEstimate: true,
        score: 100,
        threshold: 100,
        lang: "en",
      }),
    ).toBe("Ваш балл 100, порог 100, оценочная вероятность 50%");
  });

  it("null lang → defaults to RU", () => {
    expect(
      grantChanceGaugeValueText({
        probability: 0.5,
        isEstimate: true,
        score: 100,
        threshold: 100,
        lang: null,
      }),
    ).toBe("Ваш балл 100, порог 100, оценочная вероятность 50%");
  });

  it("purity: same input same output", () => {
    const a = grantChanceGaugeValueText({
      probability: 0.5,
      isEstimate: true,
      score: 100,
      threshold: 100,
      lang: "ru",
    });
    grantChanceGaugeValueText({
      probability: 0.99,
      isEstimate: false,
      score: 200,
      threshold: 50,
      lang: "kz",
    });
    const b = grantChanceGaugeValueText({
      probability: 0.5,
      isEstimate: true,
      score: 100,
      threshold: 100,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
