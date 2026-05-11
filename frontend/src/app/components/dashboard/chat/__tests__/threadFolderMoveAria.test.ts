/**
 * s35 wave 41 — vitest pins for threadFolderMoveAria.
 */

import { describe, expect, it } from "vitest";
import {
  threadFolderMoveAriaLabel,
  threadFolderMoveGroupAriaLabel,
  threadFolderMoveRowText,
} from "../threadFolderMoveAria";

describe("threadFolderMoveAriaLabel — RU", () => {
  it("move into a named folder", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "Math",
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Переместить «Алгебра 9» в папку «Math»");
  });

  it("when already filed in that folder", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "Math",
        isCurrent: true,
        lang: "ru",
      }),
    ).toBe("«Алгебра 9» уже в папке «Math»");
  });

  it("unfile (folderName empty)", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "",
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Убрать «Алгебра 9» из папки");
  });

  it("unfile when already unfiled", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: null,
        isCurrent: true,
        lang: "ru",
      }),
    ).toBe("«Алгебра 9» уже не в папке");
  });

  it("falls back to 'беседа' on empty title", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "",
        folderName: "Math",
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Переместить беседа в папку «Math»");
  });

  it("trims surrounding whitespace on title and folder", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "   Алгебра   ",
        folderName: "  Math ",
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Переместить «Алгебра» в папку «Math»");
  });
});

describe("threadFolderMoveAriaLabel — KZ", () => {
  it("move into a named folder", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "Math",
        isCurrent: false,
        lang: "kz",
      }),
    ).toBe("«Алгебра 9» сұхбатын «Math» папкасына жылжыту");
  });

  it("already in folder", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "Math",
        isCurrent: true,
        lang: "kz",
      }),
    ).toBe("«Алгебра 9» сұхбаты «Math» папкасында тұр");
  });

  it("unfile", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: "",
        isCurrent: false,
        lang: "kz",
      }),
    ).toBe("«Алгебра 9» сұхбатын папкадан шығару");
  });

  it("unfile when already unfiled", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра 9",
        folderName: null,
        isCurrent: true,
        lang: "kz",
      }),
    ).toBe("«Алгебра 9» сұхбаты қазір ешқандай папкада емес");
  });

  it("falls back to 'сұхбат' on empty title", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "   ",
        folderName: "Math",
        isCurrent: false,
        lang: "kz",
      }),
    ).toBe("сұхбат сұхбатын «Math» папкасына жылжыту");
  });
});

describe("defensive coercion", () => {
  it("non-string title falls back", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: 123,
        folderName: "Math",
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Переместить беседа в папку «Math»");
  });

  it("non-string folderName treated as unfile", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра",
        folderName: 999,
        isCurrent: false,
        lang: "ru",
      }),
    ).toBe("Убрать «Алгебра» из папки");
  });

  it("non-bool isCurrent treated as false", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра",
        folderName: "Math",
        isCurrent: "yes",
        lang: "ru",
      }),
    ).toBe("Переместить «Алгебра» в папку «Math»");
  });

  it("unknown lang falls back to RU", () => {
    expect(
      threadFolderMoveAriaLabel({
        threadTitle: "Алгебра",
        folderName: "Math",
        isCurrent: false,
        lang: "en",
      }),
    ).toBe("Переместить «Алгебра» в папку «Math»");
  });
});

describe("threadFolderMoveGroupAriaLabel", () => {
  it("RU", () => {
    expect(threadFolderMoveGroupAriaLabel("ru")).toBe("Переместить в папку");
  });

  it("KZ", () => {
    expect(threadFolderMoveGroupAriaLabel("kz")).toBe("Папкаға жылжыту");
  });

  it("unknown lang falls back to RU", () => {
    expect(threadFolderMoveGroupAriaLabel(undefined)).toBe(
      "Переместить в папку",
    );
  });
});

describe("threadFolderMoveRowText", () => {
  it("returns folder name verbatim", () => {
    expect(threadFolderMoveRowText("Math", "ru")).toBe("Math");
    expect(threadFolderMoveRowText("Биология", "kz")).toBe("Биология");
  });

  it("trims whitespace", () => {
    expect(threadFolderMoveRowText("  Math  ", "ru")).toBe("Math");
  });

  it("'Без папки' / 'Папкасыз' for empty folderName", () => {
    expect(threadFolderMoveRowText("", "ru")).toBe("Без папки");
    expect(threadFolderMoveRowText(null, "ru")).toBe("Без папки");
    expect(threadFolderMoveRowText("", "kz")).toBe("Папкасыз");
    expect(threadFolderMoveRowText(undefined, "kz")).toBe("Папкасыз");
  });

  it("non-string defaults to empty-state copy", () => {
    expect(threadFolderMoveRowText(42, "ru")).toBe("Без папки");
  });
});
