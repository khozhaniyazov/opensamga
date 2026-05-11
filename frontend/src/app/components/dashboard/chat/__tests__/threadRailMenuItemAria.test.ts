import { describe, it, expect } from "vitest";
import { threadRailMenuItemAriaLabel } from "../threadRailMenuItemAria";

describe("threadRailMenuItemAriaLabel — RU action coverage", () => {
  const title = "Подготовка к ЕНТ — март";

  it("pin", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "pin", title, lang: "ru" }),
    ).toBe("Закрепить «Подготовка к ЕНТ — март» в начале списка");
  });

  it("unpin", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "unpin", title, lang: "ru" }),
    ).toBe("Открепить «Подготовка к ЕНТ — март»");
  });

  it("rename", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "rename", title, lang: "ru" }),
    ).toBe("Переименовать «Подготовка к ЕНТ — март»");
  });

  it("archive — has consequence", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "archive", title, lang: "ru" }),
    ).toBe(
      "Архивировать «Подготовка к ЕНТ — март», скрыть из активного списка",
    );
  });

  it("restore", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "restore", title, lang: "ru" }),
    ).toBe("Восстановить «Подготовка к ЕНТ — март» из архива");
  });

  it("export-markdown", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "export-markdown",
        title,
        lang: "ru",
      }),
    ).toBe("Экспортировать «Подготовка к ЕНТ — март» в Markdown");
  });

  it("export-json", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "export-json",
        title,
        lang: "ru",
      }),
    ).toBe("Экспортировать «Подготовка к ЕНТ — март» в JSON");
  });

  it("delete — irreversible cue", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "delete", title, lang: "ru" }),
    ).toBe("Удалить «Подготовка к ЕНТ — март», действие необратимо");
  });
});

describe("threadRailMenuItemAriaLabel — KZ action coverage", () => {
  const title = "ҰБТ дайындық";

  it("pin", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "pin", title, lang: "kz" }),
    ).toBe("«ҰБТ дайындық» сұхбатын тізім басына бекіту");
  });

  it("delete", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "delete", title, lang: "kz" }),
    ).toBe("«ҰБТ дайындық» сұхбатын жою, әрекет қайтарылмайды");
  });

  it("archive", () => {
    expect(
      threadRailMenuItemAriaLabel({ action: "archive", title, lang: "kz" }),
    ).toBe(
      "«ҰБТ дайындық» сұхбатын мұрағатқа жіберу, белсенді тізімнен жасырылады",
    );
  });

  it("export-markdown", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "export-markdown",
        title,
        lang: "kz",
      }),
    ).toBe("«ҰБТ дайындық» сұхбатын Markdown форматында экспорттау");
  });
});

describe("threadRailMenuItemAriaLabel — defensive", () => {
  it("missing title falls back to common noun (ru)", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "delete",
        title: "",
        lang: "ru",
      }),
    ).toBe("Удалить беседа, действие необратимо");
  });

  it("missing title falls back to common noun (kz)", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "delete",
        title: "",
        lang: "kz",
      }),
    ).toBe("сұхбат сұхбатын жою, әрекет қайтарылмайды");
  });

  it("non-string title → empty fallback", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "rename",
        title: 42,
        lang: "ru",
      }),
    ).toBe("Переименовать беседа");
  });

  it("trims whitespace on title", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "rename",
        title: "  X  ",
        lang: "ru",
      }),
    ).toBe("Переименовать «X»");
  });

  it("unknown action → empty string (caller must skip binding)", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "frobnicate",
        title: "X",
        lang: "ru",
      }),
    ).toBe("");
  });

  it("null action → empty", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: null,
        title: "X",
        lang: "ru",
      }),
    ).toBe("");
  });

  it("unknown lang → ru", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "pin",
        title: "X",
        lang: "en",
      }),
    ).toBe("Закрепить «X» в начале списка");
  });

  it("null lang → ru", () => {
    expect(
      threadRailMenuItemAriaLabel({
        action: "pin",
        title: "X",
        lang: null,
      }),
    ).toBe("Закрепить «X» в начале списка");
  });

  it("purity: same input same output", () => {
    const a = threadRailMenuItemAriaLabel({
      action: "delete",
      title: "X",
      lang: "ru",
    });
    threadRailMenuItemAriaLabel({
      action: "rename",
      title: "Y",
      lang: "kz",
    });
    const b = threadRailMenuItemAriaLabel({
      action: "delete",
      title: "X",
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
