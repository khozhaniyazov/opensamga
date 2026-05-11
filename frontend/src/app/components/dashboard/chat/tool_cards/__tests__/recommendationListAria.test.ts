import { describe, it, expect } from "vitest";
import { recommendationRowAriaLabel } from "../recommendationListAria";

describe("recommendationRowAriaLabel — RU happy paths", () => {
  it("complete row, positive margin", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "Юриспруденция",
        city: "Алматы",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe(
      "1 место: КазНУ, Юриспруденция, Алматы. Порог 130, запас баллов +12.",
    );
  });

  it("rank 2, smaller margin", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 2,
        university: "ЕНУ",
        major: "Информатика",
        city: "Астана",
        threshold: 125,
        margin: 5,
        lang: "ru",
      }),
    ).toBe("2 место: ЕНУ, Информатика, Астана. Порог 125, запас баллов +5.");
  });

  it("zero margin", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 3,
        university: "КБТУ",
        major: "Финансы",
        city: "Алматы",
        threshold: 120,
        margin: 0,
        lang: "ru",
      }),
    ).toBe("3 место: КБТУ, Финансы, Алматы. Порог 120, запас баллов 0.");
  });

  it("negative margin uses Unicode minus", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 4,
        university: "КИМЭП",
        major: "МО",
        city: "Алматы",
        threshold: 135,
        margin: -3,
        lang: "ru",
      }),
    ).toBe("4 место: КИМЭП, МО, Алматы. Порог 135, запас баллов −3.");
  });

  it("missing city", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "Юриспруденция",
        city: "",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ, Юриспруденция. Порог 130, запас баллов +12.");
  });

  it("missing major", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "",
        city: "Алматы",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ, Алматы. Порог 130, запас баллов +12.");
  });

  it("missing major + city", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "",
        city: "",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ. Порог 130, запас баллов +12.");
  });

  it("rank 0 / missing → no place prefix", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 0,
        university: "КазНУ",
        major: "Юриспруденция",
        city: "Алматы",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("КазНУ, Юриспруденция, Алматы. Порог 130, запас баллов +12.");
  });
});

describe("recommendationRowAriaLabel — KZ", () => {
  it("complete row KZ", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "ҚазҰУ",
        major: "Заңтану",
        city: "Алматы",
        threshold: 130,
        margin: 12,
        lang: "kz",
      }),
    ).toBe("1-орын: ҚазҰУ, Заңтану, Алматы. Шекті балл 130, баллдар қоры +12.");
  });

  it("KZ negative margin", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 5,
        university: "ҚазҰУ",
        major: "Заңтану",
        city: "Алматы",
        threshold: 130,
        margin: -7,
        lang: "kz",
      }),
    ).toBe("5-орын: ҚазҰУ, Заңтану, Алматы. Шекті балл 130, баллдар қоры −7.");
  });

  it("KZ no university → fallback", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "",
        major: "",
        city: "",
        threshold: 130,
        margin: 12,
        lang: "kz",
      }),
    ).toBe("1-орын: белгісіз университет. Шекті балл 130, баллдар қоры +12.");
  });
});

describe("recommendationRowAriaLabel — defensive", () => {
  it("non-string strings → empty", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: 123,
        major: null,
        city: undefined,
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("1 место: университет не указан. Порог 130, запас баллов +12.");
  });

  it("non-numeric threshold/margin → 0", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "",
        city: "",
        threshold: "abc",
        margin: NaN,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ. Порог 0, запас баллов 0.");
  });

  it("rounds fractional values", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1.4,
        university: "КазНУ",
        major: "",
        city: "",
        threshold: 130.6,
        margin: 12.4,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ. Порог 131, запас баллов +12.");
  });

  it("trims whitespace", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "  КазНУ  ",
        major: "  Право  ",
        city: "  Алматы  ",
        threshold: 130,
        margin: 12,
        lang: "ru",
      }),
    ).toBe("1 место: КазНУ, Право, Алматы. Порог 130, запас баллов +12.");
  });

  it("unrecognized lang → ru", () => {
    expect(
      recommendationRowAriaLabel({
        rank: 1,
        university: "КазНУ",
        major: "",
        city: "",
        threshold: 130,
        margin: 12,
        lang: "en",
      }),
    ).toBe("1 место: КазНУ. Порог 130, запас баллов +12.");
  });

  it("purity: same input same output", () => {
    const a = recommendationRowAriaLabel({
      rank: 1,
      university: "КазНУ",
      major: "",
      city: "",
      threshold: 130,
      margin: 12,
      lang: "ru",
    });
    recommendationRowAriaLabel({
      rank: 99,
      university: "Other",
      major: "Other",
      city: "Other",
      threshold: 200,
      margin: -50,
      lang: "kz",
    });
    const b = recommendationRowAriaLabel({
      rank: 1,
      university: "КазНУ",
      major: "",
      city: "",
      threshold: 130,
      margin: 12,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
