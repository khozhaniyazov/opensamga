/**
 * s35 wave 16b — vitest pins for `chatTemplateTileAriaLabel`.
 */

import { describe, it, expect } from "vitest";
import {
  chatTemplateTileAriaLabel,
  CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH,
} from "../chatTemplateTileAriaLabel";

describe("chatTemplateTileAriaLabel", () => {
  it("RU: title + short prompt → 'Title. Подсказка: prompt'", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Сравнить мин. баллы",
        prompt: "Сравни мои баллы с минимальными по выбранным вузам.",
        lang: "ru",
      }),
    ).toBe(
      "Сравнить мин. баллы. Подсказка: Сравни мои баллы с минимальными по выбранным вузам.",
    );
  });

  it("KZ: title + short prompt → 'Title. Кеңес: prompt'", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Ең төмен балдарды салыстыру",
        prompt:
          "Менің балдарымды университеттің ең төменгі балдарымен салыстыр.",
        lang: "kz",
      }),
    ).toBe(
      "Ең төмен балдарды салыстыру. Кеңес: Менің балдарымды университеттің ең төменгі балдарымен салыстыр.",
    );
  });

  it("title ends with '?' → no extra period inserted", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Какой вуз выбрать?",
        prompt: "Помоги выбрать.",
        lang: "ru",
      }),
    ).toBe("Какой вуз выбрать? Подсказка: Помоги выбрать.");
  });

  it("title ends with '!' → no extra period", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Решено!",
        prompt: "Покажи решение.",
        lang: "ru",
      }),
    ).toBe("Решено! Подсказка: Покажи решение.");
  });

  it("title ends with '…' → no extra period", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Продолжи…",
        prompt: "Дальше.",
        lang: "ru",
      }),
    ).toBe("Продолжи… Подсказка: Дальше.");
  });

  it("prompt absent → returns title only", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Сравнить баллы",
        lang: "ru",
      }),
    ).toBe("Сравнить баллы");
  });

  it("prompt null → returns title only", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Foo",
        prompt: null,
        lang: "ru",
      }),
    ).toBe("Foo");
  });

  it("prompt whitespace-only → returns title only", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "Foo",
        prompt: "   \n\t  ",
        lang: "ru",
      }),
    ).toBe("Foo");
  });

  it("title null → falls back to 'Шаблон' (RU)", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: null,
        prompt: "Тест",
        lang: "ru",
      }),
    ).toBe("Шаблон. Подсказка: Тест");
  });

  it("title null → falls back to 'Үлгі' (KZ)", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: null,
        prompt: "Тест",
        lang: "kz",
      }),
    ).toBe("Үлгі. Кеңес: Тест");
  });

  it("title whitespace → falls back to 'Шаблон'", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "   ",
        prompt: "Тест",
        lang: "ru",
      }),
    ).toBe("Шаблон. Подсказка: Тест");
  });

  it("prompt > 140 cp → truncated with single ellipsis", () => {
    const long = "а".repeat(200);
    const out = chatTemplateTileAriaLabel({
      title: "T",
      prompt: long,
      lang: "ru",
    });
    expect(out).toBe(
      "T. Подсказка: " +
        "а".repeat(CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH - 1) +
        "…",
    );
  });

  it("prompt with newlines / tabs → collapsed to single spaces", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "T",
        prompt: "first\n\nsecond\t\tthird",
        lang: "ru",
      }),
    ).toBe("T. Подсказка: first second third");
  });

  it("prompt at exactly 140 cp → not truncated", () => {
    const exact = "x".repeat(CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH);
    expect(
      chatTemplateTileAriaLabel({
        title: "T",
        prompt: exact,
        lang: "ru",
      }),
    ).toBe("T. Подсказка: " + exact);
  });

  it("prompt with surrogate pairs → counted by codepoint", () => {
    const emoji = "🙂".repeat(CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH + 10);
    const out = chatTemplateTileAriaLabel({
      title: "T",
      prompt: emoji,
      lang: "ru",
    });
    // Last char should be a single ellipsis, not a broken surrogate
    expect(out.endsWith("…")).toBe(true);
    expect(out.indexOf("\uD83D\uDE42…")).toBeGreaterThan(0); // intact 🙂…
  });

  it("title trimmed (leading/trailing whitespace dropped)", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "  Сравнить  ",
        prompt: "Тест",
        lang: "ru",
      }),
    ).toBe("Сравнить. Подсказка: Тест");
  });

  it("unknown lang → falls back to RU copy", () => {
    expect(
      chatTemplateTileAriaLabel({
        title: "T",
        prompt: "P",
        // @ts-expect-error — exercising defensive runtime path
        lang: "en",
      }),
    ).toBe("T. Подсказка: P");
  });

  it("CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH is 140", () => {
    expect(CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH).toBe(140);
  });
});
