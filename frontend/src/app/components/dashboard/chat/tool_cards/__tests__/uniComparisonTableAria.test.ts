import { describe, it, expect } from "vitest";
import { uniComparisonTableCaption } from "../uniComparisonTableAria";

describe("uniComparisonTableCaption — RU happy paths", () => {
  it("3 unis, 7 rows", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", "ЕНУ", "КБТУ"],
        rowCount: 7,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ, КБТУ. 7 параметров.");
  });

  it("2 unis, 1 row → singular параметр", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", "ЕНУ"],
        rowCount: 1,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ. 1 параметр.");
  });

  it("3 unis, 2 rows → paucal", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", "ЕНУ", "КБТУ"],
        rowCount: 2,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ, КБТУ. 2 параметра.");
  });

  it("3 unis, 11 rows → genitive plural (teen)", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", "ЕНУ", "КБТУ"],
        rowCount: 11,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ, КБТУ. 11 параметров.");
  });

  it("21 rows → singular (units rule)", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ"],
        rowCount: 21,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ. 21 параметр.");
  });

  it("caps at 3 unis", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["A", "B", "C", "D", "E"],
        rowCount: 5,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: A, B, C. 5 параметров.");
  });

  it("0 rows → no row phrase", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", "ЕНУ"],
        rowCount: 0,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ");
  });

  it("no unis, no rows → bare title", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: [],
        rowCount: 0,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов");
  });
});

describe("uniComparisonTableCaption — KZ", () => {
  it("3 unis, 7 rows KZ", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["ҚазҰУ", "ЕҰУ", "КБТУ"],
        rowCount: 7,
        lang: "kz",
      }),
    ).toBe("Университеттерді салыстыру: ҚазҰУ, ЕҰУ, КБТУ. 7 параметр.");
  });

  it("KZ uninflected for any count", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["ҚазҰУ"],
        rowCount: 1,
        lang: "kz",
      }),
    ).toBe("Университеттерді салыстыру: ҚазҰУ. 1 параметр.");
  });

  it("KZ no unis no rows", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: [],
        rowCount: 0,
        lang: "kz",
      }),
    ).toBe("Университеттерді салыстыру");
  });
});

describe("uniComparisonTableCaption — defensive", () => {
  it("non-array uniNames → empty list", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: null,
        rowCount: 7,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов. 7 параметров.");
    expect(
      uniComparisonTableCaption({
        uniNames: "abc",
        rowCount: 7,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов. 7 параметров.");
  });

  it("filters non-string entries", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ", 123, null, "ЕНУ", undefined],
        rowCount: 5,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ. 5 параметров.");
  });

  it("trims and drops empty/whitespace strings", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["  КазНУ  ", "", "   ", "ЕНУ"],
        rowCount: 5,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ, ЕНУ. 5 параметров.");
  });

  it("non-numeric rowCount → 0", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ"],
        rowCount: "abc",
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ");
  });

  it("negative/fractional rowCount", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ"],
        rowCount: -5,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ");
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ"],
        rowCount: 5.7,
        lang: "ru",
      }),
    ).toBe("Сравнение университетов: КазНУ. 5 параметров.");
  });

  it("unrecognized lang → ru", () => {
    expect(
      uniComparisonTableCaption({
        uniNames: ["КазНУ"],
        rowCount: 5,
        lang: "en",
      }),
    ).toBe("Сравнение университетов: КазНУ. 5 параметров.");
  });

  it("purity: same input same output", () => {
    const a = uniComparisonTableCaption({
      uniNames: ["КазНУ", "ЕНУ"],
      rowCount: 5,
      lang: "ru",
    });
    uniComparisonTableCaption({
      uniNames: ["X"],
      rowCount: 99,
      lang: "kz",
    });
    const b = uniComparisonTableCaption({
      uniNames: ["КазНУ", "ЕНУ"],
      rowCount: 5,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
