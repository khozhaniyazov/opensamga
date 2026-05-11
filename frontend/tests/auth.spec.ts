import { test, expect } from '@playwright/test';
import { createOnboardedUser, loginAsUser, registerUser, loginUser, logout } from './helpers';

const uniqueEmail = () => `e2e_auth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@samga.ai`;

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await logout(page);
  });

  test.describe('Registration', () => {
    test('should register a new user successfully', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'Test User', email, 'TestPass123!');
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.locator('body')).toContainText(/overview|чат|dashboard/i, { timeout: 15000 });
    });

    test('should reject registration with existing email', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'First User', email, 'TestPass123!');
      await logout(page);
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Second User');
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill('TestPass123!');
      await page.locator('button[type="submit"]').click();
      const error = page.locator('text=/уже зарегистрирован|бұрын тіркелген|already registered/i');
      await expect(error).toBeVisible({ timeout: 10000 });
    });

    test('should reject registration with short password', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Test');
      await page.locator('input[type="email"]').fill(uniqueEmail());
      await page.locator('input[type="password"]').fill('123');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toContainText(/минимум|кемінде|minimum|8/i, { timeout: 10000 });
    });

    test('should reject registration with password missing letters', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Test');
      await page.locator('input[type="email"]').fill(uniqueEmail());
      await page.locator('input[type="password"]').fill('12345678');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toContainText(/букв|әріп|letter/i, { timeout: 10000 });
    });

    test('should reject registration with password missing digits', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Test');
      await page.locator('input[type="email"]').fill(uniqueEmail());
      await page.locator('input[type="password"]').fill('abcdefgh');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toContainText(/цифр|сан|digit|number/i, { timeout: 10000 });
    });

    test('should reject registration with invalid email format', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Test');
      await page.locator('input[type="email"]').fill('not-an-email');
      await page.locator('input[type="password"]').fill('TestPass123!');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toContainText(/email|почта|invalid/i, { timeout: 10000 });
    });

    test('should reject empty name', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('');
      await page.locator('input[type="email"]').fill(uniqueEmail());
      await page.locator('input[type="password"]').fill('TestPass123!');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toContainText(/имя|аты|name/i, { timeout: 10000 });
    });

    test('should show loading state during registration', async ({ page }) => {
      await page.goto('/register');
      await page.locator('input[type="text"]').fill('Test');
      await page.locator('input[type="email"]').fill(uniqueEmail());
      await page.locator('input[type="password"]').fill('TestPass123!');
      await page.locator('button[type="submit"]').click();
      const btn = page.locator('button[type="submit"]');
      await expect(btn).toBeDisabled({ timeout: 5000 });
    });
  });

  test.describe('Login', () => {
    test('should login with valid credentials', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'Login Test', email, 'TestPass123!');
      await logout(page);
      await loginUser(page, email, 'TestPass123!');
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should reject login with wrong password', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'Login Test', email, 'TestPass123!');
      await logout(page);
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill('WrongPass123!');
      await page.locator('button[type="submit"]').click();
      const error = page.locator('text=/неверный|дұрыс емес|invalid|wrong/i');
      await expect(error).toBeVisible({ timeout: 10000 });
    });

    test('should reject login with non-existent email', async ({ page }) => {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill(`nonexistent_${Date.now()}@samga.ai`);
      await page.locator('input[type="password"]').fill('SomePass123!');
      await page.locator('button[type="submit"]').click();
      const error = page.locator('text=/неверный|дұрыс емес|invalid|wrong/i');
      await expect(error).toBeVisible({ timeout: 10000 });
    });

    test('should show forgot password info', async ({ page }) => {
      await page.goto('/login');
      const forgotBtn = page.locator('button').filter({ hasText: /Забыли|ұмыттыңыз|Forgot/i });
      await forgotBtn.click();
      await expect(page.locator('text=/support@samga.ai|қолдау|support/i')).toBeVisible({ timeout: 10000 });
    });

    test('should redirect authenticated user away from login', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'Redirect Test', email, 'TestPass123!');
      await page.goto('/login');
      await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should redirect authenticated user away from register', async ({ page }) => {
      const email = uniqueEmail();
      await registerUser(page, 'Redirect Test', email, 'TestPass123!');
      await page.goto('/register');
      await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    });
  });

  test.describe('Logout', () => {
    test('should logout and clear tokens', async ({ page, request }) => {
      const email = uniqueEmail();
      const { token: accessToken } = await createOnboardedUser(request, 'Logout Test', email, 'TestPass123!');
      await loginAsUser(page, accessToken);

      // 2026-05-05 (v4.5): on mobile viewports the desktop sidebar is
      // hidden (lg:flex) and the logout button lives inside a drawer
      // that only mounts after the hamburger is tapped. Wait for either
      // a visible logout button (desktop) or a visible hamburger (mobile)
      // before deciding which path to take.
      await page.waitForLoadState('domcontentloaded');
      await page
        .locator('aside[aria-label="Dashboard sidebar"], header.lg\\:hidden')
        .first()
        .waitFor({ state: 'attached', timeout: 10000 });

      const visibleLogout = page
        .locator('button:has-text("Выйти"), button:has-text("Шығу"), button:has-text("Logout")')
        .filter({ visible: true })
        .first();

      if (await visibleLogout.count() === 0 || !(await visibleLogout.isVisible().catch(() => false))) {
        const hamburger = page
          .locator('button[aria-label="Открыть меню"], button[aria-label="Мәзірді ашу"]')
          .filter({ visible: true })
          .first();
        await hamburger.waitFor({ state: 'visible', timeout: 10000 });
        await hamburger.click();
        await page.locator('div[role="dialog"][aria-modal="true"]').waitFor({ state: 'visible', timeout: 5000 });
      }

      await page
        .locator('button:has-text("Выйти"), button:has-text("Шығу"), button:has-text("Logout")')
        .filter({ visible: true })
        .first()
        .click();
      await page.waitForURL(/\/login/, { timeout: 15000 });
      const token = await page.evaluate(() => localStorage.getItem('access_token'));
      expect(token).toBeNull();
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect unauthenticated user from dashboard to login', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from chat to login', async ({ page }) => {
      await page.goto('/dashboard/chat');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from profile to login', async ({ page }) => {
      await page.goto('/dashboard/profile');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from billing to login', async ({ page }) => {
      await page.goto('/dashboard/billing');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from library to login', async ({ page }) => {
      await page.goto('/dashboard/library');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from exams to login', async ({ page }) => {
      await page.goto('/dashboard/exams');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from mistakes to login', async ({ page }) => {
      await page.goto('/dashboard/mistakes');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from training to login', async ({ page }) => {
      await page.goto('/dashboard/training');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from gap-analysis to login', async ({ page }) => {
      await page.goto('/dashboard/gap-analysis');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from commuter to login', async ({ page }) => {
      await page.goto('/dashboard/commuter');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from portfolio to login', async ({ page }) => {
      await page.goto('/dashboard/portfolio');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated user from buddy to login', async ({ page }) => {
      await page.goto('/dashboard/buddy');
      await page.waitForURL(/\/login/, { timeout: 10000 });
    });
  });
});
