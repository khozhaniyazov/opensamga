/**
 * s35 wave 44 (2026-04-28) — vitest pins for toolCountLabel.
 *
 * Bug: ToolCallTimeline step header had `n === 1 ? "1 инструмент"
 * : "${n} инструментов"`. For n=2/3/4 the correct paucal is
 * "инструмента", not "инструментов". reasoningHeader.ts had the
 * full table; ToolCallTimeline drifted. Single shared helper now.
 */

import { describe, expect, it } from "vitest";
import { toolCountLabel, toolNounRu } from "../toolCountLabel";

describe("toolNounRu (RU paucal)", () => {
  it("1 → singular 'инструмент'", () => {
    expect(toolNounRu(1)).toBe("инструмент");
    expect(toolNounRu(21)).toBe("инструмент"); // units rule
    expect(toolNounRu(101)).toBe("инструмент");
  });

  it("2-4 → paucal 'инструмента'", () => {
    expect(toolNounRu(2)).toBe("инструмента");
    expect(toolNounRu(3)).toBe("инструмента");
    expect(toolNounRu(4)).toBe("инструмента");
    expect(toolNounRu(22)).toBe("инструмента");
    expect(toolNounRu(34)).toBe("инструмента");
  });

  it("5-20 + teens 11-14 → genitive plural 'инструментов'", () => {
    expect(toolNounRu(0)).toBe("инструментов");
    expect(toolNounRu(5)).toBe("инструментов");
    expect(toolNounRu(10)).toBe("инструментов");
    expect(toolNounRu(11)).toBe("инструментов");
    expect(toolNounRu(12)).toBe("инструментов");
    expect(toolNounRu(13)).toBe("инструментов");
    expect(toolNounRu(14)).toBe("инструментов");
    expect(toolNounRu(20)).toBe("инструментов");
    expect(toolNounRu(25)).toBe("инструментов");
  });
});

describe("toolCountLabel — RU", () => {
  it("0 tools", () => {
    expect(toolCountLabel({ count: 0, lang: "ru" })).toBe("0 инструментов");
  });

  it("1 tool", () => {
    expect(toolCountLabel({ count: 1, lang: "ru" })).toBe("1 инструмент");
  });

  it("paucal 2-4", () => {
    expect(toolCountLabel({ count: 2, lang: "ru" })).toBe("2 инструмента");
    expect(toolCountLabel({ count: 4, lang: "ru" })).toBe("4 инструмента");
  });

  it("teen 11-14 → genitive plural", () => {
    expect(toolCountLabel({ count: 11, lang: "ru" })).toBe("11 инструментов");
    expect(toolCountLabel({ count: 14, lang: "ru" })).toBe("14 инструментов");
  });

  it("units rule: 21 → singular", () => {
    expect(toolCountLabel({ count: 21, lang: "ru" })).toBe("21 инструмент");
  });

  it("regression: ToolCallTimeline no longer says '2 инструментов'", () => {
    // The bug we just fixed.
    expect(toolCountLabel({ count: 2, lang: "ru" })).toBe("2 инструмента");
    expect(toolCountLabel({ count: 3, lang: "ru" })).toBe("3 инструмента");
    expect(toolCountLabel({ count: 4, lang: "ru" })).toBe("4 инструмента");
  });
});

describe("toolCountLabel — KZ (uninflected)", () => {
  it("KZ always uses bare 'құрал'", () => {
    expect(toolCountLabel({ count: 1, lang: "kz" })).toBe("1 құрал");
    expect(toolCountLabel({ count: 5, lang: "kz" })).toBe("5 құрал");
    expect(toolCountLabel({ count: 21, lang: "kz" })).toBe("21 құрал");
  });
});

describe("toolCountLabel — defensive coercion", () => {
  it("null / undefined → 0", () => {
    expect(toolCountLabel({ count: null, lang: "ru" })).toBe("0 инструментов");
    expect(toolCountLabel({ count: undefined, lang: "ru" })).toBe(
      "0 инструментов",
    );
  });

  it("NaN / Infinity → 0", () => {
    expect(toolCountLabel({ count: NaN, lang: "ru" })).toBe("0 инструментов");
    expect(toolCountLabel({ count: Infinity, lang: "ru" })).toBe(
      "0 инструментов",
    );
  });

  it("negative → 0", () => {
    expect(toolCountLabel({ count: -3, lang: "ru" })).toBe("0 инструментов");
  });

  it("float floors to integer", () => {
    expect(toolCountLabel({ count: 2.7, lang: "ru" })).toBe("2 инструмента");
  });

  it("unknown lang falls back to ru", () => {
    expect(toolCountLabel({ count: 5, lang: "en" as never })).toBe(
      "5 инструментов",
    );
  });
});

describe("toolCountLabel — purity", () => {
  it("same input → same output", () => {
    const a = toolCountLabel({ count: 7, lang: "ru" });
    const b = toolCountLabel({ count: 7, lang: "ru" });
    expect(a).toBe(b);
  });
});
