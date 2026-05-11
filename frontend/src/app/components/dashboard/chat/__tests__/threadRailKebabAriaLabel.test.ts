/**
 * s35 wave 18b — vitest pins for `threadRailKebabAriaLabel`.
 */

import { describe, it, expect } from "vitest";
import {
  threadRailKebabAriaLabel,
  THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH,
} from "../threadRailKebabAriaLabel";

describe("threadRailKebabAriaLabel", () => {
  it("RU: 'Действия для чата «Title»'", () => {
    expect(
      threadRailKebabAriaLabel({
        title: "Сравнить мои баллы",
        lang: "ru",
      }),
    ).toBe("Действия для чата «Сравнить мои баллы»");
  });

  it("KZ: '«Title» чаты үшін әрекеттер'", () => {
    expect(
      threadRailKebabAriaLabel({
        title: "Балдарымды салыстыру",
        lang: "kz",
      }),
    ).toBe("«Балдарымды салыстыру» чаты үшін әрекеттер");
  });

  it("title null → 'Без названия' (RU)", () => {
    expect(threadRailKebabAriaLabel({ title: null, lang: "ru" })).toBe(
      "Действия для чата «Без названия»",
    );
  });

  it("title null → 'Атаусыз' (KZ)", () => {
    expect(threadRailKebabAriaLabel({ title: null, lang: "kz" })).toBe(
      "«Атаусыз» чаты үшін әрекеттер",
    );
  });

  it("title undefined → fallback", () => {
    expect(threadRailKebabAriaLabel({ title: undefined, lang: "ru" })).toBe(
      "Действия для чата «Без названия»",
    );
  });

  it("title whitespace-only → fallback", () => {
    expect(threadRailKebabAriaLabel({ title: "   \n\t  ", lang: "ru" })).toBe(
      "Действия для чата «Без названия»",
    );
  });

  it("title trimmed (leading/trailing whitespace dropped)", () => {
    expect(threadRailKebabAriaLabel({ title: "  Foo  ", lang: "ru" })).toBe(
      "Действия для чата «Foo»",
    );
  });

  it("title with newlines/tabs → collapsed to single spaces", () => {
    expect(
      threadRailKebabAriaLabel({
        title: "Line1\n\nLine2\t\tLine3",
        lang: "ru",
      }),
    ).toBe("Действия для чата «Line1 Line2 Line3»");
  });

  it("title > max length → truncated with single ellipsis", () => {
    const long = "а".repeat(120);
    const out = threadRailKebabAriaLabel({ title: long, lang: "ru" });
    expect(out).toBe(
      "Действия для чата «" +
        "а".repeat(THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH - 1) +
        "…»",
    );
  });

  it("title at exactly max length → not truncated", () => {
    const exact = "x".repeat(THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH);
    expect(threadRailKebabAriaLabel({ title: exact, lang: "ru" })).toBe(
      `Действия для чата «${exact}»`,
    );
  });

  it("title with surrogate pairs counts by codepoint", () => {
    const emoji = "🙂".repeat(THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH + 5);
    const out = threadRailKebabAriaLabel({ title: emoji, lang: "ru" });
    expect(out.endsWith("…»")).toBe(true);
    // intact 🙂 followed by ellipsis (not a broken surrogate)
    expect(out.indexOf("\uD83D\uDE42…»")).toBeGreaterThan(0);
  });

  it("unknown lang → RU fallback copy", () => {
    expect(
      // @ts-expect-error — exercising defensive runtime path
      threadRailKebabAriaLabel({ title: "Test", lang: "en" }),
    ).toBe("Действия для чата «Test»");
  });

  it("THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH is 60", () => {
    expect(THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH).toBe(60);
  });
});
