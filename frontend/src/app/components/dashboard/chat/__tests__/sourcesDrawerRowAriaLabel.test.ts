/**
 * s35 wave 16a — vitest pins for `sourcesDrawerRowAriaLabel`.
 */

import { describe, it, expect } from "vitest";
import {
  sourcesDrawerRowAriaLabel,
  sourcesDrawerFallbackTitle,
} from "../sourcesDrawerRowAriaLabel";

describe("sourcesDrawerFallbackTitle", () => {
  it("RU: 0 → №1", () => {
    expect(sourcesDrawerFallbackTitle(0, "ru")).toBe("Источник №1");
  });
  it("KZ: 4 → №5", () => {
    expect(sourcesDrawerFallbackTitle(4, "kz")).toBe("Дереккөз №5");
  });
  it("negative index clamps to 1", () => {
    expect(sourcesDrawerFallbackTitle(-3, "ru")).toBe("Источник №1");
  });
  it("non-finite index clamps to 1", () => {
    expect(sourcesDrawerFallbackTitle(Number.NaN, "ru")).toBe("Источник №1");
  });
});

describe("sourcesDrawerRowAriaLabel", () => {
  it("RU: title + page + open-in-library trailer", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Algebra 9 (Tierney)",
      index: 0,
      pageNumber: 47,
      lang: "ru",
    });
    expect(out).toBe("Algebra 9 (Tierney), стр. 47 — Открыть в библиотеке");
  });

  it("KZ: title + page uses 'бет' + KZ trailer", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Алгебра 9 сынып",
      index: 0,
      pageNumber: 12,
      lang: "kz",
    });
    expect(out).toBe("Алгебра 9 сынып, бет 12 — Кітапханада ашу");
  });

  it("snippet present → wrapped in guillemets between page and action", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Биология 11",
      index: 0,
      pageNumber: 3,
      snippet: "митохондрия — энергетическая станция клетки",
      lang: "ru",
    });
    expect(out).toBe(
      "Биология 11, стр. 3, «митохондрия — энергетическая станция клетки» — Открыть в библиотеке",
    );
  });

  it("snippet > 80 codepoints truncates with single ellipsis", () => {
    const long = "a".repeat(120);
    const out = sourcesDrawerRowAriaLabel({
      title: "T",
      index: 0,
      pageNumber: 1,
      snippet: long,
      lang: "ru",
    });
    // Truncated to 79 chars + ellipsis = 80
    expect(out).toContain("«" + "a".repeat(79) + "…»");
    expect(out.endsWith("Открыть в библиотеке")).toBe(true);
  });

  it("snippet whitespace-only → omitted (no empty guillemets)", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "T",
      index: 0,
      pageNumber: 5,
      snippet: "   \t\n   ",
      lang: "ru",
    });
    expect(out).toBe("T, стр. 5 — Открыть в библиотеке");
  });

  it("title null + index=2 → fallback Источник №3", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: null,
      index: 2,
      pageNumber: 9,
      lang: "ru",
    });
    expect(out).toBe("Источник №3, стр. 9 — Открыть в библиотеке");
  });

  it("title whitespace-only → fallback used", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "   ",
      index: 0,
      pageNumber: 1,
      lang: "kz",
    });
    expect(out.startsWith("Дереккөз №1")).toBe(true);
  });

  it("page null → omits page clause", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: null,
      lang: "ru",
    });
    expect(out).toBe("Foo — Открыть в библиотеке");
  });

  it("page 0 → omits page clause (defensive)", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: 0,
      lang: "ru",
    });
    expect(out).toBe("Foo — Открыть в библиотеке");
  });

  it("page negative → omits page clause", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: -7,
      lang: "ru",
    });
    expect(out).toBe("Foo — Открыть в библиотеке");
  });

  it("page NaN → omits page clause", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: Number.NaN,
      lang: "ru",
    });
    expect(out).toBe("Foo — Открыть в библиотеке");
  });

  it("page 47.9 → floored to 47", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: 47.9,
      lang: "ru",
    });
    expect(out).toBe("Foo, стр. 47 — Открыть в библиотеке");
  });

  it("title trimmed (leading/trailing whitespace dropped)", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "   Алгебра  ",
      index: 0,
      pageNumber: 5,
      lang: "ru",
    });
    expect(out.startsWith("Алгебра, стр. 5")).toBe(true);
  });

  it("snippet whitespace runs collapsed to single space", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "T",
      index: 0,
      pageNumber: 1,
      snippet: "foo   bar\n\n\tbaz",
      lang: "ru",
    });
    expect(out).toContain("«foo bar baz»");
  });

  it("unknown lang falls back to RU", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Foo",
      index: 0,
      pageNumber: 1,
      // @ts-expect-error — exercising defensive runtime path
      lang: "en",
    });
    expect(out).toBe("Foo, стр. 1 — Открыть в библиотеке");
  });

  it("KZ + snippet + page composes correctly", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: "Химия 10",
      index: 0,
      pageNumber: 22,
      snippet: "галогендер тобы",
      lang: "kz",
    });
    expect(out).toBe("Химия 10, бет 22, «галогендер тобы» — Кітапханада ашу");
  });

  it("title undefined + page undefined + lang ru → fallback + no page + trailer", () => {
    const out = sourcesDrawerRowAriaLabel({
      title: undefined,
      index: 0,
      pageNumber: undefined,
      lang: "ru",
    });
    expect(out).toBe("Источник №1 — Открыть в библиотеке");
  });
});
