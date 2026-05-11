import { test, expect } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow, loginAsMockUser } from "./helpers";

async function mockDashboardBackfill(page: import("@playwright/test").Page) {
  await page.route("**/api/chat/template-context", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/chat/history**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });

  await page.route("**/api/chat/threads**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 101 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threads: [], legacy_bucket_message_count: 0 }),
    });
  });

  await page.route("**/api/library/books", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/data/universities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

async function expandGroup(
  page: import("@playwright/test").Page,
  label: RegExp,
) {
  const group = page
    .locator("nav")
    .locator("button")
    .filter({ hasText: label })
    .first();
  await expect(group).toBeVisible();
  if ((await group.getAttribute("aria-expanded")) !== "true") {
    await group.click();
  }
}

async function clickNav(page: import("@playwright/test").Page, label: RegExp) {
  const item = page
    .locator("nav")
    .locator("button, a")
    .filter({ hasText: label })
    .first();
  await expect(item).toBeVisible();
  await item.click();
}

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardBackfill(page);
    await loginAsMockUser(page);
  });

  test("should render sidebar with navigation items", async ({ page }) => {
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator("nav")).toContainText(
      /обзор|чат|практика|библиотека|вузы|аккаунт/i,
    );
  });

  test("should navigate to chat page", async ({ page }) => {
    await clickNav(page, /chat|чат/i);
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });

  test("should navigate to library page", async ({ page }) => {
    await clickNav(page, /библиотека|кітапхана|library/i);
    await expect(page).toHaveURL(/\/dashboard\/library/);
  });

  test("should navigate to universities page", async ({ page }) => {
    await expandGroup(page, /вузы|жоо|universities/i);
    await clickNav(page, /все вузы|барлық жоо/i);
    await expect(page).toHaveURL(/\/dashboard\/universities/);
  });

  test("should navigate to profile page", async ({ page }) => {
    await expandGroup(page, /аккаунт|есептік жазба|account/i);
    await clickNav(page, /профиль|жеке деректер|profile/i);
    await expect(page).toHaveURL(/\/dashboard\/profile/);
  });

  test("should navigate to billing page", async ({ page }) => {
    await expandGroup(page, /аккаунт|есептік жазба|account/i);
    await clickNav(page, /тариф и оплата|тариф және төлем|billing/i);
    await expect(page).toHaveURL(/\/dashboard\/billing/);
  });

  test("should expand practice group and show sub-items", async ({ page }) => {
    await expandGroup(page, /практика|дайындық|practice/i);
    await expect(page.locator("nav")).toContainText(
      /экзамены|быстрый тест|ошибки|тренировка|анализ пробелов/i,
    );
    await expect(page.locator("nav")).not.toContainText(/аудиорежим/i);
  });

  test("should expand universities group and show sub-items", async ({
    page,
  }) => {
    await expandGroup(page, /вузы|жоо|universities/i);
    await expect(page.locator("nav")).toContainText(/все вузы/i);
    await expect(page.locator("nav")).not.toContainText(/портфолио|напарник/i);
  });

  test("should expand account group and show sub-items", async ({ page }) => {
    await expandGroup(page, /аккаунт|есептік жазба|account/i);
    await expect(page.locator("nav")).toContainText(/профиль|тариф и оплата/i);
  });

  test("should show free plan badge by default", async ({ page }) => {
    await expect(
      page.locator("text=/free|бесплатный|тегін/i").first(),
    ).toBeVisible();
  });

  test("should toggle language between RU and KZ", async ({ page }) => {
    const kzBtn = page.locator("button").filter({ hasText: "KZ" }).first();
    const ruBtn = page.locator("button").filter({ hasText: "RU" }).first();
    await kzBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator("nav")).toContainText(/чат|дайындық|кітапхана/i);
    await ruBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator("nav")).toContainText(/чат|практика|библиотека/i);
  });

  test("should show upgrade button for free users", async ({ page }) => {
    const upgradeBtn = page
      .locator("button")
      .filter({ hasText: /upgrade|премиум|premium/i })
      .first();
    await expect(upgradeBtn).toBeVisible();
  });

  test("legacy unavailable feature URLs redirect to live surfaces", async ({
    page,
  }) => {
    await page.goto("/dashboard/commuter");
    await expect(page).toHaveURL(/\/dashboard\/training/);
    await expect(page.locator("main")).toContainText(/Тренировка|Practice/i);

    await page.goto("/dashboard/portfolio");
    await expect(page).toHaveURL(/\/dashboard\/universities/);
    await expect(page.locator("main")).toContainText(/Поиск вузов|Atlas/i);

    await page.goto("/dashboard/buddy");
    await expect(page).toHaveURL(/\/dashboard\/universities/);
    await expect(page.locator("main")).toContainText(/Поиск вузов|Atlas/i);
  });

  test("should open paywall modal when clicking locked feature", async ({
    page,
  }) => {
    await expandGroup(page, /практика|дайындық|practice/i);
    await clickNav(page, /экзамены|емтихандар|exams/i);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10000 });
  });

  test("should have responsive mobile menu button", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard");
    const menuBtn = page.locator("header button").first();
    await expect(menuBtn).toBeVisible();
  });

  test("should render dashboard home with stats or welcome", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).toContainText(
      /рабочее пространство Samga готово|Samga кеңістігі дайын|Быстрый вход/i,
    );
  });

  test("should avoid document-level horizontal overflow on core routes", async ({
    page,
  }) => {
    const routes = [
      "/dashboard",
      "/dashboard/library",
      "/dashboard/universities",
      "/dashboard/billing",
      "/dashboard/quiz",
    ];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await expectNoDocumentHorizontalOverflow(page);
    }
  });
});
