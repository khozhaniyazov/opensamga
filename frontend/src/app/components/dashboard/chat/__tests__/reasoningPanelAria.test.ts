import { describe, it, expect } from "vitest";
import { reasoningPanelToggleAriaLabel } from "../reasoningPanelAria";

describe("reasoningPanelToggleAriaLabel — RU happy paths", () => {
  it("collapsed, post-run", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Готово · 3 шага · 7 инструментов · 4.1s",
        lang: "ru",
      }),
    ).toBe(
      "Развернуть процесс рассуждений: Готово · 3 шага · 7 инструментов · 4.1s",
    );
  });

  it("collapsed, streaming → 'текущий' adjective", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: true,
        headerText: "Размышляю · 2.4s",
        lang: "ru",
      }),
    ).toBe("Развернуть текущий процесс рассуждений: Размышляю · 2.4s");
  });

  it("expanded, post-run", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: true,
        isStreaming: false,
        headerText: "Готово · 3 инструмента · 1.5s",
        lang: "ru",
      }),
    ).toBe("Свернуть процесс рассуждений: Готово · 3 инструмента · 1.5s");
  });

  it("expanded, streaming — 'текущий' adjective only on collapsed verb", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: true,
        isStreaming: true,
        headerText: "Размышляю · 2.4s",
        lang: "ru",
      }),
    ).toBe("Свернуть процесс рассуждений: Размышляю · 2.4s");
  });

  it("collapsed + empty header → bare verb", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "",
        lang: "ru",
      }),
    ).toBe("Развернуть процесс рассуждений");
  });
});

describe("reasoningPanelToggleAriaLabel — KZ", () => {
  it("collapsed", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Дайын · 3 қадам · 7 құрал · 4.1s",
        lang: "kz",
      }),
    ).toBe("Ой процесін ашу: Дайын · 3 қадам · 7 құрал · 4.1s");
  });

  it("expanded", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: true,
        isStreaming: false,
        headerText: "Дайын · 4.1s",
        lang: "kz",
      }),
    ).toBe("Ой процесін жасыру: Дайын · 4.1s");
  });

  it("KZ doesn't add 'streaming' adjective (parallel construction)", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: true,
        headerText: "Ойлап жатыр · 2.4s",
        lang: "kz",
      }),
    ).toBe("Ой процесін ашу: Ойлап жатыр · 2.4s");
  });

  it("KZ empty header → bare verb", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "",
        lang: "kz",
      }),
    ).toBe("Ой процесін ашу");
  });
});

describe("reasoningPanelToggleAriaLabel — defensive", () => {
  it("non-string header → empty → bare verb", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: 123,
        lang: "ru",
      }),
    ).toBe("Развернуть процесс рассуждений");
  });

  it("trims header whitespace", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "   Готово · 1.0s   ",
        lang: "ru",
      }),
    ).toBe("Развернуть процесс рассуждений: Готово · 1.0s");
  });

  it("non-boolean open → falsy → collapsed", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: "true",
        isStreaming: false,
        headerText: "Готово",
        lang: "ru",
      }),
    ).toBe("Развернуть процесс рассуждений: Готово");
  });

  it("non-boolean isStreaming → falsy → no adjective", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: "yes",
        headerText: "Готово",
        lang: "ru",
      }),
    ).toBe("Развернуть процесс рассуждений: Готово");
  });

  it("unrecognized lang → ru", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Готово",
        lang: "en",
      }),
    ).toBe("Развернуть процесс рассуждений: Готово");
  });

  it("null lang → ru", () => {
    expect(
      reasoningPanelToggleAriaLabel({
        open: false,
        isStreaming: false,
        headerText: "Готово",
        lang: null,
      }),
    ).toBe("Развернуть процесс рассуждений: Готово");
  });

  it("purity: same input same output", () => {
    const a = reasoningPanelToggleAriaLabel({
      open: false,
      isStreaming: false,
      headerText: "Готово",
      lang: "ru",
    });
    reasoningPanelToggleAriaLabel({
      open: true,
      isStreaming: true,
      headerText: "Other",
      lang: "kz",
    });
    const b = reasoningPanelToggleAriaLabel({
      open: false,
      isStreaming: false,
      headerText: "Готово",
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
