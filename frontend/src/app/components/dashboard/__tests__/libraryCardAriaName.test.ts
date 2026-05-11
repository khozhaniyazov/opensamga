/**
 * v3.67 (2026-05-02) — library card accessible-name guard.
 *
 * Backstory: B9 in the 2026-05-02 E2E report. Every library card
 * is wrapped in a single `<a href="/dashboard/library/books/N">`
 * with no aria-label, so the screen reader concatenates the whole
 * descendant tree:
 *
 *   "Физика208 стр.Physics 7physics_7.pdfSamga SourceЗащищенный
 *    просмотр PDF"
 *
 * The fix adds an `aria-label` to the Link wrapper composed from
 * the book's title, subject label, grade, and page count. Bilingual.
 *
 * We use the static-source pattern (same as v3.65 / v3.66) instead
 * of rendering LibraryPage in vitest. LibraryPage pulls
 * react-router + a 700-line render tree; the fix is a one-line
 * `aria-label={...}` on a <Link>, which the regex below pins.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../LibraryPage.tsx");

function loadSource(): string {
  return readFileSync(SRC, "utf-8");
}

describe("library card accessible-name guard (v3.67)", () => {
  it("LibraryPage.tsx still defines BookCard at its expected path", () => {
    expect(loadSource()).toContain("function BookCard(");
  });

  it("BookCard's <Link> wrapper carries an aria-label", () => {
    const src = loadSource();
    // Scope to the BookCard function body so we don't accidentally
    // match an aria-label on some other Link in the file.
    const body = src.match(/function BookCard\([\s\S]*?\n\}/);
    expect(body, "expected BookCard to still exist").not.toBeNull();
    const fn = body?.[0] ?? "";
    // The Link must carry aria-label. We deliberately don't pin the
    // exact label expression — copy can change. Substring match on
    // the attribute name is the load-bearing assertion.
    expect(fn).toMatch(/<Link\b[\s\S]*?aria-label=/);
  });

  it("BookCard composes the aria-label from title + subject + grade + pages, bilingual", () => {
    const src = loadSource();
    const body = src.match(/function BookCard\([\s\S]*?\n\}/);
    const fn = body?.[0] ?? "";
    // RU and KZ branches must both compose from book.title.
    expect(fn).toMatch(/book\.title/);
    // Grade + page-count fields must appear in the label expression.
    expect(fn).toMatch(/book\.grade/);
    expect(fn).toMatch(/book\.total_pages/);
    // Bilingual unit copy survives.
    expect(fn).toMatch(/класс/);
    expect(fn).toMatch(/сынып/);
    expect(fn).toMatch(/страниц/);
    expect(fn).toMatch(/бет/);
  });

  it("BookCard's thumbnail <img> uses alt='' so it doesn't double-announce the title", () => {
    const src = loadSource();
    const body = src.match(/function BookCard\([\s\S]*?\n\}/);
    const fn = body?.[0] ?? "";
    // Decorative thumbnails MUST stay alt="" because the Link's
    // aria-label already names the book. If someone accidentally
    // adds alt={book.title}, the screen reader announces the title
    // twice. Pin the empty alt as a regression guard.
    expect(fn).toMatch(/alt=("|')\1/);
  });
});
