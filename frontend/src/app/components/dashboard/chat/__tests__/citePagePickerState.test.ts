/**
 * s35 wave 40 — vitest pins for the cite-a-page picker state helpers.
 */

import { describe, expect, it } from "vitest";
import {
  CITE_PICKER_MAX_PAGE,
  CITE_PICKER_MAX_RESULTS,
  citePagePickerErrorText,
  coercePagePickerInput,
  filterBooksForPicker,
  formatBookOptionLabel,
  validateCitePagePicker,
} from "../citePagePickerState";
import type { BookRef } from "../citations";

const SAMPLE: BookRef[] = [
  { id: 12, title: "Algebra-9 (Tierney)", subject: "Math", grade: 9 },
  { id: 13, title: "Geometry-11 Tierney", subject: "Math", grade: 11 },
  { id: 21, title: "Physics-10 Tierney", subject: "Physics", grade: 10 },
  { id: 22, title: "Chemistry-11 Manchester", subject: "Chemistry", grade: 11 },
];

describe("constants", () => {
  it("CITE_PICKER_MAX_PAGE is the 9999 ceiling", () => {
    expect(CITE_PICKER_MAX_PAGE).toBe(9999);
  });
  it("CITE_PICKER_MAX_RESULTS is 12", () => {
    expect(CITE_PICKER_MAX_RESULTS).toBe(12);
  });
});

describe("coercePagePickerInput", () => {
  it("accepts a clean digit string", () => {
    expect(coercePagePickerInput({ raw: "47" })).toEqual({
      valid: true,
      value: 47,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(coercePagePickerInput({ raw: "  12  " })).toEqual({
      valid: true,
      value: 12,
    });
  });

  it("accepts a finite positive integer number", () => {
    expect(coercePagePickerInput({ raw: 5 })).toEqual({
      valid: true,
      value: 5,
    });
  });

  it("rejects empty / whitespace-only input", () => {
    expect(coercePagePickerInput({ raw: "" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "   " }).valid).toBe(false);
  });

  it("rejects null / undefined", () => {
    expect(coercePagePickerInput({ raw: null }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: undefined }).valid).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(coercePagePickerInput({ raw: NaN }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: Infinity }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: -Infinity }).valid).toBe(false);
  });

  it("rejects zero / negatives", () => {
    expect(coercePagePickerInput({ raw: "0" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "-5" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: -5 }).valid).toBe(false);
  });

  it("rejects floats / scientific notation", () => {
    expect(coercePagePickerInput({ raw: "3.5" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "1e3" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: 3.5 }).valid).toBe(false);
  });

  it("rejects values above the cap", () => {
    expect(coercePagePickerInput({ raw: "10000" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "12345" }).valid).toBe(false);
  });

  it("accepts the cap exactly", () => {
    expect(
      coercePagePickerInput({ raw: String(CITE_PICKER_MAX_PAGE) }),
    ).toEqual({
      valid: true,
      value: CITE_PICKER_MAX_PAGE,
    });
  });

  it("honours a custom max", () => {
    expect(coercePagePickerInput({ raw: "150", max: 100 }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "100", max: 100 }).valid).toBe(true);
  });

  it("rejects mixed garbage", () => {
    expect(coercePagePickerInput({ raw: "12abc" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "abc" }).valid).toBe(false);
    expect(coercePagePickerInput({ raw: "+47" }).valid).toBe(false);
  });
});

describe("validateCitePagePicker", () => {
  it("ok on a real (id, page) pair", () => {
    const out = validateCitePagePicker({
      bookId: 12,
      pageRaw: "47",
      books: SAMPLE,
    });
    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(out.hint).toEqual({
      bookId: 12,
      pageNumber: 47,
      bookName: "Algebra-9 (Tierney)",
    });
  });

  it("returns no-book when bookId is null / 0 / NaN", () => {
    expect(
      validateCitePagePicker({ bookId: null, pageRaw: "1", books: SAMPLE })
        .error,
    ).toBe("no-book");
    expect(
      validateCitePagePicker({ bookId: 0, pageRaw: "1", books: SAMPLE }).error,
    ).toBe("no-book");
    expect(
      validateCitePagePicker({ bookId: NaN, pageRaw: "1", books: SAMPLE })
        .error,
    ).toBe("no-book");
  });

  it("returns book-not-in-library when id is not in catalog", () => {
    expect(
      validateCitePagePicker({ bookId: 999, pageRaw: "1", books: SAMPLE })
        .error,
    ).toBe("book-not-in-library");
  });

  it("returns bad-page on invalid page input", () => {
    expect(
      validateCitePagePicker({ bookId: 12, pageRaw: "0", books: SAMPLE }).error,
    ).toBe("bad-page");
    expect(
      validateCitePagePicker({ bookId: 12, pageRaw: "abc", books: SAMPLE })
        .error,
    ).toBe("bad-page");
    expect(
      validateCitePagePicker({ bookId: 12, pageRaw: "", books: SAMPLE }).error,
    ).toBe("bad-page");
  });

  it("never throws on an empty catalog", () => {
    expect(
      validateCitePagePicker({ bookId: 12, pageRaw: "1", books: [] }).error,
    ).toBe("book-not-in-library");
  });
});

