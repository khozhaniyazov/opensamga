/**
 * s35 wave 38 (2026-04-28) — vitest pin tests for `errorRetryAria`.
 * Pure helpers, no DOM.
 */

import { describe, expect, it } from "vitest";
import { errorRetryAriaLabel, errorRetryButtonLabel } from "../errorRetryAria";

describe("errorRetryAriaLabel — RU happy path", () => {
  it("short prompt", () => {
    expect(
      errorRetryAriaLabel({ retryPrompt: "Hello world", lang: "ru" }),
    ).toBe("Повторить запрос — отправить «Hello world» заново");
  });

  it("Cyrillic prompt with special chars", () => {
    expect(
      errorRetryAriaLabel({
        retryPrompt: "Объясни мне закон Архимеда",
        lang: "ru",
      }),
    ).toBe("Повторить запрос — отправить «Объясни мне закон Архимеда» заново");
  });
});

describe("errorRetryAriaLabel — KZ happy path", () => {
  it("short prompt", () => {
    expect(
      errorRetryAriaLabel({
        retryPrompt: "Архимед заңын түсіндір",
        lang: "kz",
      }),
    ).toBe("Сұранысты қайталау — «Архимед заңын түсіндір» қайта жіберу");
  });
});

describe("errorRetryAriaLabel — degradations", () => {
  it("empty prompt → bare verb (RU)", () => {
    expect(errorRetryAriaLabel({ retryPrompt: "", lang: "ru" })).toBe(
      "Повторить запрос",
    );
  });

  it("whitespace-only prompt → bare verb", () => {
    expect(errorRetryAriaLabel({ retryPrompt: "   \n  \t ", lang: "ru" })).toBe(
      "Повторить запрос",
    );
  });

  it("null prompt → bare verb", () => {
    expect(errorRetryAriaLabel({ retryPrompt: null, lang: "ru" })).toBe(
      "Повторить запрос",
    );
  });

  it("undefined prompt → bare verb", () => {
    expect(errorRetryAriaLabel({ retryPrompt: undefined, lang: "kz" })).toBe(
      "Сұранысты қайталау",
    );
  });

  it("non-string prompt → bare verb", () => {
    expect(errorRetryAriaLabel({ retryPrompt: 42, lang: "ru" })).toBe(
      "Повторить запрос",
    );
    expect(errorRetryAriaLabel({ retryPrompt: {}, lang: "ru" })).toBe(
      "Повторить запрос",
    );
  });
});

describe("errorRetryAriaLabel — truncation", () => {
  it("truncates long prompts to 80 chars + ellipsis", () => {
    const longPrompt = "a".repeat(200);
    const out = errorRetryAriaLabel({ retryPrompt: longPrompt, lang: "ru" });
    expect(out).toMatch(/^Повторить запрос — отправить «a{80}…» заново$/);
  });

  it("no truncation for ≤80 char prompts", () => {
    const exact = "a".repeat(80);
    expect(errorRetryAriaLabel({ retryPrompt: exact, lang: "ru" })).toBe(
      `Повторить запрос — отправить «${exact}» заново`,
    );
  });

  it("collapses internal whitespace runs to single space", () => {
    expect(
      errorRetryAriaLabel({
        retryPrompt: "Hello\n\n   world\t\tthere",
        lang: "ru",
      }),
    ).toBe("Повторить запрос — отправить «Hello world there» заново");
  });

  it("trims leading/trailing whitespace before measuring", () => {
    expect(
      errorRetryAriaLabel({
        retryPrompt: "   short prompt   ",
        lang: "ru",
      }),
    ).toBe("Повторить запрос — отправить «short prompt» заново");
  });
});

describe("errorRetryAriaLabel — defensive", () => {
  it("unknown lang → ru", () => {
    expect(errorRetryAriaLabel({ retryPrompt: "Hi", lang: "fr" })).toBe(
      "Повторить запрос — отправить «Hi» заново",
    );
  });

  it("null lang → ru", () => {
    expect(errorRetryAriaLabel({ retryPrompt: "Hi", lang: null })).toBe(
      "Повторить запрос — отправить «Hi» заново",
    );
  });
});

describe("errorRetryAriaLabel — purity", () => {
  it("same input → same output", () => {
    const a = errorRetryAriaLabel({ retryPrompt: "Hi", lang: "ru" });
    errorRetryAriaLabel({ retryPrompt: "Bye", lang: "kz" });
    const b = errorRetryAriaLabel({ retryPrompt: "Hi", lang: "ru" });
    expect(a).toBe(b);
  });
});

describe("errorRetryButtonLabel — visible chrome", () => {
  it("RU bare verb", () => {
    expect(errorRetryButtonLabel("ru")).toBe("Повторить запрос");
  });
  it("KZ bare verb", () => {
    expect(errorRetryButtonLabel("kz")).toBe("Сұранысты қайталау");
  });
  it("unknown → ru fallback", () => {
    expect(errorRetryButtonLabel("fr")).toBe("Повторить запрос");
  });
});
