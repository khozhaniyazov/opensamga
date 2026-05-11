import { describe, it, expect } from "vitest";
import {
  toolCallRowAriaLabel,
  toolCallIterationHeaderAriaLabel,
} from "../toolCallRowAria";

describe("toolCallRowAriaLabel — RU happy paths", () => {
  it("collapsed, done, with duration + args", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "Поиск в библиотеке",
        status: "done",
        durationLabel: "412 мс",
        argSummary: "query=электролиз",
        lang: "ru",
      }),
    ).toBe(
      "Развернуть инструмент: Поиск в библиотеке, готово, 412 мс — query=электролиз",
    );
  });

  it("collapsed, running, no duration, no args", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "Подбор вузов",
        status: "running",
        durationLabel: "",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент: Подбор вузов, выполняется");
  });

  it("expanded, error, with duration, no args", () => {
    expect(
      toolCallRowAriaLabel({
        open: true,
        toolLabel: "Шанс на грант",
        status: "error",
        durationLabel: "1.2s",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Свернуть инструмент: Шанс на грант, ошибка, 1.2s");
  });

  it("missing toolLabel falls back to bare verb", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "",
        status: "done",
        durationLabel: "",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент, готово");
  });
});

describe("toolCallRowAriaLabel — KZ", () => {
  it("collapsed, done", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "Кітапханадан іздеу",
        status: "done",
        durationLabel: "412 мс",
        argSummary: "query=электролиз",
        lang: "kz",
      }),
    ).toBe("Құралды ашу: Кітапханадан іздеу, дайын, 412 мс — query=электролиз");
  });

  it("expanded, running, no args", () => {
    expect(
      toolCallRowAriaLabel({
        open: true,
        toolLabel: "Грант мүмкіндігі",
        status: "running",
        durationLabel: "",
        argSummary: "",
        lang: "kz",
      }),
    ).toBe("Құралды жасыру: Грант мүмкіндігі, орындалуда");
  });

  it("expanded, error, with args", () => {
    expect(
      toolCallRowAriaLabel({
        open: true,
        toolLabel: "Жоғары оқу орны деректері",
        status: "error",
        durationLabel: "1.2s",
        argSummary: "id=123",
        lang: "kz",
      }),
    ).toBe("Құралды жасыру: Жоғары оқу орны деректері, қате, 1.2s — id=123");
  });
});

describe("toolCallRowAriaLabel — defensive", () => {
  it("non-string toolLabel coerces to empty → bare verb", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: 42,
        status: "done",
        durationLabel: "",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент, готово");
  });

  it("non-string durationLabel coerced to empty", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "X",
        status: "done",
        durationLabel: 412,
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент: X, готово");
  });

  it("trims whitespace on toolLabel + args", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "  X  ",
        status: "done",
        durationLabel: "",
        argSummary: "  k=v  ",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент: X, готово — k=v");
  });

  it("unknown status defaults to done", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "X",
        status: "weird",
        durationLabel: "",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент: X, готово");
  });

  it("non-boolean open → falsy → collapsed", () => {
    expect(
      toolCallRowAriaLabel({
        open: "true",
        toolLabel: "X",
        status: "done",
        durationLabel: "",
        argSummary: "",
        lang: "ru",
      }),
    ).toBe("Развернуть инструмент: X, готово");
  });

  it("unrecognized lang → ru", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "X",
        status: "done",
        durationLabel: "",
        argSummary: "",
        lang: "en",
      }),
    ).toBe("Развернуть инструмент: X, готово");
  });

  it("null lang → ru", () => {
    expect(
      toolCallRowAriaLabel({
        open: false,
        toolLabel: "X",
        status: "done",
        durationLabel: "",
        argSummary: "",
        lang: null,
      }),
    ).toBe("Развернуть инструмент: X, готово");
  });

  it("purity: same input same output", () => {
    const a = toolCallRowAriaLabel({
      open: false,
      toolLabel: "X",
      status: "done",
      durationLabel: "1s",
      argSummary: "k=v",
      lang: "ru",
    });
    toolCallRowAriaLabel({
      open: true,
      toolLabel: "Y",
      status: "running",
      durationLabel: "",
      argSummary: "",
      lang: "kz",
    });
    const b = toolCallRowAriaLabel({
      open: false,
      toolLabel: "X",
      status: "done",
      durationLabel: "1s",
      argSummary: "k=v",
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});

describe("toolCallIterationHeaderAriaLabel — RU pluralisation", () => {
  it("step 1, 1 tool → singular", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 1,
        lang: "ru",
      }),
    ).toBe("Шаг 1, 1 инструмент");
  });

  it("step 2, 2 tools → paucal + parallel suffix", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 2,
        toolCount: 2,
        lang: "ru",
      }),
    ).toBe("Шаг 2, 2 инструмента, выполняются параллельно");
  });

  it("step 3, 3 tools → paucal", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 3,
        toolCount: 3,
        lang: "ru",
      }),
    ).toBe("Шаг 3, 3 инструмента, выполняются параллельно");
  });

  it("step 1, 5 tools → genitive plural", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 5,
        lang: "ru",
      }),
    ).toBe("Шаг 1, 5 инструментов, выполняются параллельно");
  });

  it("step 1, 11 tools → teens → genitive", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 11,
        lang: "ru",
      }),
    ).toBe("Шаг 1, 11 инструментов, выполняются параллельно");
  });

  it("step 1, 21 tools → singular (units rule)", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 21,
        lang: "ru",
      }),
    ).toBe("Шаг 1, 21 инструмент");
  });

  it("step 1, 0 tools → bare step", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 0,
        lang: "ru",
      }),
    ).toBe("Шаг 1");
  });

  it("missing iteration → bare 'Шаг'", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 0,
        toolCount: 2,
        lang: "ru",
      }),
    ).toBe("Шаг, 2 инструмента, выполняются параллельно");
  });
});

describe("toolCallIterationHeaderAriaLabel — KZ", () => {
  it("step 1, 1 tool", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 1,
        lang: "kz",
      }),
    ).toBe("1-қадам, 1 құрал");
  });

  it("step 2, 3 tools — parallel suffix", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 2,
        toolCount: 3,
        lang: "kz",
      }),
    ).toBe("2-қадам, 3 құрал, қатар орындалуда");
  });

  it("step 1, 0 tools", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 0,
        lang: "kz",
      }),
    ).toBe("1-қадам");
  });
});

describe("toolCallIterationHeaderAriaLabel — defensive", () => {
  it("non-numeric iteration → 0 → bare", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: "two",
        toolCount: 2,
        lang: "ru",
      }),
    ).toBe("Шаг, 2 инструмента, выполняются параллельно");
  });

  it("negative count → 0", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: -3,
        lang: "ru",
      }),
    ).toBe("Шаг 1");
  });

  it("fractional iteration → floor", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 2.7,
        toolCount: 1,
        lang: "ru",
      }),
    ).toBe("Шаг 2, 1 инструмент");
  });

  it("unrecognized lang → ru", () => {
    expect(
      toolCallIterationHeaderAriaLabel({
        iteration: 1,
        toolCount: 1,
        lang: "en",
      }),
    ).toBe("Шаг 1, 1 инструмент");
  });

  it("purity", () => {
    const a = toolCallIterationHeaderAriaLabel({
      iteration: 1,
      toolCount: 5,
      lang: "ru",
    });
    toolCallIterationHeaderAriaLabel({
      iteration: 99,
      toolCount: 99,
      lang: "kz",
    });
    const b = toolCallIterationHeaderAriaLabel({
      iteration: 1,
      toolCount: 5,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
