/**
 * Synthetic Regression #2 — Library thumbnails return 404.
 *
 * Simulates a CDN misconfiguration or thumbnail-renderer crash by intercepting
 * all /api/library/books/{id}/pages/{n}/thumbnail* requests and returning 404.
 * The product source is NOT modified — this uses Playwright page.route().
 *
 * Snapshots are named with a -reg2 suffix so they land alongside but not
 * on top of the real baselines.
 */
import { test, expect } from "@playwright/test";
import { setupAuthenticatedUser, logoutUser } from "./helpers/auth";
import { stabilize, defaultMasks } from "./helpers/stabilize";

async function goto(page: import("@playwright/test").Page, path: string) {
  await page.goto(`http://localhost:5174${path}`);
  await page.waitForLoadState("domcontentloaded");
}

async function snapshotPage(
  page: import("@playwright/test").Page,
  name: string,
  extraMasks: any[] = []
) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: [...defaultMasks(page), ...extraMasks],
  });
}

test.describe("regression-2 library-thumbnails-404", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page);

    // 404 all thumbnail requests
    await page.route("**/api/library/books/*/pages/*/thumbnail*", (route) =>
      route.fulfill({ status: 404, body: "" })
    );
  });

  test.afterEach(async ({ page }) => {
    await logoutUser(page);
  });

  // --- Core library screens ---

  test("library-grid-reg2", async ({ page }) => {
    await goto(page, "/dashboard/library");
    await stabilize(page);
    await snapshotPage(page, "library-grid-reg2");
  });

  test("library-filtered-math-reg2", async ({ page }) => {
    await goto(page, "/dashboard/library");
    await stabilize(page);
    const mathChip = page.locator("text=Mathematics").first();
    if (await mathChip.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mathChip.click();
      await stabilize(page);
    }
    await snapshotPage(page, "library-filtered-math-reg2");
  });

  // --- Responsive variants ---

  test.describe("responsive-375x812", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("library-grid-375x812-reg2", async ({ page }) => {
      await goto(page, "/dashboard/library");
      await stabilize(page);
      await snapshotPage(page, "library-grid-375x812-reg2");
    });
  });

  test.describe("responsive-768x1024", () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test("library-grid-768x1024-reg2", async ({ page }) => {
      await goto(page, "/dashboard/library");
      await stabilize(page);
      await snapshotPage(page, "library-grid-768x1024-reg2");
    });
  });

  test.describe("responsive-1920x1080", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("library-grid-1920x1080-reg2", async ({ page }) => {
      await goto(page, "/dashboard/library");
      await stabilize(page);
      await snapshotPage(page, "library-grid-1920x1080-reg2");
    });
  });
});
