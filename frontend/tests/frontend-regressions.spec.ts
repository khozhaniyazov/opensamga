import { test, expect, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  loginAsMockUser,
  logout,
} from "./helpers";

const mockBooks = Array.from({ length: 55 }, (_, index) => ({
  id: index + 1,
  title: `Алгебра ${index + 1}`,
  subject: index % 2 === 0 ? "Математика" : "Физика",
  grade: 10 + (index % 2),
  file_name: `book-${index + 1}.pdf`,
  total_pages: 120 + index,
}));

const mockUniversities = [
  {
    id: 1,
    label: "Казахстанско-Британский технический университет",
    value: "kazakhstan_british_technical_university",
    city: "Алматы",
    university_code: "KBTU",
    total_students: 5000,
    majors_count: 24,
    median_grant_threshold: 118,
    popularity_score: 95,
    popularity_tier: "very_high",
    prestige_score: 96,
    prestige_tier: "elite",
    prestige_note: "Strong technical university.",
  },
  ...Array.from({ length: 44 }, (_, index) => ({
    id: index + 2,
    label: `Тестовый университет ${index + 2}`,
    value: `test_university_${index + 2}`,
    city: index % 2 === 0 ? "Астана" : "Алматы",
    university_code: `T${index + 2}`,
    total_students: 1000 + index,
    majors_count: 6 + (index % 5),
    median_grant_threshold: 80 + (index % 20),
    popularity_score: 60 - (index % 10),
    popularity_tier: index % 2 === 0 ? "medium" : "niche",
    prestige_score: 50 - (index % 10),
    prestige_tier: index % 2 === 0 ? "established" : "regional",
    prestige_note: null,
  })),
];

const thumbnailSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><rect width="16" height="24" fill="#f4f4f5"/></svg>';

async function mockLibrary(page: Page) {
  await page.route("**/api/library/books", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockBooks),
    });
  });

  await page.route(
    "**/api/library/books/*/pages/*/thumbnail**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: thumbnailSvg,
      });
    },
  );
}

async function mockUniversitiesApi(page: Page) {
  await page.route("**/api/data/universities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUniversities),
    });
  });
}

async function centeredSearchIconDelta(page: Page) {
  const input = page
    .locator('input[placeholder*="Поиск"], input[placeholder*="іздеу"]')
    .first();
  await expect(input).toBeVisible();
  return input.evaluate((el) => {
    const inputRect = el.getBoundingClientRect();
    const svg = el.parentElement?.querySelector("svg");
    if (!svg) return Number.POSITIVE_INFINITY;
    const svgRect = svg.getBoundingClientRect();
    const inputCenter = inputRect.top + inputRect.height / 2;
    const iconCenter = svgRect.top + svgRect.height / 2;
    return Math.abs(inputCenter - iconCenter);
  });
}

test.describe("Frontend regressions", () => {
  test("login and register show inline validation instead of native bubbles", async ({
    page,
  }) => {
    await logout(page);

    await page.goto("/login");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("alert")).toContainText(
      /Введите email|Email мекенжайын енгізіңіз/i,
    );

    await page.goto("/register");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("alert")).toContainText(
      /Введите имя|Аты-жөніңізді енгізіңіз/i,
    );
  });

  test("library caps initial render and keeps search icon centered", async ({
    page,
  }) => {
    await mockLibrary(page);
    await loginAsMockUser(page, { path: "/dashboard/library" });

    const cards = page.locator('a[href*="/dashboard/library/books/"]');
    await expect(cards).toHaveCount(48);
    expect(await centeredSearchIconDelta(page)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/library");
    await expect(
      page.locator('input[aria-label*="Поиск"], input[aria-label*="іздеу"]'),
    ).toHaveAttribute("placeholder", /Поиск учебника|Оқулық іздеу/);

    await page
      .getByRole("button", { name: /Показать еще|Тағы көрсету/i })
      .click();
    await expect(cards).toHaveCount(55);
  });

  test("university aliases find KBTU and initial list is capped", async ({
    page,
  }) => {
    await mockUniversitiesApi(page);
    await loginAsMockUser(page, { path: "/dashboard/universities" });

    await expect(page.locator("article")).toHaveCount(30);
    expect(await centeredSearchIconDelta(page)).toBeLessThanOrEqual(1);

    const search = page
      .locator('input[placeholder*="Поиск"], input[placeholder*="іздеу"]')
      .first();
    await search.fill("KBTU");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("main")).toContainText(
      "Казахстанско-Британский технический университет",
    );

    await search.fill("КБТУ");
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("main")).toContainText(
      "Казахстанско-Британский технический университет",
    );
  });

  test("paywall modal exposes dialog semantics", async ({ page }) => {
    await loginAsMockUser(page, { path: "/dashboard/billing" });

    await page
      .getByRole("button", { name: /Премиум|Premium/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-labelledby", "paywall-title");
    await expect(dialog).toHaveAttribute(
      "aria-describedby",
      "paywall-description",
    );
  });

  test("quiz gate uses quick-test copy instead of exam copy", async ({
    page,
  }) => {
    await loginAsMockUser(page, { path: "/dashboard/quiz" });

    await expect(page.locator("main")).toContainText(
      /Быстрый тест внутри Premium|Жылдам тест Premium ішінде/i,
    );
    await expect(page.locator("main")).toContainText(
      /Premium-тренировка|Premium жаттығу/i,
    );
    await expect(page.locator("main")).not.toContainText(
      /Пробные экзамены ЕНТ|ҰБТ сынақ емтихандары/i,
    );
  });

  test("admin-only denial is localized in KZ", async ({ page }) => {
    await loginAsMockUser(page, { path: "/dashboard/rag-stats", lang: "kz" });

    await expect(page.locator("body")).toContainText(
      "Тек әкімшілерге арналған",
    );
    await expect(page.locator("body")).toContainText("Дашбордқа қайту");
  });

  test("core dashboard routes have no document-level horizontal overflow", async ({
    page,
  }) => {
    await mockLibrary(page);
    await mockUniversitiesApi(page);
    await loginAsMockUser(page);

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of [
        "/dashboard",
        "/dashboard/library",
        "/dashboard/universities",
        "/dashboard/billing",
        "/dashboard/quiz",
      ]) {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        await expectNoDocumentHorizontalOverflow(page);
      }
    }
  });
});
