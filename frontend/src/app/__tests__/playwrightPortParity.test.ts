import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v4.11 (2026-05-06): static-source contract test pinning the
 * backend-port constant across every Playwright helper that
 * directly talks to the backend API.
 *
 * Bug recap: v4.3 fixed `:8000 → :8001` in `frontend/tests/helpers.ts`
 * and `frontend/tests/api.spec.ts`, but left the sibling helper
 * `frontend/tests/visual/helpers/auth.ts` stuck on `:8000`. Every
 * authenticated a11y + visual-snapshot spec ECONNREFUSED'd during
 * setup (27 unique specs × 2 retries = 54 failures of 49 per run
 * on master through v4.10).
 *
 * Lesson (feedback_playwright_port_audit_before_running.md): when a
 * port constant lives in N files, ANY one of them drifting off
 * breaks a non-overlapping slice of the suite. The audit is cheap
 * so we encode it as a tripwire here instead of relying on future
 * agents to re-run the checklist.
 *
 * We intentionally use the static-source pattern (readFileSync +
 * regex) rather than importing the helpers. The helpers are
 * Playwright-only modules — they `import { Page } from
 * "@playwright/test"` which pulls the full Playwright runtime into
 * a vitest harness for no reason. Static-source is what static-
 * source is good for: pinning a literal value in a file.
 */

// __tests__ → app → src → frontend   (3 levels up to the FE root)
const FE_ROOT = resolve(__dirname, "..", "..", "..");

const HELPERS_MAIN = resolve(FE_ROOT, "tests", "helpers.ts");
const HELPERS_VISUAL = resolve(
  FE_ROOT,
  "tests",
  "visual",
  "helpers",
  "auth.ts",
);
const API_SPEC = resolve(FE_ROOT, "tests", "api.spec.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Playwright helpers — backend-port parity (v4.11)", () => {
  it("tests/helpers.ts API_BASE is :8001", () => {
    const src = read(HELPERS_MAIN);
    expect(src).toMatch(
      /API_BASE\s*=\s*["']http:\/\/(localhost|127\.0\.0\.1):8001["']/,
    );
  });

  it("tests/visual/helpers/auth.ts API_URL is :8001", () => {
    // Prior to v4.11 this file was pinned at :8000 — the stale
    // leftover v4.3 missed. If this assertion fails it means
    // someone drifted the visual-helper port off the main helper;
    // re-align to :8001 (project convention) or update all three files in
    // lock-step.
    const src = read(HELPERS_VISUAL);
    expect(src).toMatch(
      /API_URL\s*=\s*["']http:\/\/(localhost|127\.0\.0\.1):8001["']/,
    );
  });

  it("tests/api.spec.ts baseURL is :8001", () => {
    const src = read(API_SPEC);
    expect(src).toMatch(
      /baseURL\s*=\s*["']http:\/\/(localhost|127\.0\.0\.1):8001["']/,
    );
  });

  it("no Playwright helper file contains a bare :8000 literal", () => {
    // Guard against partial reverts. We allow :8000 only inside
    // comments (where v4.3/v4.11 historical notes live), so strip
    // `//`-line-comments and `/* */`-block-comments before checking.
    const files = [HELPERS_MAIN, HELPERS_VISUAL, API_SPEC];
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const path of files) {
      const code = stripComments(read(path));
      expect(
        code,
        `executable code in ${path} must not reference :8000`,
      ).not.toMatch(/:8000\b/);
    }
  });
});
