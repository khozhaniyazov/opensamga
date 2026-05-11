/**
 * v3.10 (F2, 2026-04-30) — vitest pins for attachCitationToComposer.
 * Pure helpers, no DOM.
 */

import { describe, expect, it } from "vitest";
import {
  attachButtonAriaLabel,
  attachButtonLabel,
  attachCitationPromptPrefix,
  buildCitationSeed,
} from "../attachCitationToComposer";
import { CITE_HINT_FENCE, hasCiteHint } from "../citeAPage";

describe("attachCitationPromptPrefix", () => {
  it("RU prefix mentions опираясь", () => {
    expect(attachCitationPromptPrefix("ru")).toContain("Опираясь");
  });
  it("KZ prefix mentions сүйеніп", () => {
    expect(attachCitationPromptPrefix("kz")).toContain("сүйеніп");
  });
  it("unknown lang treated as RU", () => {
    expect(attachCitationPromptPrefix("en")).toBe(
      attachCitationPromptPrefix("ru"),
    );
    expect(attachCitationPromptPrefix(null)).toBe(
      attachCitationPromptPrefix("ru"),
    );
  });
  it("ends in trailing space so the user can keep typing", () => {
    expect(attachCitationPromptPrefix("ru").endsWith(" ")).toBe(true);
    expect(attachCitationPromptPrefix("kz").endsWith(" ")).toBe(true);
  });
});

describe("buildCitationSeed", () => {
  it("happy path → samga.cite envelope + prefix", () => {
    const seed = buildCitationSeed({
      bookId: 21,
      pageNumber: 142,
      bookName: "Algebra 9 (Tierney)",
      lang: "ru",
    });
    expect(seed).not.toBeNull();
    expect(seed!).toContain("```" + CITE_HINT_FENCE);
    expect(seed!).toContain('"book_id":21');
    expect(seed!).toContain('"page_number":142');
    expect(seed!).toContain("Algebra 9 (Tierney)");
    expect(seed!).toContain("Опираясь");
  });

  it("seed is recognised by hasCiteHint", () => {
    const seed = buildCitationSeed({
      bookId: 7,
      pageNumber: 5,
      lang: "kz",
    });
    expect(seed).not.toBeNull();
    expect(hasCiteHint(seed!)).toBe(true);
  });

  it("no bookName → envelope still valid (book_name omitted)", () => {
    const seed = buildCitationSeed({
      bookId: 7,
      pageNumber: 5,
      lang: "ru",
    });
    expect(seed).not.toBeNull();
    expect(seed!).toContain('"book_id":7');
    expect(seed!).not.toContain("book_name");
  });

  it("null bookId → null", () => {
    expect(buildCitationSeed({ bookId: null, pageNumber: 5 })).toBeNull();
  });

  it("null pageNumber → null", () => {
    expect(buildCitationSeed({ bookId: 7, pageNumber: null })).toBeNull();
  });

  it("non-positive bookId → null", () => {
    expect(buildCitationSeed({ bookId: 0, pageNumber: 5 })).toBeNull();
    expect(buildCitationSeed({ bookId: -3, pageNumber: 5 })).toBeNull();
  });

  it("non-positive pageNumber → null", () => {
    expect(buildCitationSeed({ bookId: 7, pageNumber: 0 })).toBeNull();
    expect(buildCitationSeed({ bookId: 7, pageNumber: -1 })).toBeNull();
  });

  it("non-integer values → null", () => {
    expect(buildCitationSeed({ bookId: 7.5, pageNumber: 5 })).toBeNull();
    expect(buildCitationSeed({ bookId: 7, pageNumber: 5.2 })).toBeNull();
  });

  it("KZ prefix used when lang=kz", () => {
    const seed = buildCitationSeed({ bookId: 1, pageNumber: 1, lang: "kz" });
    expect(seed).toContain("сүйеніп");
  });

  it("unknown lang → RU prefix", () => {
    const seed = buildCitationSeed({ bookId: 1, pageNumber: 1, lang: "xx" });
    expect(seed).toContain("Опираясь");
  });

  it("non-string bookName → omitted", () => {
    const seed = buildCitationSeed({
      bookId: 1,
      pageNumber: 1,
      bookName: 42 as unknown as string,
    });
    expect(seed!).not.toContain("book_name");
  });

  it("whitespace-only bookName → omitted", () => {
    const seed = buildCitationSeed({
      bookId: 1,
      pageNumber: 1,
      bookName: "   ",
    });
    expect(seed!).not.toContain("book_name");
  });
});

