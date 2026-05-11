import { describe, it, expect } from "vitest";
import {
  citationChipLinkAriaLabel,
  citationChipMissingAriaLabel,
  citationChipPopoverDialogAriaLabel,
} from "../citationChipAria";

describe("citationChipLinkAriaLabel — RU happy paths", () => {
  it("name + page", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия 11",
        pageNumber: 42,
        lang: "ru",
      }),
    ).toBe("Открыть «Химия 11», страница 42, в новой вкладке");
  });

  it("name only — page is null/undefined", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия 11",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Открыть «Химия 11» в новой вкладке");
  });

  it("page only — empty name", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "",
        pageNumber: 42,
        lang: "ru",
      }),
    ).toBe("Открыть страницу 42 источника в новой вкладке");
  });

  it("nothing → bare verb", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Открыть источник в новой вкладке");
  });
});

describe("citationChipLinkAriaLabel — KZ", () => {
  it("name + page", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия 11",
        pageNumber: 42,
        lang: "kz",
      }),
    ).toBe("«Химия 11» дереккөзінің 42-бетін жаңа қойындыда ашу");
  });

  it("name only", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия 11",
        pageNumber: null,
        lang: "kz",
      }),
    ).toBe("«Химия 11» дереккөзін жаңа қойындыда ашу");
  });

  it("page only", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "",
        pageNumber: 7,
        lang: "kz",
      }),
    ).toBe("Дереккөздің 7-бетін жаңа қойындыда ашу");
  });

  it("nothing → bare", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "kz",
      }),
    ).toBe("Дереккөзді жаңа қойындыда ашу");
  });
});

describe("citationChipLinkAriaLabel — defensive", () => {
  it("trims whitespace on bookName", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "  Химия 11  ",
        pageNumber: 42,
        lang: "ru",
      }),
    ).toBe("Открыть «Химия 11», страница 42, в новой вкладке");
  });

  it("string page coerces to number", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: "42",
        lang: "ru",
      }),
    ).toBe("Открыть «Химия», страница 42, в новой вкладке");
  });

  it("zero/negative page → null", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: 0,
        lang: "ru",
      }),
    ).toBe("Открыть «Химия» в новой вкладке");
  });

  it("non-numeric string page → null", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: "abc",
        lang: "ru",
      }),
    ).toBe("Открыть «Химия» в новой вкладке");
  });

  it("non-string bookName → empty", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: 123,
        pageNumber: 5,
        lang: "ru",
      }),
    ).toBe("Открыть страницу 5 источника в новой вкладке");
  });

  it("unknown lang → ru", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: 5,
        lang: "en",
      }),
    ).toBe("Открыть «Химия», страница 5, в новой вкладке");
  });

  it("null lang → ru", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: 5,
        lang: null,
      }),
    ).toBe("Открыть «Химия», страница 5, в новой вкладке");
  });

  it("fractional page → floor", () => {
    expect(
      citationChipLinkAriaLabel({
        bookName: "Химия",
        pageNumber: 7.6,
        lang: "ru",
      }),
    ).toBe("Открыть «Химия», страница 7, в новой вкладке");
  });
});

describe("citationChipMissingAriaLabel — RU", () => {
  it("name + page", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "Химия 11",
        pageNumber: 42,
        lang: "ru",
      }),
    ).toBe("Источник «Химия 11», страница 42, недоступен в библиотеке");
  });

  it("name only", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "Химия 11",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Источник «Химия 11» недоступен в библиотеке");
  });

  it("nothing", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Источник недоступен в библиотеке");
  });
});

describe("citationChipMissingAriaLabel — KZ", () => {
  it("name + page", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "Химия 11",
        pageNumber: 42,
        lang: "kz",
      }),
    ).toBe("«Химия 11» дереккөзінің 42-беті кітапханада жоқ");
  });

  it("page only", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "",
        pageNumber: 8,
        lang: "kz",
      }),
    ).toBe("Дереккөздің 8-беті кітапханада жоқ");
  });

  it("nothing", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "kz",
      }),
    ).toBe("Дереккөз кітапханада жоқ");
  });
});

describe("citationChipMissingAriaLabel — defensive", () => {
  it("string page coerces", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "Х",
        pageNumber: "5",
        lang: "ru",
      }),
    ).toBe("Источник «Х», страница 5, недоступен в библиотеке");
  });

  it("non-string bookName → empty", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: 99,
        pageNumber: 5,
        lang: "ru",
      }),
    ).toBe("Страница 5 источника недоступна в библиотеке");
  });

  it("unknown lang → ru", () => {
    expect(
      citationChipMissingAriaLabel({
        bookName: "Х",
        pageNumber: 5,
        lang: "fr",
      }),
    ).toBe("Источник «Х», страница 5, недоступен в библиотеке");
  });

  it("purity", () => {
    const a = citationChipMissingAriaLabel({
      bookName: "Х",
      pageNumber: 5,
      lang: "ru",
    });
    citationChipLinkAriaLabel({
      bookName: "Y",
      pageNumber: 9,
      lang: "kz",
    });
    const b = citationChipMissingAriaLabel({
      bookName: "Х",
      pageNumber: 5,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});

describe("citationChipPopoverDialogAriaLabel — RU", () => {
  it("name + page", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "Алгебра 10",
        pageNumber: 17,
        lang: "ru",
      }),
    ).toBe("Превью источника «Алгебра 10», страница 17");
  });

  it("name only", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "Алгебра 10",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Превью источника «Алгебра 10»");
  });

  it("page only", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "",
        pageNumber: 17,
        lang: "ru",
      }),
    ).toBe("Превью страницы 17 источника");
  });

  it("nothing", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "ru",
      }),
    ).toBe("Превью источника");
  });
});

describe("citationChipPopoverDialogAriaLabel — KZ", () => {
  it("name + page", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "Алгебра 10",
        pageNumber: 17,
        lang: "kz",
      }),
    ).toBe("«Алгебра 10» дереккөзінің 17-бетінің превьюі");
  });

  it("name only", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "Алгебра 10",
        pageNumber: null,
        lang: "kz",
      }),
    ).toBe("«Алгебра 10» дереккөзінің превьюі");
  });

  it("page only", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "",
        pageNumber: 17,
        lang: "kz",
      }),
    ).toBe("Дереккөздің 17-бетінің превьюі");
  });

  it("nothing", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "",
        pageNumber: null,
        lang: "kz",
      }),
    ).toBe("Дереккөздің превьюі");
  });
});

describe("citationChipPopoverDialogAriaLabel — defensive", () => {
  it("string page coerces", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "X",
        pageNumber: "42",
        lang: "ru",
      }),
    ).toBe("Превью источника «X», страница 42");
  });

  it("non-positive page → null", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "X",
        pageNumber: 0,
        lang: "ru",
      }),
    ).toBe("Превью источника «X»");
  });

  it("trim whitespace on name", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "  X  ",
        pageNumber: 1,
        lang: "ru",
      }),
    ).toBe("Превью источника «X», страница 1");
  });

  it("unknown lang → ru", () => {
    expect(
      citationChipPopoverDialogAriaLabel({
        bookName: "X",
        pageNumber: 5,
        lang: "fr",
      }),
    ).toBe("Превью источника «X», страница 5");
  });

  it("purity", () => {
    const a = citationChipPopoverDialogAriaLabel({
      bookName: "X",
      pageNumber: 5,
      lang: "ru",
    });
    citationChipPopoverDialogAriaLabel({
      bookName: "Y",
      pageNumber: 9,
      lang: "kz",
    });
    const b = citationChipPopoverDialogAriaLabel({
      bookName: "X",
      pageNumber: 5,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
