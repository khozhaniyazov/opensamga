import { test } from "@playwright/test";
import { setupAuthenticatedUser } from "../visual/helpers/auth";
import { scanA11y } from "./helpers/scan";

/**
 * Accessibility sweep: runs axe-core against a curated set of Samga screens.
 *
 * Each test represents one "route state" we want a separate report for. Tests
 * are independent (no shared fixture) so a failure on screen N does not block
 * screens N+1..Z. We never fail the test on violations — axe output is the
 * whole point, not a gate.
 *
 * Run with:
 *   npx playwright test --config tests/a11y/a11y.config.ts
 */

// ---------- Public screens (no auth required) ----------

test.describe("public", () => {
  test("landing", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "landing" });
  });

  test("login", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "login" });
  });

  test("register", async ({ page }, testInfo) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "register" });
  });

  test("register-validation-errors", async ({ page }, testInfo) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
    // Click the submit button with empty fields to surface the client-side errors.
    const submit = page.locator("button[type=submit]").first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await scanA11y(page, testInfo, { screen: "register-validation-errors" });
  });

  test("404", async ({ page }, testInfo) => {
    await page.goto("/this-page-does-not-exist");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "404" });
  });

  test("legal-terms", async ({ page }, testInfo) => {
    await page.goto("/legal/terms");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "legal-terms" });
  });

  test("legal-privacy", async ({ page }, testInfo) => {
    await page.goto("/legal/privacy");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "legal-privacy" });
  });
});

// ---------- Authenticated screens ----------

test.describe("authenticated", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page);
  });

  test("dashboard-home", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "dashboard-home" });
  });

  test("library-grid", async ({ page }, testInfo) => {
    await page.goto("/dashboard/library");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500); // let lazy-loaded thumbnails settle
    await scanA11y(page, testInfo, { screen: "library-grid" });
  });

  test("pdf-viewer", async ({ page }, testInfo) => {
    await page.goto("/dashboard/library/books/1");
    await page.waitForLoadState("networkidle");
    // Iframe content is cross-origin-ish; axe cannot descend into it anyway.
    await scanA11y(page, testInfo, {
      screen: "pdf-viewer",
      exclude: ["iframe"],
    });
  });

  test("chat-empty", async ({ page }, testInfo) => {
    await page.goto("/dashboard/chat");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "chat-empty" });
  });

  test("universities", async ({ page }, testInfo) => {
    await page.goto("/dashboard/universities");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "universities" });
  });

  test("profile-view", async ({ page }, testInfo) => {
    await page.goto("/dashboard/profile");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "profile-view" });
  });

  test("billing-free", async ({ page }, testInfo) => {
    await page.goto("/dashboard/billing");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "billing-free" });
  });

  test("paywall-exams", async ({ page }, testInfo) => {
    await page.goto("/dashboard/exams");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "paywall-exams" });
  });

  test("paywall-mistakes", async ({ page }, testInfo) => {
    await page.goto("/dashboard/mistakes");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "paywall-mistakes" });
  });

  test("paywall-training", async ({ page }, testInfo) => {
    await page.goto("/dashboard/training");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "paywall-training" });
  });

  test("paywall-gap-analysis", async ({ page }, testInfo) => {
    await page.goto("/dashboard/gap-analysis");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "paywall-gap-analysis" });
  });

  test("quiz-page", async ({ page }, testInfo) => {
    await page.goto("/dashboard/quiz");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "quiz-page" });
  });

  test("admin-denied", async ({ page }, testInfo) => {
    await page.goto("/dashboard/rag-stats");
    await page.waitForLoadState("networkidle");
    await scanA11y(page, testInfo, { screen: "admin-denied" });
  });
});
