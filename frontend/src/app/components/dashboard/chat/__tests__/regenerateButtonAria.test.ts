/**
 * s35 wave 19b — vitest pins for `regenerateButtonAria`.
 */

import { describe, it, expect } from "vitest";
import { regenerateButtonAria } from "../regenerateButtonAria";

describe("regenerateButtonAria", () => {
  it("enabled RU → bare label", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: "Перегенерировать",
        lang: "ru",
      }),
    ).toBe("Перегенерировать");
  });

  it("enabled KZ → bare label", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: "Қайталау",
        lang: "kz",
      }),
    ).toBe("Қайталау");
  });

  it("enabled with null override → RU fallback 'Перегенерировать'", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: null,
        lang: "ru",
      }),
    ).toBe("Перегенерировать");
  });

  it("enabled with null override → KZ fallback 'Қайталау'", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: null,
        lang: "kz",
      }),
    ).toBe("Қайталау");
  });

  it("enabled with whitespace override → falls back", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: "   \t  ",
        lang: "ru",
      }),
    ).toBe("Перегенерировать");
  });

  it("enabled with empty override → falls back", () => {
    expect(
      regenerateButtonAria({ canRegen: true, enabledLabel: "", lang: "ru" }),
    ).toBe("Перегенерировать");
  });

  it("enabled override trimmed", () => {
    expect(
      regenerateButtonAria({
        canRegen: true,
        enabledLabel: "  Regenerate  ",
        lang: "ru",
      }),
    ).toBe("Regenerate");
  });

  it("disabled RU → '<base> (доступно только для последнего ответа)'", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: "Перегенерировать",
        lang: "ru",
      }),
    ).toBe("Перегенерировать (доступно только для последнего ответа)");
  });

  it("disabled KZ → '<base> (тек соңғы жауап үшін қолжетімді)'", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: "Қайталау",
        lang: "kz",
      }),
    ).toBe("Қайталау (тек соңғы жауап үшін қолжетімді)");
  });

  it("disabled with null override → fallback + reason (RU)", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: null,
        lang: "ru",
      }),
    ).toBe("Перегенерировать (доступно только для последнего ответа)");
  });

  it("disabled with null override → fallback + reason (KZ)", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: null,
        lang: "kz",
      }),
    ).toBe("Қайталау (тек соңғы жауап үшін қолжетімді)");
  });

  it("unknown lang → RU fallback applies for both base and reason", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: null,
        // @ts-expect-error — runtime guard
        lang: "en",
      }),
    ).toBe("Перегенерировать (доступно только для последнего ответа)");
  });

  it("custom override survives the disabled wrapper", () => {
    expect(
      regenerateButtonAria({
        canRegen: false,
        enabledLabel: "Try again",
        lang: "ru",
      }),
    ).toBe("Try again (доступно только для последнего ответа)");
  });

  it("enabled and disabled produce different strings", () => {
    const enabled = regenerateButtonAria({
      canRegen: true,
      enabledLabel: "X",
      lang: "ru",
    });
    const disabled = regenerateButtonAria({
      canRegen: false,
      enabledLabel: "X",
      lang: "ru",
    });
    expect(enabled).not.toBe(disabled);
    expect(disabled.startsWith(enabled)).toBe(true);
  });

  it("enabled label that already contains parentheses is not double-wrapped", () => {
    // The helper appends a parenthesized reason only on disabled.
    const out = regenerateButtonAria({
      canRegen: true,
      enabledLabel: "Regenerate (last)",
      lang: "ru",
    });
    expect(out).toBe("Regenerate (last)");
  });
});