describe("attachButtonAriaLabel", () => {
  it("resolved + book + page → consequence-aware RU", () => {
    const label = attachButtonAriaLabel({
      bookName: "Algebra 9",
      pageNumber: 47,
      resolved: true,
      lang: "ru",
    });
    expect(label).toContain("Algebra 9");
    expect(label).toContain("47");
    expect(label).toContain("следующему");
  });

  it("resolved + book + page → consequence-aware KZ", () => {
    const label = attachButtonAriaLabel({
      bookName: "Алгебра 9",
      pageNumber: 47,
      resolved: true,
      lang: "kz",
    });
    expect(label).toContain("Алгебра 9");
    expect(label).toContain("47");
    expect(label).toContain("келесі");
  });

  it("not resolved → label explains why (RU)", () => {
    const label = attachButtonAriaLabel({
      bookName: "Mystery Book",
      pageNumber: 10,
      resolved: false,
      lang: "ru",
    });
    expect(label).toContain("Невозможно");
    expect(label).toContain("Mystery Book");
  });

  it("not resolved → label explains why (KZ)", () => {
    const label = attachButtonAriaLabel({
      bookName: "Жұмбақ",
      pageNumber: 10,
      resolved: false,
      lang: "kz",
    });
    expect(label).toContain("Тіркеу мүмкін емес");
  });

  it("missing bookName falls back to bilingual placeholder", () => {
    const labelRu = attachButtonAriaLabel({
      bookName: "",
      pageNumber: 10,
      resolved: true,
      lang: "ru",
    });
    expect(labelRu).toContain("(без названия)");
    const labelKz = attachButtonAriaLabel({
      bookName: null,
      pageNumber: 10,
      resolved: true,
      lang: "kz",
    });
    expect(labelKz).toContain("(атаусыз)");
  });

  it("non-string bookName → placeholder", () => {
    const label = attachButtonAriaLabel({
      bookName: 42,
      pageNumber: 10,
      resolved: true,
      lang: "ru",
    });
    expect(label).toContain("(без названия)");
  });

  it("non-finite pageNumber → drops the page count", () => {
    const label = attachButtonAriaLabel({
      bookName: "Book",
      pageNumber: NaN,
      resolved: true,
      lang: "ru",
    });
    expect(label).toContain("Book");
    expect(label).not.toContain("страница");
  });

  it("float page number floored", () => {
    const label = attachButtonAriaLabel({
      bookName: "Book",
      pageNumber: 47.9,
      resolved: true,
      lang: "ru",
    });
    expect(label).toContain("47");
  });

  it("negative page number clamped to 1", () => {
    const label = attachButtonAriaLabel({
      bookName: "Book",
      pageNumber: -3,
      resolved: true,
      lang: "ru",
    });
    expect(label).toContain("страница 1");
  });
});

describe("attachButtonLabel", () => {
  it("RU short label", () => {
    expect(attachButtonLabel("ru")).toBe("Прикрепить как контекст");
  });
  it("KZ short label", () => {
    expect(attachButtonLabel("kz")).toBe("Контекстке тіркеу");
  });
  it("unknown lang → RU", () => {
    expect(attachButtonLabel("en")).toBe(attachButtonLabel("ru"));
  });
});

describe("purity", () => {
  it("buildCitationSeed is pure", () => {
    const args = { bookId: 7, pageNumber: 5, lang: "ru" };
    const a = buildCitationSeed(args);
    const b = buildCitationSeed(args);
    expect(a).toBe(b);
  });
});
