import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v3.70 (B12, 2026-05-02): static-source contract test pinning the
 * sidebar-group redirect routes.
 *
 * Bug recap: /dashboard/practice and /dashboard/account hit the
 * catch-all 404. Both correspond to collapsible sidebar groups
 * (DashboardLayout `navTree` keys "practice" and "account") that
 * have no index route — only children. A student manually editing
 * the URL got a stock 404 instead of the first child of the group.
 *
 * v3.70 adds two `<Navigate>` redirects under the /dashboard route
 * tree:
 *   - practice  → /dashboard/quiz    (first child of "Практика")
 *   - account   → /dashboard/profile (first child of "Аккаунт")
 *
 * We use the static-source pattern (readFileSync + regex) instead
 * of full-render react-router because routes.tsx pulls every
 * dashboard page lazily and bringing them into a vitest harness
 * would balloon the test surface. The change here is purely
 * structural — exactly what static-source tests are good for.
 */

const SUT = resolve(__dirname, "..", "routes.tsx");

function readSource(): string {
  return readFileSync(SUT, "utf8");
}

describe("routes.tsx — v3.70 sidebar group redirects (B12)", () => {
  it("redirects /dashboard/practice → /dashboard/quiz", () => {
    const src = readSource();
    // Match the route entry: { path: "practice", element: <Navigate to="/dashboard/quiz" replace /> }
    expect(src).toMatch(
      /path:\s*["']practice["'][\s\S]{0,160}Navigate\s+to=["']\/dashboard\/quiz["']\s+replace/,
    );
  });

  it("redirects /dashboard/account → /dashboard/profile", () => {
    const src = readSource();
    expect(src).toMatch(
      /path:\s*["']account["'][\s\S]{0,160}Navigate\s+to=["']\/dashboard\/profile["']\s+replace/,
    );
  });

  it("uses an `element: <Navigate>` (not a `Component:`) for both redirects", () => {
    const src = readSource();
    // Each route object spans roughly one line of `path:` + one of
    // `element:` + a closing brace. Match the whole `{ path: "X", ... }`
    // entry up to the next top-level comma after the closing brace,
    // and assert `Component:` does NOT appear inside that span.
    function entryFor(name: string): string {
      const re = new RegExp(
        `\\{\\s*path:\\s*["']${name}["'][\\s\\S]*?\\},`,
        "m",
      );
      const m = src.match(re);
      expect(m, `expected route entry for ${name}`).toBeTruthy();
      return m![0];
    }
    const practiceEntry = entryFor("practice");
    const accountEntry = entryFor("account");
    expect(practiceEntry).not.toMatch(/Component:/);
    expect(accountEntry).not.toMatch(/Component:/);
    expect(practiceEntry).toMatch(/element:\s*<Navigate/);
    expect(accountEntry).toMatch(/element:\s*<Navigate/);
  });

  it("redirects sit inside the /dashboard children array, not as top-level routes", () => {
    const src = readSource();
    // Heuristic: top-level `path: "/dashboard"` block contains the
    // children array; both new redirects must appear within it.
    const dashRouteIdx = src.indexOf('path: "/dashboard"');
    expect(dashRouteIdx).toBeGreaterThan(-1);
    const tail = src.slice(dashRouteIdx);
    const accountIdx = tail.search(/path:\s*["']account["']/);
    const practiceIdx = tail.search(/path:\s*["']practice["']/);
    expect(practiceIdx).toBeGreaterThan(-1);
    expect(accountIdx).toBeGreaterThan(-1);
  });
});
