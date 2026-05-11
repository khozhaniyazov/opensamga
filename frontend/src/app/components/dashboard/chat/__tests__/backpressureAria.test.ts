import { describe, it, expect } from "vitest";
import {
  backpressureAriaLabel,
  backpressureVisibleLabel,
} from "../backpressureAria";

describe("backpressureVisibleLabel (s35 wave 25e)", () => {
  it("RU returns the existing visible-label string", () => {
    expect(backpressureVisibleLabel("ru")).toBe("Сеть медленная — догоняем…");
  });

  it("KZ returns the existing visible-label string", () => {
    expect(backpressureVisibleLabel("kz")).toBe(
      "Желі баяу — жалғастырып жатырмыз…",
    );
  });

  it("unknown lang → RU fallback", () => {
    // @ts-expect-error — runtime guard
    expect(backpressureVisibleLabel("en")).toBe("Сеть медленная — догоняем…");
  });
});

describe("backpressureAriaLabel (s35 wave 25e)", () => {
  it("RU prefixes visible label and adds consequence sentence", () => {
    const out = backpressureAriaLabel("ru");
    expect(out.startsWith("Сеть медленная — догоняем…")).toBe(true);
    expect(out).toContain("Запрос продолжается, ничего делать не нужно");
    expect(out).toContain("Esc");
  });

  it("KZ prefixes visible label and adds consequence sentence", () => {
    const out = backpressureAriaLabel("kz");
    expect(out.startsWith("Желі баяу — жалғастырып жатырмыз…")).toBe(true);
    expect(out).toContain("Сұраныс жалғасуда");
    expect(out).toContain("Esc");
  });

  it("aria-label is strictly longer than visible label", () => {
    expect(backpressureAriaLabel("ru").length).toBeGreaterThan(
      backpressureVisibleLabel("ru").length,
    );
    expect(backpressureAriaLabel("kz").length).toBeGreaterThan(
      backpressureVisibleLabel("kz").length,
    );
  });

  it("RU and KZ outputs differ", () => {
    expect(backpressureAriaLabel("ru")).not.toBe(backpressureAriaLabel("kz"));
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      backpressureAriaLabel("en"),
    ).toBe(backpressureAriaLabel("ru"));
  });

  it("output always names Esc as the stop control (regression guard)", () => {
    for (const lang of ["ru", "kz"] as const) {
      expect(backpressureAriaLabel(lang)).toMatch(/Esc/);
    }
  });

  it("multi-call purity", () => {
    const a1 = backpressureAriaLabel("ru");
    backpressureAriaLabel("kz");
    const a2 = backpressureAriaLabel("ru");
    expect(a1).toBe(a2);
  });
});
