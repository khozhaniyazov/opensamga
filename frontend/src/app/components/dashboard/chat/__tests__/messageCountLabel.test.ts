/**
 * s35 wave 44 (2026-04-28) — vitest pins for messageCountLabel.
 *
 * Bug: ChatHeader subtitle was using `lang === "kz" ? "хабарлама"
 * : "сообщений"` inline → "1 сообщений" / "2 сообщений" / "5
 * сообщений" regardless of count. Pure helper now applies the
 * full RU paucal table.
 */

import { describe, expect, it } from "vitest";
import { messageCountLabel, messageNounRu } from "../messageCountLabel";

describe("messageNounRu (RU paucal)", () => {
  it("1 → singular 'сообщение'", () => {
    expect(messageNounRu(1)).toBe("сообщение");
    expect(messageNounRu(21)).toBe("сообщение"); // units rule
    expect(messageNounRu(101)).toBe("сообщение");
  });

  it("2-4 → paucal 'сообщения'", () => {
    expect(messageNounRu(2)).toBe("сообщения");
    expect(messageNounRu(3)).toBe("сообщения");
    expect(messageNounRu(4)).toBe("сообщения");
    expect(messageNounRu(22)).toBe("сообщения");
    expect(messageNounRu(34)).toBe("сообщения");
  });

  it("5-20 + teens 11-14 → genitive plural 'сообщений'", () => {
    expect(messageNounRu(0)).toBe("сообщений");
    expect(messageNounRu(5)).toBe("сообщений");
    expect(messageNounRu(10)).toBe("сообщений");
    expect(messageNounRu(11)).toBe("сообщений");
    expect(messageNounRu(12)).toBe("сообщений");
    expect(messageNounRu(13)).toBe("сообщений");
    expect(messageNounRu(14)).toBe("сообщений");
    expect(messageNounRu(20)).toBe("сообщений");
    expect(messageNounRu(25)).toBe("сообщений");
    expect(messageNounRu(100)).toBe("сообщений");
  });
});

describe("messageCountLabel — RU", () => {
  it("0 messages", () => {
    expect(messageCountLabel({ count: 0, lang: "ru" })).toBe("0 сообщений");
  });

  it("1 message", () => {
    expect(messageCountLabel({ count: 1, lang: "ru" })).toBe("1 сообщение");
  });

  it("paucal 2-4", () => {
    expect(messageCountLabel({ count: 2, lang: "ru" })).toBe("2 сообщения");
    expect(messageCountLabel({ count: 4, lang: "ru" })).toBe("4 сообщения");
  });

  it("teen 11-14 → genitive plural", () => {
    expect(messageCountLabel({ count: 11, lang: "ru" })).toBe("11 сообщений");
    expect(messageCountLabel({ count: 14, lang: "ru" })).toBe("14 сообщений");
  });

  it("units rule: 21 → singular", () => {
    expect(messageCountLabel({ count: 21, lang: "ru" })).toBe("21 сообщение");
  });

  it("regression: ChatHeader subtitle no longer says '1 сообщений'", () => {
    // The bug we just fixed.
    expect(messageCountLabel({ count: 1, lang: "ru" })).not.toContain(
      "сообщений",
    );
    expect(messageCountLabel({ count: 5, lang: "ru" })).toBe("5 сообщений");
  });
});

describe("messageCountLabel — KZ (uninflected)", () => {
  it("KZ always uses bare 'хабарлама'", () => {
    expect(messageCountLabel({ count: 1, lang: "kz" })).toBe("1 хабарлама");
    expect(messageCountLabel({ count: 5, lang: "kz" })).toBe("5 хабарлама");
    expect(messageCountLabel({ count: 21, lang: "kz" })).toBe("21 хабарлама");
  });
});

describe("messageCountLabel — defensive coercion", () => {
  it("null / undefined → 0", () => {
    expect(messageCountLabel({ count: null, lang: "ru" })).toBe("0 сообщений");
    expect(messageCountLabel({ count: undefined, lang: "ru" })).toBe(
      "0 сообщений",
    );
  });

  it("NaN / Infinity → 0", () => {
    expect(messageCountLabel({ count: NaN, lang: "ru" })).toBe("0 сообщений");
    expect(messageCountLabel({ count: Infinity, lang: "ru" })).toBe(
      "0 сообщений",
    );
  });

  it("negative → 0", () => {
    expect(messageCountLabel({ count: -3, lang: "ru" })).toBe("0 сообщений");
  });

  it("float floors to integer", () => {
    expect(messageCountLabel({ count: 2.7, lang: "ru" })).toBe("2 сообщения");
  });

  it("unknown lang falls back to ru", () => {
    expect(messageCountLabel({ count: 5, lang: "en" as never })).toBe(
      "5 сообщений",
    );
  });
});

describe("messageCountLabel — purity", () => {
  it("same input → same output", () => {
    const a = messageCountLabel({ count: 7, lang: "ru" });
    const b = messageCountLabel({ count: 7, lang: "ru" });
    expect(a).toBe(b);
  });
});
