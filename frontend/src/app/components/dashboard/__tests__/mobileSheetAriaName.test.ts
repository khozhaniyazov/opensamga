/**
 * v3.65 (2026-05-02) — accessible-name guard for the mobile sidebar
 * drawer (DashboardLayout's lg:hidden fixed dialog).
 *
 * Backstory: B5 in the 2026-05-02 E2E report. On a 390x844 viewport,
 * the header's "Открыть меню" button opens a `<div role="dialog"
 * aria-modal="true">` that lacked both `aria-label` and
 * `aria-labelledby`. Screen readers announced "dialog" with no
 * context, and axe-core would have flagged this if the page were in
 * the public Playwright suite (the modal is rendered conditionally,
 * so the axe lane never sees it open).
 *
 * The fix is a one-liner inside DashboardLayout (add aria-label).
 * Rendering DashboardLayout in vitest pulls in react-router +
 * AuthContext + LanguageProvider + 600 lines of cross-cutting state,
 * which is overkill for "did anyone delete the aria-label?".
 *
 * Instead, we read DashboardLayout.tsx as a string and assert on the
 * source — a tiny static regression guard. If the file is renamed or
 * the dialog is moved to a different module, the test fails fast
 * pointing the next maintainer at the right place. This mirrors the
 * pattern used by `test_v37_alembic_baseline::test_alembic_drift_check_is_wired_into_lifespan`
 * on the backend side.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../DashboardLayout.tsx");

function loadDashboardLayoutSource(): string {
  return readFileSync(SRC, "utf-8");
}

describe("mobile sidebar drawer aria-name guard (v3.65)", () => {
  it("DashboardLayout.tsx still exists at its expected path", () => {
    // If this fails, the layout was renamed and the next assertions
    // need their path updated. Better to fail explicitly here than to
    // chase a `readFileSync` ENOENT.
    expect(loadDashboardLayoutSource()).toMatch(/lg:hidden/);
  });

  it("the role=dialog drawer carries an accessible name (aria-label or aria-labelledby)", () => {
    const src = loadDashboardLayoutSource();
    // Find the "lg:hidden fixed inset-0 z-40" wrapper that's the
    // mobile sidebar dialog. We scope our regex to the immediately
    // adjacent attributes so we don't accidentally match an aria-label
    // on the inner aside.
    const dialogBlock = src.match(
      /<div[^>]*\blg:hidden\b[^>]*\bz-40\b[^>]*>[\s\S]*?>/,
    );
    expect(
      dialogBlock,
      "expected DashboardLayout to keep the mobile-drawer wrapper div",
    ).not.toBeNull();
    // The match contains every attribute on the opening tag. The
    // accessible-name assertion is satisfied by EITHER of:
    //   aria-label="..."   (plain or template-literal value)
    //   aria-labelledby="..."
    const opening = dialogBlock?.[0] ?? "";
    expect(opening).toMatch(/role=("|')dialog\1/);
    expect(opening).toMatch(/aria-modal=/);
    const hasName =
      /aria-label=/.test(opening) || /aria-labelledby=/.test(opening);
    expect(
      hasName,
      "Mobile sidebar dialog must carry aria-label or aria-labelledby. " +
        "B5 in the 2026-05-02 E2E report flagged this as a nameless modal.",
    ).toBe(true);
  });

  it("retains the bilingual copy for the drawer name (regression guard)", () => {
    const src = loadDashboardLayoutSource();
    // The drawer's accessible name was already used as the inner
    // <aside>'s aria-label. Pinning both halves means a future copy
    // refactor can't accidentally drop one of the languages.
    expect(src).toMatch(/Мобильное боковое меню/);
    expect(src).toMatch(/Мобильді бүйір мәзірі/);
  });
});
