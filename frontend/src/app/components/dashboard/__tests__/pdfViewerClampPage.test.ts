/**
 * v4.22 (2026-05-08) — `clampPageToBook` unit tests.
 *
 * Closes hunt-backlog item L3: pre-v4.22 the PDF viewer appended
 * `#page=9999` verbatim, which the reader silently ignored.
 * Post-v4.22 the helper clamps to `book.total_pages` when set.
 *
 * Pure helper → no React render → no DOM — fastest possible
 * contract pin for this behavior. Playwright coverage lives in
 * `frontend/tests/domain-flows.spec.ts` (end-to-end deep-link
 * behavior with the real iframe src).
 */

import { describe, expect, it } from "vitest";
import { clampPageToBook } from "../PdfViewerPage";

describe("clampPageToBook", () => {
  it("returns undefined when page is undefined (no ?page= param)", () => {
    expect(clampPageToBook(undefined, 220)).toBeUndefined();
    expect(clampPageToBook(undefined, undefined)).toBeUndefined();
  });

  it("passes the page through when total_pages is unknown", () => {
    // Books without a known page count shouldn't force a clamp —
    // fall back to the old behavior and let the PDF viewer handle
    // out-of-range fragments on its own.
    expect(clampPageToBook(41, undefined)).toBe(41);
    expect(clampPageToBook(9999, undefined)).toBe(9999);
  });

  it("passes the page through when it's within bounds", () => {
    expect(clampPageToBook(1, 220)).toBe(1);
    expect(clampPageToBook(41, 220)).toBe(41);
    expect(clampPageToBook(220, 220)).toBe(220);
  });

  it("clamps an out-of-range page to total_pages (L3 primary case)", () => {
    expect(clampPageToBook(221, 220)).toBe(220);
    expect(clampPageToBook(9999, 220)).toBe(220);
    expect(clampPageToBook(Number.MAX_SAFE_INTEGER, 220)).toBe(220);
  });

  it("treats zero or negative total_pages as unknown", () => {
    // Defensive against backend rows that forgot to populate
    // `total_pages`. Falls back to the old behavior.
    expect(clampPageToBook(9999, 0)).toBe(9999);
    expect(clampPageToBook(9999, -5)).toBe(9999);
  });
});
