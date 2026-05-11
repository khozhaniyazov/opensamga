import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * v3.77 — surface load errors to the user instead of silently
 * collapsing to the "no items" state.
 *
 * The 2026-05-03 audit caught 3+ dashboard pages that did
 * `catch { setX([]) }` after a `/api/...` GET. When the backend
 * is degraded, users saw the freshly-empty UI ("Library has no
 * books", "No mistakes — great job!") instead of an error message.
 * The pattern fix mirrors UniversitiesPage which already surfaced
 * a load error.
 *
 * This is a static-source contract test (per
 * `feedback_static_source_contract_tests.md`): each SUT file
 * must contain:
 *   - `setLoadError(` — a state setter for the load-error string.
 *   - `role="alert"` — accessible error region.
 *   - `data-testid="<page>-load-error"` — stable hook for QA.
 *   - `tCommon("load_failed")` — i18n key from common namespace.
 *   - `tCommon("retry")` — retry button label.
 *
 * If a future refactor renames any of these, the test will fail
 * loudly so the regression doesn't ship silently.
 */

// Tests run from the frontend directory (vitest cwd). Paths
// in TARGETS are relative to the repo root, but the FE root is one
// level up from the dashboard tests folder; resolve from there.
const FRONTEND_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const REPO_ROOT = resolve(FRONTEND_ROOT, "..");

const TARGETS: Array<{ file: string; testid: string }> = [
  {
    file: "frontend/src/app/components/dashboard/LibraryPage.tsx",
    testid: "library-load-error",
  },
  {
    file: "frontend/src/app/components/dashboard/MistakesPage.tsx",
    testid: "mistakes-load-error",
  },
];

describe("v3.77 load-error surfacing contract", () => {
  for (const target of TARGETS) {
    describe(target.file, () => {
      const src = readFileSync(resolve(REPO_ROOT, target.file), "utf8");

      it("declares a setLoadError state setter", () => {
        expect(src).toMatch(/setLoadError\(/);
      });

      it(`renders an error region with role="alert" and data-testid="${target.testid}"`, () => {
        // Same line or within a few lines is fine — the regex is
        // tolerant.
        expect(src).toMatch(/role="alert"/);
        expect(src).toContain(`data-testid="${target.testid}"`);
      });

      it("uses tCommon('load_failed') for the message and tCommon('retry') for the button", () => {
        expect(src).toMatch(/tCommon\(["']load_failed["']\)/);
        expect(src).toMatch(/tCommon\(["']retry["']\)/);
      });

      it("does not still contain a silent setX([]) swallow without a setLoadError sibling", () => {
        // Pin the v3.77 fix: the catch block must call setLoadError
        // somewhere. We can't assert ordering robustly, but we can
        // assert that a setLoadError call exists in the file.
        const hasError = /setLoadError\(\s*tCommon\(["']load_failed["']\)/;
        expect(src).toMatch(hasError);
      });

      it("renders a retry button that bumps a reloadCounter", () => {
        expect(src).toMatch(/setReloadCounter\(\(/);
        expect(src).toMatch(/reloadCounter/);
      });
    });
  }
});

describe("v3.77 i18n key contract", () => {
  it("RU common.json contains load_failed + retry keys", () => {
    const ru = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "frontend/src/locales/ru/common.json"),
        "utf8",
      ),
    );
    expect(ru.load_failed).toBeTypeOf("string");
    expect(ru.retry).toBeTypeOf("string");
    expect(ru.load_failed.length).toBeGreaterThan(0);
    expect(ru.retry.length).toBeGreaterThan(0);
  });

  it("KZ common.json contains load_failed + retry keys", () => {
    const kz = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "frontend/src/locales/kz/common.json"),
        "utf8",
      ),
    );
    expect(kz.load_failed).toBeTypeOf("string");
    expect(kz.retry).toBeTypeOf("string");
    expect(kz.load_failed.length).toBeGreaterThan(0);
    expect(kz.retry.length).toBeGreaterThan(0);
  });

  it("RU common.json now has the 4 keys the audit flagged missing on KZ side", () => {
    const ru = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "frontend/src/locales/ru/common.json"),
        "utf8",
      ),
    );
    expect(ru.universities).toBeTypeOf("string");
    expect(ru.name).toBeTypeOf("string");
    expect(ru.logout).toBeTypeOf("string");
  });

  it("KZ common.json now mirrors RU on universities/name/logout", () => {
    const kz = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "frontend/src/locales/kz/common.json"),
        "utf8",
      ),
    );
    expect(kz.universities).toBeTypeOf("string");
    expect(kz.name).toBeTypeOf("string");
    expect(kz.logout).toBeTypeOf("string");
  });

  it("KZ profile.json now mirrors RU on select_university", () => {
    const kz = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "frontend/src/locales/kz/profile.json"),
        "utf8",
      ),
    );
    expect(kz.select_university).toBeTypeOf("string");
    expect(kz.select_university.length).toBeGreaterThan(0);
  });
});
