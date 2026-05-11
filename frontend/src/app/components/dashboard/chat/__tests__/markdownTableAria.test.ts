import { describe, it, expect } from "vitest";
import { markdownTableAriaLabel } from "../markdownTableAria";

describe("markdownTableAriaLabel — RU happy paths", () => {
  it("3 cols × 5 rows", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 3, rowCount: 5, lang: "ru" }),
    ).toBe("Таблица: 3 столбца, 5 строк.");
  });

  it("1 × 1 — singulars on both axes", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 1, rowCount: 1, lang: "ru" }),
    ).toBe("Таблица: 1 столбец, 1 строка.");
  });

  it("21 × 21 — units rule", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 21, rowCount: 21, lang: "ru" }),
    ).toBe("Таблица: 21 столбец, 21 строка.");
  });

  it("teens are genitive plural", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 11, rowCount: 14, lang: "ru" }),
    ).toBe("Таблица: 11 столбцов, 14 строк.");
  });

  it("paucal 2-4", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 4, rowCount: 3, lang: "ru" }),
    ).toBe("Таблица: 4 столбца, 3 строки.");
  });

  it("paucal 22-24", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 22, rowCount: 24, lang: "ru" }),
    ).toBe("Таблица: 22 столбца, 24 строки.");
  });

  it("genitive plural for ≥5", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 5, rowCount: 7, lang: "ru" }),
    ).toBe("Таблица: 5 столбцов, 7 строк.");
  });

  it("only columns", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 3, rowCount: 0, lang: "ru" }),
    ).toBe("Таблица: 3 столбца.");
  });

  it("only rows", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 0, rowCount: 5, lang: "ru" }),
    ).toBe("Таблица: 5 строк.");
  });

  it("0 × 0 → bare noun", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 0, rowCount: 0, lang: "ru" }),
    ).toBe("Таблица");
  });
});

describe("markdownTableAriaLabel — KZ", () => {
  it("3 × 5", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 3, rowCount: 5, lang: "kz" }),
    ).toBe("Кесте: 3 баған, 5 жол.");
  });

  it("1 × 1 — KZ uninflected", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 1, rowCount: 1, lang: "kz" }),
    ).toBe("Кесте: 1 баған, 1 жол.");
  });

  it("11 × 14 — KZ uninflected", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 11, rowCount: 14, lang: "kz" }),
    ).toBe("Кесте: 11 баған, 14 жол.");
  });

  it("KZ only-rows", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 0, rowCount: 5, lang: "kz" }),
    ).toBe("Кесте: 5 жол.");
  });

  it("KZ 0 × 0 → bare noun", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 0, rowCount: 0, lang: "kz" }),
    ).toBe("Кесте");
  });
});

describe("markdownTableAriaLabel — defensive", () => {
  it("non-numeric inputs → 0", () => {
    expect(
      markdownTableAriaLabel({
        columnCount: "abc",
        rowCount: null,
        lang: "ru",
      }),
    ).toBe("Таблица");
  });

  it("NaN/Infinity → 0", () => {
    expect(
      markdownTableAriaLabel({
        columnCount: NaN,
        rowCount: Infinity,
        lang: "ru",
      }),
    ).toBe("Таблица");
  });

  it("negative → 0", () => {
    expect(
      markdownTableAriaLabel({
        columnCount: -3,
        rowCount: -1,
        lang: "ru",
      }),
    ).toBe("Таблица");
  });

  it("fractional → floored", () => {
    expect(
      markdownTableAriaLabel({
        columnCount: 3.7,
        rowCount: 5.4,
        lang: "ru",
      }),
    ).toBe("Таблица: 3 столбца, 5 строк.");
  });

  it("unrecognized lang → ru", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 3, rowCount: 5, lang: "en" }),
    ).toBe("Таблица: 3 столбца, 5 строк.");
  });

  it("null lang → ru", () => {
    expect(
      markdownTableAriaLabel({ columnCount: 3, rowCount: 5, lang: null }),
    ).toBe("Таблица: 3 столбца, 5 строк.");
  });

  it("purity: same input same output", () => {
    const a = markdownTableAriaLabel({
      columnCount: 3,
      rowCount: 5,
      lang: "ru",
    });
    markdownTableAriaLabel({ columnCount: 99, rowCount: 99, lang: "kz" });
    const b = markdownTableAriaLabel({
      columnCount: 3,
      rowCount: 5,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
