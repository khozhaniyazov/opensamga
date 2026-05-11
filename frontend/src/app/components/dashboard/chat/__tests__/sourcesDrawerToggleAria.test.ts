import { describe, it, expect } from "vitest";
import { sourcesDrawerToggleAria } from "../sourcesDrawerToggleAria";

describe("sourcesDrawerToggleAria (s35 wave 27c)", () => {
  it("RU closed, 1 source → singular", () => {
    expect(sourcesDrawerToggleAria({ count: 1, open: false, lang: "ru" })).toBe(
      "Раскрыть список источников, 1 источник",
    );
  });

  it("RU closed, 2 sources → paucal", () => {
    expect(sourcesDrawerToggleAria({ count: 2, open: false, lang: "ru" })).toBe(
      "Раскрыть список источников, 2 источника",
    );
  });

  it("RU closed, 4 sources → paucal", () => {
    expect(sourcesDrawerToggleAria({ count: 4, open: false, lang: "ru" })).toBe(
      "Раскрыть список источников, 4 источника",
    );
  });

  it("RU closed, 5 sources → genitive plural", () => {
    expect(sourcesDrawerToggleAria({ count: 5, open: false, lang: "ru" })).toBe(
      "Раскрыть список источников, 5 источников",
    );
  });

  it("RU closed, 11 sources → teen rule", () => {
    expect(
      sourcesDrawerToggleAria({ count: 11, open: false, lang: "ru" }),
    ).toBe("Раскрыть список источников, 11 источников");
  });

  it("RU closed, 21 sources → singular per units rule", () => {
    expect(
      sourcesDrawerToggleAria({ count: 21, open: false, lang: "ru" }),
    ).toBe("Раскрыть список источников, 21 источник");
  });

  it("RU closed, 22 sources → paucal per units rule", () => {
    expect(
      sourcesDrawerToggleAria({ count: 22, open: false, lang: "ru" }),
    ).toBe("Раскрыть список источников, 22 источника");
  });

  it("RU open, 5 sources → close-verb head + count", () => {
    expect(sourcesDrawerToggleAria({ count: 5, open: true, lang: "ru" })).toBe(
      "Скрыть список источников, 5 источников",
    );
  });

  it("KZ closed, 5 sources → uninflected", () => {
    expect(sourcesDrawerToggleAria({ count: 5, open: false, lang: "kz" })).toBe(
      "Дереккөздер тізімін ашу, 5 дереккөз",
    );
  });

  it("KZ open, 1 source → close-verb head", () => {
    expect(sourcesDrawerToggleAria({ count: 1, open: true, lang: "kz" })).toBe(
      "Дереккөздер тізімін жасыру, 1 дереккөз",
    );
  });

  it("count 0 → bare verb (RU)", () => {
    expect(sourcesDrawerToggleAria({ count: 0, open: false, lang: "ru" })).toBe(
      "Раскрыть список источников",
    );
    expect(sourcesDrawerToggleAria({ count: 0, open: true, lang: "ru" })).toBe(
      "Скрыть список источников",
    );
  });

  it("count 0 → bare verb (KZ)", () => {
    expect(sourcesDrawerToggleAria({ count: 0, open: false, lang: "kz" })).toBe(
      "Дереккөздер тізімін ашу",
    );
  });

  it("null/NaN/Infinity/negative/float → coerced", () => {
    for (const c of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -3,
    ]) {
      expect(
        sourcesDrawerToggleAria({ count: c, open: false, lang: "ru" }),
      ).toBe("Раскрыть список источников");
    }
    expect(
      sourcesDrawerToggleAria({ count: 2.9, open: false, lang: "ru" }),
    ).toBe("Раскрыть список источников, 2 источника");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      sourcesDrawerToggleAria({ count: 3, open: false, lang: "en" }),
    ).toBe("Раскрыть список источников, 3 источника");
  });

  it("multi-call purity", () => {
    const a1 = sourcesDrawerToggleAria({
      count: 5,
      open: false,
      lang: "ru",
    });
    sourcesDrawerToggleAria({ count: 1, open: true, lang: "kz" });
    const a2 = sourcesDrawerToggleAria({
      count: 5,
      open: false,
      lang: "ru",
    });
    expect(a1).toBe(a2);
  });

  it("RU and KZ outputs differ when count > 0", () => {
    expect(
      sourcesDrawerToggleAria({ count: 5, open: false, lang: "ru" }),
    ).not.toBe(sourcesDrawerToggleAria({ count: 5, open: false, lang: "kz" }));
  });

  it("verb head always present", () => {
    for (const c of [0, 1, 5]) {
      expect(
        sourcesDrawerToggleAria({ count: c, open: false, lang: "ru" }),
      ).toMatch(/Раскрыть список/);
      expect(
        sourcesDrawerToggleAria({ count: c, open: true, lang: "ru" }),
      ).toMatch(/Скрыть список/);
    }
  });
});
