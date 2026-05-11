import { describe, it, expect } from "vitest";
import {
  onboardingDialogAriaLabel,
  onboardingSkipAriaLabel,
  onboardingAdvanceAriaLabel,
} from "../onboardingTourAria";

describe("onboardingDialogAriaLabel (s35 wave 27b)", () => {
  it("RU step 2 of 5", () => {
    expect(onboardingDialogAriaLabel({ step: 2, total: 5, lang: "ru" })).toBe(
      "Вступительный обзор, шаг 2 из 5",
    );
  });

  it("KZ step 2 of 5", () => {
    expect(onboardingDialogAriaLabel({ step: 2, total: 5, lang: "kz" })).toBe(
      "Кіріспе шолу, 2-қадам, барлығы 5",
    );
  });

  it("step > total clamps to total", () => {
    expect(onboardingDialogAriaLabel({ step: 99, total: 5, lang: "ru" })).toBe(
      "Вступительный обзор, шаг 5 из 5",
    );
  });

  it("zero/negative/null/NaN/Infinity step → step 1", () => {
    for (const s of [
      0,
      -3,
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(onboardingDialogAriaLabel({ step: s, total: 5, lang: "ru" })).toBe(
        "Вступительный обзор, шаг 1 из 5",
      );
    }
  });

  it("zero/null total → 1", () => {
    expect(onboardingDialogAriaLabel({ step: 1, total: 0, lang: "ru" })).toBe(
      "Вступительный обзор, шаг 1 из 1",
    );
    expect(
      onboardingDialogAriaLabel({ step: 1, total: null, lang: "ru" }),
    ).toBe("Вступительный обзор, шаг 1 из 1");
  });

  it("fractional step floors", () => {
    expect(onboardingDialogAriaLabel({ step: 2.7, total: 5, lang: "ru" })).toBe(
      "Вступительный обзор, шаг 2 из 5",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      onboardingDialogAriaLabel({ step: 1, total: 3, lang: "en" }),
    ).toBe("Вступительный обзор, шаг 1 из 3");
  });
});

describe("onboardingSkipAriaLabel (s35 wave 27b)", () => {
  it("RU consequence-aware", () => {
    expect(onboardingSkipAriaLabel("ru")).toBe(
      "Пропустить вступление — больше не показывать",
    );
  });

  it("KZ consequence-aware", () => {
    expect(onboardingSkipAriaLabel("kz")).toBe(
      "Кіріспені өткізіп жіберу — қайтадан көрсетпеу",
    );
  });

  it("unknown lang → RU fallback", () => {
    // @ts-expect-error — runtime guard
    expect(onboardingSkipAriaLabel("en")).toBe(
      "Пропустить вступление — больше не показывать",
    );
  });

  it("idempotent across calls", () => {
    expect(onboardingSkipAriaLabel("ru")).toBe(onboardingSkipAriaLabel("ru"));
    expect(onboardingSkipAriaLabel("kz")).toBe(onboardingSkipAriaLabel("kz"));
  });
});

describe("onboardingAdvanceAriaLabel (s35 wave 27b)", () => {
  it("RU intermediate step → 'Перейти к шагу N из T'", () => {
    expect(onboardingAdvanceAriaLabel({ step: 2, total: 5, lang: "ru" })).toBe(
      "Перейти к шагу 3 из 5",
    );
  });

  it("RU last step → finish-consequence", () => {
    expect(onboardingAdvanceAriaLabel({ step: 5, total: 5, lang: "ru" })).toBe(
      "Завершить вступление и начать чат",
    );
  });

  it("KZ intermediate step", () => {
    expect(onboardingAdvanceAriaLabel({ step: 1, total: 4, lang: "kz" })).toBe(
      "Келесі қадамға өту: 2-қадам, барлығы 4",
    );
  });

  it("KZ last step → finish-consequence", () => {
    expect(onboardingAdvanceAriaLabel({ step: 4, total: 4, lang: "kz" })).toBe(
      "Кіріспені аяқтау және чатты бастау",
    );
  });

  it("step > total → finish-consequence (treated as last)", () => {
    expect(onboardingAdvanceAriaLabel({ step: 99, total: 5, lang: "ru" })).toBe(
      "Завершить вступление и начать чат",
    );
  });

  it("step 1 of 1 → finish", () => {
    expect(onboardingAdvanceAriaLabel({ step: 1, total: 1, lang: "ru" })).toBe(
      "Завершить вступление и начать чат",
    );
  });

  it("null/NaN inputs → defensive step 1", () => {
    expect(
      onboardingAdvanceAriaLabel({
        step: null,
        total: 5,
        lang: "ru",
      }),
    ).toBe("Перейти к шагу 2 из 5");
    expect(
      onboardingAdvanceAriaLabel({
        step: Number.NaN,
        total: 3,
        lang: "ru",
      }),
    ).toBe("Перейти к шагу 2 из 3");
  });

  it("multi-call purity", () => {
    const a1 = onboardingAdvanceAriaLabel({
      step: 2,
      total: 5,
      lang: "ru",
    });
    onboardingAdvanceAriaLabel({ step: 5, total: 5, lang: "kz" });
    const a2 = onboardingAdvanceAriaLabel({
      step: 2,
      total: 5,
      lang: "ru",
    });
    expect(a1).toBe(a2);
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      onboardingAdvanceAriaLabel({ step: 1, total: 3, lang: "en" }),
    ).toBe("Перейти к шагу 2 из 3");
  });
});
