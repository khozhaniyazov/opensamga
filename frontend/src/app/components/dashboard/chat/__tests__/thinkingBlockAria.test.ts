import { describe, it, expect } from "vitest";
import { thinkingBlockToggleAriaLabel } from "../thinkingBlockAria";

describe("thinkingBlockToggleAriaLabel — RU happy paths", () => {
  it("collapsed, post-run", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Процесс размышлений · 3694 знаков",
        lang: "ru",
      }),
    ).toBe(
      "Развернуть внутренние мысли модели: Процесс размышлений · 3694 знаков",
    );
  });

  it("collapsed, streaming → 'текущие'", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: true,
        headerText: "Думает… · 1.2s · 200 знаков",
        lang: "ru",
      }),
    ).toBe(
      "Развернуть текущие внутренние мысли модели: Думает… · 1.2s · 200 знаков",
    );
  });

  it("expanded, post-run", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: true,
        isStreaming: false,
        headerText: "Процесс размышлений · 100 знаков",
        lang: "ru",
      }),
    ).toBe(
      "Свернуть внутренние мысли модели: Процесс размышлений · 100 знаков",
    );
  });

  it("expanded streaming → expanded verb has no streaming adjective", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: true,
        isStreaming: true,
        headerText: "Думает…",
        lang: "ru",
      }),
    ).toBe("Свернуть внутренние мысли модели: Думает…");
  });

  it("collapsed empty header → bare verb", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "",
        lang: "ru",
      }),
    ).toBe("Развернуть внутренние мысли модели");
  });
});

describe("thinkingBlockToggleAriaLabel — KZ", () => {
  it("collapsed", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Ойлау процесі · 100 таңба",
        lang: "kz",
      }),
    ).toBe("Ішкі ойларды ашу: Ойлау процесі · 100 таңба");
  });

  it("collapsed streaming", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: true,
        headerText: "Ойлап жатыр…",
        lang: "kz",
      }),
    ).toBe("Ағымдағы ішкі ойларды ашу: Ойлап жатыр…");
  });

  it("expanded KZ", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: true,
        isStreaming: false,
        headerText: "Ойлау процесі",
        lang: "kz",
      }),
    ).toBe("Ішкі ойларды жасыру: Ойлау процесі");
  });

  it("KZ empty header → bare verb", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "",
        lang: "kz",
      }),
    ).toBe("Ішкі ойларды ашу");
  });
});

describe("thinkingBlockToggleAriaLabel — defensive", () => {
  it("non-string header", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: null,
        lang: "ru",
      }),
    ).toBe("Развернуть внутренние мысли модели");
  });

  it("trims header whitespace", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "   Процесс   ",
        lang: "ru",
      }),
    ).toBe("Развернуть внутренние мысли модели: Процесс");
  });

  it("non-boolean → falsy → collapsed", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: "true",
        isStreaming: 1,
        headerText: "Процесс",
        lang: "ru",
      }),
    ).toBe("Развернуть внутренние мысли модели: Процесс");
  });

  it("unrecognized lang → ru", () => {
    expect(
      thinkingBlockToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Процесс",
        lang: "en",
      }),
    ).toBe("Развернуть внутренние мысли модели: Процесс");
  });

  it("purity: same input same output", () => {
    const a = thinkingBlockToggleAriaLabel({
      open: true,
      isStreaming: false,
      headerText: "Процесс",
      lang: "ru",
    });
    thinkingBlockToggleAriaLabel({
      open: false,
      isStreaming: true,
      headerText: "Other",
      lang: "kz",
    });
    const b = thinkingBlockToggleAriaLabel({
      open: true,
      isStreaming: false,
      headerText: "Процесс",
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