describe("formatBookOptionLabel", () => {
  it("formats RU with subject + grade", () => {
    expect(formatBookOptionLabel(SAMPLE[0], "ru")).toBe(
      "Algebra-9 (Tierney) · Math, 9-кл.",
    );
  });

  it("formats KZ with subject + grade", () => {
    expect(formatBookOptionLabel(SAMPLE[2], "kz")).toBe(
      "Physics-10 Tierney · Physics, 10-сын.",
    );
  });

  it("drops missing subject/grade gracefully", () => {
    expect(formatBookOptionLabel({ id: 1, title: "Standalone" }, "ru")).toBe(
      "Standalone",
    );
  });

  it("returns empty string on a falsy book / empty title", () => {
    expect(formatBookOptionLabel(undefined as unknown as BookRef, "ru")).toBe(
      "",
    );
    expect(formatBookOptionLabel({ id: 1, title: "" } as BookRef, "ru")).toBe(
      "",
    );
    expect(
      formatBookOptionLabel({ id: 1, title: "   " } as BookRef, "ru"),
    ).toBe("");
  });
});

describe("filterBooksForPicker", () => {
  it("returns all books (capped) for empty query", () => {
    expect(
      filterBooksForPicker({ books: SAMPLE, query: "", lang: "ru" }).length,
    ).toBe(SAMPLE.length);
  });

  it("substring-matches title", () => {
    expect(
      filterBooksForPicker({
        books: SAMPLE,
        query: "algebra",
        lang: "ru",
      }).map((b) => b.id),
    ).toEqual([12]);
  });

  it("substring-matches subject", () => {
    expect(
      filterBooksForPicker({
        books: SAMPLE,
        query: "physics",
        lang: "ru",
      }).map((b) => b.id),
    ).toEqual([21]);
  });

  it("matches grade shorthand (RU)", () => {
    expect(
      filterBooksForPicker({
        books: SAMPLE,
        query: "11-кл",
        lang: "ru",
      })
        .map((b) => b.id)
        .sort(),
    ).toEqual([13, 22]);
  });

  it("matches grade shorthand (KZ)", () => {
    expect(
      filterBooksForPicker({
        books: SAMPLE,
        query: "11-сын",
        lang: "kz",
      })
        .map((b) => b.id)
        .sort(),
    ).toEqual([13, 22]);
  });

  it("respects the cap", () => {
    const big: BookRef[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      title: `Book ${i + 1}`,
    }));
    expect(
      filterBooksForPicker({ books: big, query: "", lang: "ru" }).length,
    ).toBe(CITE_PICKER_MAX_RESULTS);
    expect(
      filterBooksForPicker({ books: big, query: "", lang: "ru", max: 5 })
        .length,
    ).toBe(5);
  });

  it("returns an empty array on non-array input", () => {
    expect(
      filterBooksForPicker({
        books: null as unknown as readonly BookRef[],
        query: "",
        lang: "ru",
      }),
    ).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(
      filterBooksForPicker({
        books: SAMPLE,
        query: "ALGEBRA",
        lang: "ru",
      }).map((b) => b.id),
    ).toEqual([12]);
  });
});

describe("citePagePickerErrorText", () => {
  it("RU strings", () => {
    expect(citePagePickerErrorText("no-book", "ru")).toBe("Выберите учебник");
    expect(citePagePickerErrorText("book-not-in-library", "ru")).toBe(
      "Учебник не найден в библиотеке",
    );
    expect(citePagePickerErrorText("bad-page", "ru")).toBe(
      "Неверный номер страницы",
    );
  });

  it("KZ strings", () => {
    expect(citePagePickerErrorText("no-book", "kz")).toBe("Оқулықты таңдаңыз");
    expect(citePagePickerErrorText("book-not-in-library", "kz")).toBe(
      "Оқулық кітапханада табылмады",
    );
    expect(citePagePickerErrorText("bad-page", "kz")).toBe(
      "Бет нөмірі дұрыс емес",
    );
  });
});

describe("purity", () => {
  it("does not mutate input book array", () => {
    const arr = SAMPLE.slice();
    const before = JSON.stringify(arr);
    filterBooksForPicker({ books: arr, query: "physics", lang: "ru" });
    validateCitePagePicker({ bookId: 12, pageRaw: "1", books: arr });
    expect(JSON.stringify(arr)).toBe(before);
  });
});
