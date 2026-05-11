import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  parseRelativeTimeValue,
  relativeTimeUnit,
} from "../formatRelativeTime";

const NOW = new Date("2026-04-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("parseRelativeTimeValue", () => {
  it("returns null for null/undefined/non-string", () => {
    expect(parseRelativeTimeValue(null)).toBeNull();
    expect(parseRelativeTimeValue(undefined)).toBeNull();
    expect(parseRelativeTimeValue(42 as unknown as string)).toBeNull();
  });
  it("returns null on empty / whitespace string", () => {
    expect(parseRelativeTimeValue("")).toBeNull();
    expect(parseRelativeTimeValue("   ")).toBeNull();
  });
  it("returns null on Invalid Date string", () => {
    expect(parseRelativeTimeValue("definitely not a date")).toBeNull();
  });
  it("returns null on Invalid Date instance", () => {
    expect(parseRelativeTimeValue(new Date("nope"))).toBeNull();
  });
  it("parses ISO-8601", () => {
    expect(parseRelativeTimeValue("2026-04-28T12:00:00Z")?.toISOString()).toBe(
      "2026-04-28T12:00:00.000Z",
    );
  });
});

describe("formatRelativeTime — guard cases", () => {
  it("returns null when value is unparseable", () => {
    expect(
      formatRelativeTime({ value: null, now: NOW, lang: "ru" }),
    ).toBeNull();
    expect(
      formatRelativeTime({ value: "garbage", now: NOW, lang: "ru" }),
    ).toBeNull();
  });
  it("collapses future timestamps to 'just now' (clock-skew defense)", () => {
    const future = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime({ value: future, now: NOW, lang: "ru" })).toBe(
      "только что",
    );
    expect(formatRelativeTime({ value: future, now: NOW, lang: "kz" })).toBe(
      "жаңа ғана",
    );
  });
});

describe("formatRelativeTime — RU buckets", () => {
  it("'just now' for < 1 minute", () => {
    expect(
      formatRelativeTime({ value: ago(30 * 1000), now: NOW, lang: "ru" }),
    ).toBe("только что");
  });
  it("'1 минуту назад' (singular)", () => {
    expect(
      formatRelativeTime({ value: ago(60 * 1000), now: NOW, lang: "ru" }),
    ).toBe("1 минуту назад");
  });
  it("'2 минуты назад' (paucal)", () => {
    expect(
      formatRelativeTime({ value: ago(2 * 60 * 1000), now: NOW, lang: "ru" }),
    ).toBe("2 минуты назад");
  });
  it("'5 минут назад' (genitive plural)", () => {
    expect(
      formatRelativeTime({ value: ago(5 * 60 * 1000), now: NOW, lang: "ru" }),
    ).toBe("5 минут назад");
  });
  it("'13 минут назад' (teen → genitive plural)", () => {
    expect(
      formatRelativeTime({ value: ago(13 * 60 * 1000), now: NOW, lang: "ru" }),
    ).toBe("13 минут назад");
  });
  it("'21 минуту назад' (mod10===1, mod100!==11)", () => {
    expect(
      formatRelativeTime({ value: ago(21 * 60 * 1000), now: NOW, lang: "ru" }),
    ).toBe("21 минуту назад");
  });
  it("'3 часа назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(3 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("3 часа назад");
  });
  it("'5 часов назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(5 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("5 часов назад");
  });
  it("'вчера' between 24h and 48h", () => {
    expect(
      formatRelativeTime({
        value: ago(30 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("вчера");
  });
  it("'3 дня назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(3 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("3 дня назад");
  });
  it("'2 недели назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(15 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("2 недели назад");
  });
  it("'2 месяца назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(60 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("2 месяца назад");
  });
  it("'1 год назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(366 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("1 год назад");
  });
  it("'5 лет назад'", () => {
    expect(
      formatRelativeTime({
        value: ago(5 * 366 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "ru",
      }),
    ).toBe("5 лет назад");
  });
});

describe("formatRelativeTime — KZ buckets", () => {
  it("'жаңа ғана' for < 1 minute", () => {
    expect(
      formatRelativeTime({ value: ago(20 * 1000), now: NOW, lang: "kz" }),
    ).toBe("жаңа ғана");
  });
  it("'5 минут бұрын'", () => {
    expect(
      formatRelativeTime({ value: ago(5 * 60 * 1000), now: NOW, lang: "kz" }),
    ).toBe("5 минут бұрын");
  });
  it("'кеше' between 24h and 48h", () => {
    expect(
      formatRelativeTime({
        value: ago(30 * 60 * 60 * 1000),
        now: NOW,
        lang: "kz",
      }),
    ).toBe("кеше");
  });
  it("'3 күн бұрын'", () => {
    expect(
      formatRelativeTime({
        value: ago(3 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "kz",
      }),
    ).toBe("3 күн бұрын");
  });
  it("'2 ай бұрын'", () => {
    expect(
      formatRelativeTime({
        value: ago(60 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "kz",
      }),
    ).toBe("2 ай бұрын");
  });
  it("'1 жыл бұрын'", () => {
    expect(
      formatRelativeTime({
        value: ago(366 * 24 * 60 * 60 * 1000),
        now: NOW,
        lang: "kz",
      }),
    ).toBe("1 жыл бұрын");
  });
});

describe("relativeTimeUnit — direct probe", () => {
  it("RU minute pluralisation", () => {
    expect(relativeTimeUnit(1, "minute", "ru")).toBe("1 минуту");
    expect(relativeTimeUnit(2, "minute", "ru")).toBe("2 минуты");
    expect(relativeTimeUnit(5, "minute", "ru")).toBe("5 минут");
    expect(relativeTimeUnit(11, "minute", "ru")).toBe("11 минут");
    expect(relativeTimeUnit(21, "minute", "ru")).toBe("21 минуту");
  });
  it("KZ uses single form regardless of count", () => {
    expect(relativeTimeUnit(1, "minute", "kz")).toBe("1 минут");
    expect(relativeTimeUnit(7, "minute", "kz")).toBe("7 минут");
    expect(relativeTimeUnit(1, "hour", "kz")).toBe("1 сағат");
    expect(relativeTimeUnit(11, "year", "kz")).toBe("11 жыл");
  });
});
