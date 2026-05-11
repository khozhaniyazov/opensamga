import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should render landing page with correct title", async ({ page }) => {
    await expect(page).toHaveTitle(/Samga\.ai|UNT|Адаптивная подготовка/i);
  });

  test("should display primary register button", async ({ page }) => {
    const enterBtn = page
      .locator('a[href="/register"]')
      .filter({ hasText: /Начать подготовку|Enter|Войти/i });
    await expect(enterBtn).toBeVisible();
    await expect(enterBtn).toHaveAttribute("href", "/register");
  });

  test("should have accessible header with logo", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();
    const logo = header.locator('a[aria-label="Samga"], a:has-text("Samga")');
    await expect(logo).toBeVisible();
  });

  test("canvas animation should not block interaction", async ({ page }) => {
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    const enterBtn = page.locator('a[href="/register"]');
    await expect(enterBtn).toBeEnabled();
  });

  test("stale auth token should not redirect public landing to login", async ({
    page,
  }) => {
    await page.evaluate(() =>
      localStorage.setItem("access_token", "expired-token"),
    );
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Samga" })).toBeVisible();
    await expect(page.locator('a[href="/register"]')).toContainText(
      /Начать подготовку/i,
    );
  });

  test("should redirect /chat to /dashboard/chat", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/dashboard\/chat/, { timeout: 10000 });
  });

  test("should redirect /exams to /dashboard/exams", async ({ page }) => {
    await page.goto("/exams");
    await page.waitForURL(/\/dashboard\/exams/, { timeout: 10000 });
  });

  test("should redirect /library to /dashboard/library", async ({ page }) => {
    await page.goto("/library");
    await page.waitForURL(/\/dashboard\/library/, { timeout: 10000 });
  });

  test("should redirect /profile to /dashboard/profile", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForURL(/\/dashboard\/profile/, { timeout: 10000 });
  });

  test("should redirect /billing to /dashboard/billing", async ({ page }) => {
    await page.goto("/billing");
    await page.waitForURL(/\/dashboard\/billing/, { timeout: 10000 });
  });

  test("should render 404 for unknown routes", async ({ page }) => {
    await page.goto("/nonexistent-route-12345");
    await expect(page.locator("body")).toContainText(
      /404|not found|страница не найдена/i,
      { timeout: 10000 },
    );
  });

  test("privacy page should load", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("body")).toContainText(/privacy|политика/i, {
      timeout: 10000,
    });
  });

  test("terms page should load", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.locator("body")).toContainText(/terms|условия/i, {
      timeout: 10000,
    });
  });
});
