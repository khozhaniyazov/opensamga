import { test, expect, Page } from "@playwright/test";
import { setupAuthenticatedUser, logoutUser } from "./helpers/auth";
import { stabilize, defaultMasks } from "./helpers/stabilize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// Keep this suite focused on high-value visual contracts. Broad behavioral,
// accessibility, and copy coverage lives in the non-screenshot suites.
test.describe("public", () => {
  test("landing", async ({ page }) => {
    await goto(page, "/");
    await stabilize(page);
    await snapshotPage(page, "landing");
  });
});

test.describe("authenticated", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page);
  });

  test.afterEach(async ({ page }) => {
    await logoutUser(page);
  });

  test("dashboard-home", async ({ page }) => {
    await goto(page, "/dashboard");
    await stabilize(page);
    await snapshotPage(page, "dashboard-home");
  });

  test("library-grid", async ({ page }) => {
    await goto(page, "/dashboard/library");
    await stabilize(page);
    await snapshotPage(page, "library-grid");
  });

  test("pdf-viewer", async ({ page }) => {
    await goto(page, "/dashboard/library/books/1");
    await stabilize(page);
    await snapshotPage(page, "pdf-viewer");
  });

  test("chat-empty", async ({ page }) => {
    await goto(page, "/dashboard/chat");
    await stabilize(page);
    await snapshotPage(page, "chat-empty");
  });

  test("universities", async ({ page }) => {
    await goto(page, "/dashboard/universities");
    await stabilize(page);
    await snapshotPage(page, "universities");
  });

  test("universities-filters-open", async ({ page }) => {
    await goto(page, "/dashboard/universities");
    await stabilize(page);
    const filterBtn = page.locator("text=Элита").first();
    if (await filterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterBtn.click();
      await page.waitForTimeout(300);
    }
    await stabilize(page);
    await snapshotPage(page, "universities-filters-open");
  });

  test("profile-view", async ({ page }) => {
    await goto(page, "/dashboard/profile");
    await stabilize(page);
    await snapshotPage(page, "profile-view");
  });

  test("billing-free", async ({ page }) => {
    await goto(page, "/dashboard/billing");
    await stabilize(page);
    await snapshotPage(page, "billing-free");
  });
});

const responsiveScreens: { name: string; path: string; auth: boolean }[] = [
  { name: "landing", path: "/", auth: false },
  { name: "dashboard-home", path: "/dashboard", auth: true },
  { name: "chat-empty", path: "/dashboard/chat", auth: true },
  { name: "library-grid", path: "/dashboard/library", auth: true },
];

const viewports = [
  { label: "375x812", width: 375, height: 812 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "1920x1080", width: 1920, height: 1080 },
];

for (const vp of viewports) {
  test.describe(`responsive-${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const screen of responsiveScreens) {
      test(`${screen.name}-${vp.label}`, async ({ page }) => {
        if (screen.auth) {
          await setupAuthenticatedUser(page);
        }
        await goto(page, screen.path);
        await stabilize(page);
        await snapshotPage(page, `${screen.name}-${vp.label}`);
        if (screen.auth) {
          await logoutUser(page);
        }
      });
    }
  });
}
