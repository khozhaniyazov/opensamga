import { describe, it, expect } from "vitest";
import { threadRailToggleAria } from "../threadRailToggleAria";

describe("threadRailToggleAria (s35 wave 25a)", () => {
  it("RU closed, no threads → bare opener", () => {
    expect(
      threadRailToggleAria({ threadCount: 0, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов");
  });

  it("RU closed, 1 thread → singular", () => {
    expect(
      threadRailToggleAria({ threadCount: 1, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 1 беседа");
  });

  it("RU closed, 2 threads → paucal", () => {
    expect(
      threadRailToggleAria({ threadCount: 2, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 2 беседы");
  });

  it("RU closed, 4 threads → paucal", () => {
    expect(
      threadRailToggleAria({ threadCount: 4, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 4 беседы");
  });

  it("RU closed, 5 threads → genitive plural", () => {
    expect(
      threadRailToggleAria({ threadCount: 5, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 5 бесед");
  });

  it("RU closed, 11 threads → teen rule → genitive plural", () => {
    expect(
      threadRailToggleAria({ threadCount: 11, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 11 бесед");
  });

  it("RU closed, 12 threads → teen rule still genitive", () => {
    expect(
      threadRailToggleAria({ threadCount: 12, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 12 бесед");
  });

  it("RU closed, 14 threads → teen rule still genitive", () => {
    expect(
      threadRailToggleAria({ threadCount: 14, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 14 бесед");
  });

  it("RU closed, 21 threads → singular (units rule)", () => {
    expect(
      threadRailToggleAria({ threadCount: 21, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 21 беседа");
  });

  it("RU closed, 22 threads → paucal (units rule)", () => {
    expect(
      threadRailToggleAria({ threadCount: 22, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 22 беседы");
  });

  it("RU closed, 100 threads → genitive plural", () => {
    expect(
      threadRailToggleAria({ threadCount: 100, open: false, lang: "ru" }),
    ).toBe("Открыть список чатов, 100 бесед");
  });

  it("RU open → close verb without count, regardless of count", () => {
    for (const c of [0, 1, 2, 5, 21, 99]) {
      expect(
        threadRailToggleAria({ threadCount: c, open: true, lang: "ru" }),
      ).toBe("Закрыть список чатов");
    }
  });

  it("KZ closed, 0 threads → bare opener", () => {
    expect(
      threadRailToggleAria({ threadCount: 0, open: false, lang: "kz" }),
    ).toBe("Чаттар тізімін ашу");
  });

  it("KZ closed, N threads → uninflected appendix", () => {
    for (const c of [1, 2, 5, 11, 21]) {
      expect(
        threadRailToggleAria({ threadCount: c, open: false, lang: "kz" }),
      ).toBe(`Чаттар тізімін ашу, ${c} сұхбат`);
    }
  });

  it("KZ open → uninflected close verb without count", () => {
    expect(
      threadRailToggleAria({ threadCount: 5, open: true, lang: "kz" }),
    ).toBe("Чаттар тізімін жабу");
  });

  it("null/NaN/Infinity/negative/float coerced to integer count", () => {
    expect(
      threadRailToggleAria({
        threadCount: null,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов");
    expect(
      threadRailToggleAria({
        threadCount: undefined,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов");
    expect(
      threadRailToggleAria({
        threadCount: Number.NaN,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов");
    expect(
      threadRailToggleAria({
        threadCount: -3,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов");
    expect(
      threadRailToggleAria({
        threadCount: Number.POSITIVE_INFINITY,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов");
    expect(
      threadRailToggleAria({
        threadCount: 2.9,
        open: false,
        lang: "ru",
      }),
    ).toBe("Открыть список чатов, 2 беседы");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      threadRailToggleAria({ threadCount: 3, open: false, lang: "en" }),
    ).toBe(threadRailToggleAria({ threadCount: 3, open: false, lang: "ru" }));
  });

  it("RU and KZ outputs differ when count>0", () => {
    expect(
      threadRailToggleAria({ threadCount: 3, open: false, lang: "ru" }),
    ).not.toBe(
      threadRailToggleAria({ threadCount: 3, open: false, lang: "kz" }),
    );
  });

  it("multi-call purity", () => {
    const a1 = threadRailToggleAria({
      threadCount: 5,
      open: false,
      lang: "ru",
    });
    const b = threadRailToggleAria({
      threadCount: 1,
      open: true,
      lang: "kz",
    });
    const a2 = threadRailToggleAria({
      threadCount: 5,
      open: false,
      lang: "ru",
    });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
