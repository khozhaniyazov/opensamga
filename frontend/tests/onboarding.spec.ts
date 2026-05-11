import { test, expect, type Page } from '@playwright/test';
import {
  installMockAuth,
  loginAsMockUser,
  logout,
  MOCK_FRESH_USER,
  MOCK_TOKEN,
} from './helpers';

const mockUniversities = [
  { id: 1, label: 'Казахстанско-Британский технический университет', value: 'kbtu', city: 'Алматы' },
  { id: 2, label: 'Astana IT University', value: 'aitu', city: 'Астана' },
];

async function mockUniversityList(page: Page) {
  await page.route('**/api/data/universities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUniversities),
    });
  });
}

async function mockFreshSession(page: Page) {
  await mockUniversityList(page);
  await installMockAuth(page, { user: MOCK_FRESH_USER });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((token) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('samga_lang', 'ru');
  }, MOCK_TOKEN);
}

test.describe('Onboarding Flow', () => {
  test.beforeEach(async ({ page }) => {
    await logout(page);
  });

  test('fresh authenticated user is redirected to onboarding from dashboard', async ({ page }) => {
    await mockFreshSession(page);

    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard\/onboarding/, { timeout: 10000 });
    await expect(page.locator('main')).toContainText(/Настройка учебного профиля|Выберите профильную пару/i);
  });

  test('onboarding page is accessible for a fresh user', async ({ page }) => {
    await mockFreshSession(page);

    await page.goto('/dashboard/onboarding');
    await expect(page.locator('main')).toContainText(/Настройка учебного профиля/i);
    await expect(page.locator('[data-testid="subject-combo-picker"]')).toBeVisible();
  });

  test('fresh user can complete onboarding and reach dashboard', async ({ page }) => {
    await mockFreshSession(page);
    await page.goto('/dashboard/onboarding');

    await page
      .locator('[data-testid="subject-combo-picker"] button')
      .filter({ hasText: 'Математика' })
      .filter({ hasText: 'Физика' })
      .first()
      .click();
    await page.getByRole('button', { name: /Продолжить/i }).click();

    const scoreInputs = page.locator('input[placeholder^="Балл"]');
    await expect(scoreInputs).toHaveCount(5);
    for (const [index, value] of ['15', '8', '9', '35', '35'].entries()) {
      await scoreInputs.nth(index).fill(value);
    }
    await page.getByRole('button', { name: /Продолжить/i }).click();

    await page.getByRole('button', { name: /Казахстанско-Британский/i }).click();
    await page.getByRole('button', { name: /Продолжить/i }).click();

    await expect(page.locator('main')).toContainText(/Профиль Samga готов/i);
    await page.getByRole('button', { name: /Завершить регистрацию/i }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 10000 });
    await expect(page.locator('main')).toContainText(/рабочее пространство Samga готово|Быстрый вход/i);
  });

  test('profile page displays user info for onboarded user', async ({ page }) => {
    await mockUniversityList(page);
    await loginAsMockUser(page, { path: '/dashboard/profile' });

    await expect(page.locator('body')).toContainText(/Mock E2E User|Профиль/i, { timeout: 10000 });
  });

  test('billing page displays plan info for onboarded user', async ({ page }) => {
    await loginAsMockUser(page, { path: '/dashboard/billing' });

    await expect(page.locator('main')).toContainText(/Тариф и оплата|Бесплатный тариф|Текущий тариф/i);
  });
});
