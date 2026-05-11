/**
 * s35 wave 40 (F6 picker, 2026-04-28) — pure helpers for the
 * "Cite a specific page" picker.
 *
 * The picker UI lets the student select (book, page) and emits a
 * fenced `samga.cite` JSON envelope (see `citeAPage.ts` for the
 * envelope contract — landed s33 / f1a3b36). This module owns the
 * picker's INPUT STATE coercion + validation, kept entirely pure so
 * the React surface stays a thin renderer and the rules are pinned
 * in vitest without any DOM.
 *
 * Boss brief from roadmap row F6: "Cite a page picker that injects
 * a structured consult_library hint". The student already knows the
 * textbook + page they want grounded — no need to type natural
 * language and pray the agent picks the right book. F6 wave 1
 * (s33) shipped the envelope; this wave closes the picker.
 */

import { findBookByName, type CitePageHint } from "./citeAPage";
import type { BookRef } from "./citations";

/** Tighter cap on a "reasonable" page number. Real textbook PDFs
 *  in the Samga library top out around 700 pages (Geometry-11
 *  Tierney is the longest at ~720). 9999 is the absolute ceiling
 *  to defend against fat-finger 5-digit inputs. */
export const CITE_PICKER_MAX_PAGE = 9999;

/** How many books to show in the search dropdown at most. Keeps
 *  the popover bounded on mobile. */
export const CITE_PICKER_MAX_RESULTS = 12;

export interface CitePagePickerCoerce {
  /** True iff the input parses to a strictly positive integer
   *  within [1, max]. */
  valid: boolean;
  /** Coerced numeric value when `valid`; null otherwise. */
  value: number | null;
}

/** Pure helper — coerce a free-form page-input string (digits only,
 *  may have leading/trailing whitespace) into a validated number.
 *  Defends against: NaN, +/- prefixes, decimals, scientific notation,
 *  values above the configured cap, and the empty string.
 */
export function coercePagePickerInput(args: {
  raw: string | number | null | undefined;
  max?: number;
}): CitePagePickerCoerce {
  const max = args.max && args.max > 0 ? args.max : CITE_PICKER_MAX_PAGE;
  if (args.raw == null) return { valid: false, value: null };
  let s: string;
  if (typeof args.raw === "number") {
    if (!Number.isFinite(args.raw)) return { valid: false, value: null };
    s = String(args.raw);
  } else {
    s = String(args.raw);
  }
  const trimmed = s.trim();
  if (trimmed.length === 0) return { valid: false, value: null };
  // Strict digit-only match — no minus, no plus, no decimal, no e.
  if (!/^\d+$/.test(trimmed)) return { valid: false, value: null };
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, value: null };
  if (n > max) return { valid: false, value: null };
  return { valid: true, value: n };
}

export type CitePagePickerError =
  | "no-book"
  | "book-not-in-library"
  | "bad-page";

export interface CitePagePickerValidation {
  ok: boolean;
  hint: CitePageHint | null;
  error: CitePagePickerError | null;
}

/** Pure helper — given a (bookId, pageRaw) pair from the picker,
 *  resolve to a valid `CitePageHint` or return a structured error
 *  token. The book MUST exist in the supplied catalog so a stale
 *  client doesn't inject a hint pointing at a deleted book id.
 */
export function validateCitePagePicker(args: {
  bookId: number | null;
  pageRaw: string | number | null;
  books: readonly BookRef[];
  maxPage?: number;
}): CitePagePickerValidation {
  const { bookId, pageRaw, books, maxPage } = args;
  if (bookId == null || !Number.isFinite(bookId) || bookId <= 0) {
    return { ok: false, hint: null, error: "no-book" };
  }
  const inLibrary = books.some((b) => b.id === bookId);
  if (!inLibrary) {
    return { ok: false, hint: null, error: "book-not-in-library" };
  }
  const page = coercePagePickerInput({ raw: pageRaw, max: maxPage });
  if (!page.valid || page.value == null) {
    return { ok: false, hint: null, error: "bad-page" };
  }
  const matched = books.find((b) => b.id === bookId);
  return {
    ok: true,
    hint: {
      bookId,
      pageNumber: page.value,
      ...(matched?.title ? { bookName: matched.title } : {}),
    },
    error: null,
  };
}

/** Pure helper — produce a single-line label for a book in the
 *  picker's dropdown row. Format:
 *    "<title> · <subject>, <grade>-кл." (RU)
 *    "<title> · <subject>, <grade>-сын." (KZ)
 *  Subject + grade are dropped silently when missing.
 */
export function formatBookOptionLabel(
  book: BookRef,
  lang: "ru" | "kz",
): string {
  if (!book) return "";
  const title = (book.title || "").trim();
  if (!title) return "";
  const parts: string[] = [];
  if (book.subject && book.subject.trim().length > 0) {
    parts.push(book.subject.trim());
  }
  if (
    typeof book.grade === "number" &&
    Number.isFinite(book.grade) &&
    book.grade > 0
  ) {
    parts.push(`${book.grade}-${lang === "kz" ? "сын." : "кл."}`);
  }
  if (parts.length === 0) return title;
  return `${title} · ${parts.join(", ")}`;
}

/** Pure helper — filter the catalog by a free-form search query
 *  (substring match on title, subject, and "<grade>-кл" / "<grade>-сын"
 *  shorthand). Empty / whitespace query returns the full catalog.
 *  Capped at CITE_PICKER_MAX_RESULTS to bound the popover height.
 */
export function filterBooksForPicker(args: {
  books: readonly BookRef[];
  query: string;
  lang: "ru" | "kz";
  max?: number;
}): BookRef[] {
  const { books, query, lang } = args;
  const cap = args.max && args.max > 0 ? args.max : CITE_PICKER_MAX_RESULTS;
  if (!Array.isArray(books) || books.length === 0) return [];
  const q = (query || "").trim().toLowerCase();
  if (!q) return books.slice(0, cap);
  const out: BookRef[] = [];
  for (const b of books) {
    const title = (b.title || "").toLowerCase();
    const subject = (b.subject || "").toLowerCase();
    const gradeShort =
      typeof b.grade === "number" && Number.isFinite(b.grade)
        ? `${b.grade}-${lang === "kz" ? "сын" : "кл"}`
        : "";
    if (
      title.includes(q) ||
      subject.includes(q) ||
      (gradeShort && gradeShort.includes(q))
    ) {
      out.push(b);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/** Pure helper — RU/KZ inline error text for the picker. Keep one
 *  source of truth so the modal doesn't drift between i18n keys
 *  and the helper's contract. */
export function citePagePickerErrorText(
  err: CitePagePickerError,
  lang: "ru" | "kz",
): string {
  if (lang === "kz") {
    switch (err) {
      case "no-book":
        return "Оқулықты таңдаңыз";
      case "book-not-in-library":
        return "Оқулық кітапханада табылмады";
      case "bad-page":
        return "Бет нөмірі дұрыс емес";
    }
  }
  switch (err) {
    case "no-book":
      return "Выберите учебник";
    case "book-not-in-library":
      return "Учебник не найден в библиотеке";
    case "bad-page":
      return "Неверный номер страницы";
  }
}

// Re-export for convenience.
export { findBookByName };
