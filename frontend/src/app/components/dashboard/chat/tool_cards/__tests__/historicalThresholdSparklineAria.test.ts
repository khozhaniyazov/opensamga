import { describe, it, expect } from "vitest";
import { historicalThresholdFigureAriaLabel } from "../historicalThresholdSparklineAria";

describe("historicalThresholdFigureAriaLabel — RU happy paths", () => {
  it("3 years, user above 2", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: 2023, threshold: 128 },
          { year: 2024, threshold: 130 },
        ],
        userScore: 129,
        lang: "ru",
      }),
    ).toBe(
      "Динамика порогов за 2022–2024: 125, 128, 130. Ваш балл 129, выше 2 из 3 лет.",
    );
  });

  it("3 years, user above all", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: 2023, threshold: 128 },
          { year: 2024, threshold: 130 },
        ],
        userScore: 140,
        lang: "ru",
      }),
    ).toBe(
      "Динамика порогов за 2022–2024: 125, 128, 130. Ваш балл 140, выше 3 из 3 лет.",
    );
  });

  it("3 years, user below all", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: 2023, threshold: 128 },
          { year: 2024, threshold: 130 },
        ],
        userScore: 100,
        lang: "ru",
      }),
    ).toBe(
      "Динамика порогов за 2022–2024: 125, 128, 130. Ваш балл 100, выше 0 из 3 лет.",
    );
  });

  it("user equal to threshold counts as above", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024, threshold: 130 }],
        userScore: 130,
        lang: "ru",
      }),
    ).toBe("Динамика порогов за 2024: 130. Ваш балл 130, выше 1 из 1 лет.");
  });

  it("no user score → just the trend sentence", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: 2024, threshold: 130 },
        ],
        userScore: null,
        lang: "ru",
      }),
    ).toBe("Динамика порогов за 2022–2024: 125, 130.");
  });

  it("single year only", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024, threshold: 130 }],
        userScore: undefined,
        lang: "ru",
      }),
    ).toBe("Динамика порогов за 2024: 130.");
  });

  it("sorts unsorted years", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2024, threshold: 130 },
          { year: 2022, threshold: 125 },
          { year: 2023, threshold: 128 },
        ],
        userScore: 130,
        lang: "ru",
      }),
    ).toBe(
      "Динамика порогов за 2022–2024: 125, 128, 130. Ваш балл 130, выше 3 из 3 лет.",
    );
  });
});

describe("historicalThresholdFigureAriaLabel — KZ", () => {
  it("KZ trend + user", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: 2023, threshold: 128 },
          { year: 2024, threshold: 130 },
        ],
        userScore: 129,
        lang: "kz",
      }),
    ).toBe(
      "2022–2024 жылдардағы шекті балдар динамикасы: 125, 128, 130. Сіздің балл 129, 3 жылдың 2-нан жоғары.",
    );
  });

  it("KZ no user score", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024, threshold: 130 }],
        userScore: null,
        lang: "kz",
      }),
    ).toBe("2024 жылдардағы шекті балдар динамикасы: 130.");
  });

  it("KZ no data", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [],
        userScore: 130,
        lang: "kz",
      }),
    ).toBe("Шекті балдар тарихы: дерек жоқ");
  });
});

describe("historicalThresholdFigureAriaLabel — defensive", () => {
  it("no points → no-data RU sentence", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [],
        userScore: 130,
        lang: "ru",
      }),
    ).toBe("История порогов: нет данных");
  });

  it("non-array points → no-data sentence", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: null,
        userScore: 130,
        lang: "ru",
      }),
    ).toBe("История порогов: нет данных");
    expect(
      historicalThresholdFigureAriaLabel({
        points: "abc",
        userScore: 130,
        lang: "ru",
      }),
    ).toBe("История порогов: нет данных");
  });

  it("filters out malformed items", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [
          { year: 2022, threshold: 125 },
          { year: "abc", threshold: 999 },
          null,
          { year: 2024, threshold: 130 },
          { year: 2025 }, // missing threshold
        ],
        userScore: 130,
        lang: "ru",
      }),
    ).toBe(
      "Динамика порогов за 2022–2024: 125, 130. Ваш балл 130, выше 2 из 2 лет.",
    );
  });

  it("rounds non-integer thresholds", () => {
    // threshold rounds to 131, user rounds to 130 → user is
    // BELOW the (rounded) threshold, so "выше 0 из 1".
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024.4, threshold: 130.6 }],
        userScore: 130.4,
        lang: "ru",
      }),
    ).toBe("Динамика порогов за 2024: 131. Ваш балл 130, выше 0 из 1 лет.");
  });

  it("non-numeric userScore → no user-score sentence", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024, threshold: 130 }],
        userScore: "abc",
        lang: "ru",
      }),
    ).toBe("Динамика порогов за 2024: 130.");
  });

  it("unrecognized lang → ru", () => {
    expect(
      historicalThresholdFigureAriaLabel({
        points: [{ year: 2024, threshold: 130 }],
        userScore: 130,
        lang: "en",
      }),
    ).toBe("Динамика порогов за 2024: 130. Ваш балл 130, выше 1 из 1 лет.");
  });

  it("purity: same input same output", () => {
    const args = {
      points: [
        { year: 2022, threshold: 125 },
        { year: 2024, threshold: 130 },
      ],
      userScore: 130,
      lang: "ru",
    };
    const a = historicalThresholdFigureAriaLabel(args);
    historicalThresholdFigureAriaLabel({
      points: [],
      userScore: 100,
      lang: "kz",
    });
    const b = historicalThresholdFigureAriaLabel(args);
    expect(a).toBe(b);
  });
});
