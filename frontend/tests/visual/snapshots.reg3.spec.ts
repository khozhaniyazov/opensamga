import { test, expect, Page } from "@playwright/test";
import { setupAuthenticatedUser, logoutUser } from "./helpers/auth";
import { stabilize, defaultMasks } from "./helpers/stabilize";

async function goto(page: Page, path: string) {
  await page.goto(path.startsWith("/") ? `http://localhost:5174${path}` : path);
  await page.waitForLoadState("domcontentloaded");
}

async function snapshotPage(
  page: Page,
  name: string,
  extraMasks: any[] = []
) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: [...defaultMasks(page), ...extraMasks],
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/library/books/*/pdf**", (route) =>
    route.abort("blockedbyclient")
  );
});

test.describe("reg3-pdf", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page);
  });

  test.afterEach(async ({ page }) => {
    await logoutUser(page);
  });

  test("pdf-viewer-reg3", async ({ page }) => {
    await goto(page, "/dashboard/library/books/1");
    await stabilize(page);
    await snapshotPage(page, "pdf-viewer-reg3");
  });
});
