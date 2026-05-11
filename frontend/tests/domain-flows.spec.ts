import { test, expect, type Page } from '@playwright/test';
import { loginAsMockUser, MOCK_PREMIUM_BILLING } from './helpers';

const libraryBooks = [
  {
    id: 1,
    title: 'Математика 2 Оспанов',
    subject: 'Математика',
    grade: 10,
    file_name: 'math-ospanov.pdf',
    total_pages: 220,
  },
];

const thumbnailSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><rect width="16" height="24" fill="#f4f4f5"/></svg>';

function question(section: string, index: number, maxPoints = 1) {
  return {
    id: `${section}-${index}`,
    type: 'single',
    stem: {
      ru: `Вопрос ${index} по разделу ${section}`,
      kz: `${section} бөлімі бойынша ${index} сұрақ`,
    },
    options: [
      { id: 'a', text: { ru: 'Вариант A', kz: 'A нұсқасы' } },
      { id: 'b', text: { ru: 'Вариант B', kz: 'B нұсқасы' } },
      { id: 'c', text: { ru: 'Вариант C', kz: 'C нұсқасы' } },
      { id: 'd', text: { ru: 'Вариант D', kz: 'D нұсқасы' } },
    ],
    correctIds: ['a'],
    maxPoints,
  };
}

function section(key: string, count: number, maxPoints: number) {
  return {
    key,
    maxPoints,
    questions: Array.from({ length: count }, (_, index) => question(key, index + 1)),
  };
}

function mockExamData() {
  return {
    subjects: [
      section('histKz', 20, 20),
      section('readLit', 10, 10),
      section('mathLit', 10, 10),
      section('math', 40, 50),
      section('physics', 40, 50),
    ],
    totalQuestions: 120,
    totalMaxPoints: 140,
    durationSeconds: 14400,
  };
}

async function mockLibrary(page: Page, books = libraryBooks) {
  await page.route('**/api/library/books', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(books),
    });
  });

  await page.route('**/api/library/books/*/pdf**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4\n% Samga test PDF\n',
    });
  });

  await page.route('**/api/library/books/*/pages/*/thumbnail**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: thumbnailSvg,
    });
  });
}

async function mockExam(page: Page) {
  await page.route('**/api/exam/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/exam/generate**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockExamData()),
    });
  });

  await page.route('**/api/exam/submit', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        score: 1,
        max_score: 140,
        attempt_id: 42,
        mistakes_created: 0,
        answered_count: 1,
        skipped_count: 119,
        wrong_answered_count: 0,
      }),
    });
  });
}

test.describe('Domain flows', () => {
  test('premium user can start and submit a generated exam', async ({ page }) => {
    await mockExam(page);
    await loginAsMockUser(page, {
      path: '/dashboard/exams',
      billing: MOCK_PREMIUM_BILLING,
    });

    await page.getByRole('button', { name: /^Начать$/i }).click();
    await page
      .locator('button')
      .filter({ hasText: 'Математика' })
      .filter({ hasText: 'Физика' })
      .first()
      .click();
    await page.getByRole('button', { name: /Начать экзамен/i }).click();

    await expect(page.locator('body')).toContainText(/Вопрос 1 \/ 20/i, { timeout: 10000 });
    await page.getByRole('button', { name: /Вариант A/i }).first().click();
    await page.getByRole('button', { name: /Завершить/i }).click();
    await expect(page.locator('body')).toContainText(/У вас 119 вопросов без ответов/i);
    await page.getByRole('button', { name: /Подтвердить отправку/i }).click();

    await expect(page.locator('body')).toContainText(/Результаты пробного экзамена/i, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Сигналы разбора/i);
    await expect(page.locator('body')).toContainText(/Пропущено/i);
  });

  test('PDF viewer opens a citation deep-link to the requested page', async ({ page }) => {
    await mockLibrary(page);
    await loginAsMockUser(page, { path: '/dashboard/library/books/1?page=41' });

    await expect(page.locator('main')).toContainText('Математика 2 Оспанов');
    await expect(page.locator('main')).toContainText(/Страница\s*41/i);
    // v4.22: PdfViewerPage fetches the PDF via apiBlob() and renders the
    // resulting blob: URL (F-14 hardening) so the JWT never appears in
    // the iframe src. Hunt-backlog item L2 — regex previously expected
    // `/api/library/books/1/pdf?token=…#page=41`, which was wrong on
    // every v3.x/v4.x since the F-14 ship.
    await expect(page.locator('iframe')).toHaveAttribute('src', /^blob:.*#page=41$/);
  });

  test('v4.22: PDF viewer clamps ?page=9999 to the book total_pages', async ({ page }) => {
    // Hunt-backlog L3 — pre-v4.22 the viewer appended #page=9999 and
    // the reader silently dropped the fragment. Post-v4.22
    // `clampPageToBook` caps at total_pages (220 in this fixture) so
    // the reader scrolls to the final page instead of nowhere.
    await mockLibrary(page);
    await loginAsMockUser(page, { path: '/dashboard/library/books/1?page=9999' });

    await expect(page.locator('main')).toContainText('Математика 2 Оспанов');
    await expect(page.locator('iframe')).toHaveAttribute('src', /^blob:.*#page=220$/);
  });

  test('PDF viewer shows not-found state for unknown book ids', async ({ page }) => {
    await mockLibrary(page, []);
    await loginAsMockUser(page, { path: '/dashboard/library/books/999' });

    await expect(page.locator('main')).toContainText(/Учебник не найден/i);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});
