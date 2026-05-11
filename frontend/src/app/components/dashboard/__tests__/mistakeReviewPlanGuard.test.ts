/**
 * v3.66 (2026-05-02) — `MistakeReviewPage` PlanGuard wrapping pin.
 *
 * Backstory: B8 in the 2026-05-02 E2E report. /dashboard/mistakes
 * for a free-tier user fired three /mistakes/* calls
 * (`/trends`, `/list`, `/recommendations`) on mount and printed three
 * `403` console errors before falling back to "Не удалось загрузить…".
 * The other gated pages (`/dashboard/exams`, `/dashboard/training`,
 * `/dashboard/gap-analysis`) gate at the page level via `<PlanGuard
 * feature="...">`, so no requests fly and free-tier users see the
 * unified upgrade splash.
 *
 * v3.66 wraps `MistakeReviewPage` in `<PlanGuard feature="mistakes">`,
 * mirroring `MistakesPage` (the older /mistakes page) and the other
 * gated routes.
 *
 * Rendering MistakeReviewPage in vitest pulls react-router + recharts
 * + 1000 lines of chart code — overkill for a wrapper-presence pin.
 * We use the same static-source pattern as v3.65.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../MistakeReviewPage.tsx");

function loadSource(): string {
  return readFileSync(SRC, "utf-8");
}

describe("MistakeReviewPage PlanGuard wrapping (v3.66)", () => {
  it("MistakeReviewPage.tsx still exists at its expected path", () => {
    expect(loadSource()).toContain("export function MistakeReviewPage");
  });

  it("imports PlanGuard from the billing module", () => {
    const src = loadSource();
    // The import path is the same one MistakesPage.tsx (the legacy
    // page) uses. Pinning the literal path catches re-organisations.
    expect(src).toMatch(
      /import\s+\{\s*PlanGuard\s*\}\s+from\s+["']\.\.\/billing\/PlanGuard["']/,
    );
  });

  it("the exported MistakeReviewPage wraps its content in <PlanGuard feature='mistakes'>", () => {
    const src = loadSource();
    // Match the export body up through the closing brace. We pin the
    // outer component to be a thin shell that renders <PlanGuard
    // feature="mistakes">…</PlanGuard>. We allow either single or
    // double quotes around the prop value, and any whitespace.
    const exportBlock = src.match(
      /export function MistakeReviewPage\(\)\s*\{[\s\S]*?\n\}/,
    );
    expect(
      exportBlock,
      "expected an exported MistakeReviewPage function",
    ).not.toBeNull();
    const body = exportBlock?.[0] ?? "";
    expect(body).toMatch(/<PlanGuard\s+feature=("|')mistakes\1\s*>/);
    expect(body).toMatch(/<\/PlanGuard>/);
  });

  it("the inner MistakeReviewContent function still exists (renamed export shape)", () => {
    // The previous MistakeReviewPage held the entire body. v3.66
    // moved everything past `useDocumentTitle` into a new
    // MistakeReviewContent function. The export shell forwards into
    // it. If anyone renames the inner function or inlines it back
    // into the export, the wrapper indirection breaks and 403 noise
    // returns.
    expect(loadSource()).toMatch(/function MistakeReviewContent\(/);
  });
});
