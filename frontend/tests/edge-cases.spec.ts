import { test, expect, type Page } from '@playwright/test';
import { createOnboardedUser, loginAsUser, logout } from './helpers';

const uniqueEmail = () => `e2e_edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@samga.ai`;

// v4.15 (2026-05-08): Four specs in this file (fast-typing,
// 10-rapid, emoji-flood, RTL) asserted on
// `page.locator('text=...')` after sending a chat message. After
// send, the user's text appears in *three* DOM places
// simultaneously:
//   1) sidebar thread list button (thread title)
//   2) conversation header <h1> (thread title)
//   3) the <log role=log> body inside <main>
//
// Unscoped `text=...` hits strict-mode violation with three
// matches. Scope every post-send assertion to the chat log by
// role to match exactly the message body.
//
// 10-rapid-messages had an additional failure mode: textarea
// goes `disabled` while streaming. A 200ms sleep between sends
// wasn't enough — subsequent `.fill()` calls timed out waiting
// for the element to be enabled. `waitUntilComposerReady()`
// polls for the not-disabled state before each fill.
async function waitUntilComposerReady(page: Page, timeout = 15000) {
  await page
    .locator('textarea, input[type="text"]')
    .first()
    .waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('textarea, input[type="text"]') as
        | HTMLTextAreaElement
        | HTMLInputElement
        | null;
      return !!el && !el.disabled;
    },
    undefined,
    { timeout },
  );
}

test.describe('Edge Cases & Stress Tests', () => {
  test.beforeEach(async ({ page }) => {
    await logout(page);
  });

  test('should handle back button after logout', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Edge Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.locator('button:has-text("Выйти") , button:has-text("Шығу") , button:has-text("Logout")').first().click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.goBack();
    // Should redirect to login again
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should handle multiple tabs with shared localStorage', async ({ browser, request }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Tab Test', email, 'TestPass123!');
    await loginAsUser(page1, token);

    const page2 = await context.newPage();
    await loginAsUser(page2, token);
    await expect(page2).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Logout from page1
    await page1.locator('button:has-text("Выйти") , button:has-text("Шығу") , button:has-text("Logout")').first().click();
    await page1.waitForURL(/\/login/, { timeout: 15000 });

    // page2 should also be logged out on next navigation
    await page2.goto('/dashboard/chat');
    await expect(page2).toHaveURL(/\/login/, { timeout: 10000 });

    await context.close();
  });

  test('should handle page refresh on chat page', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Refresh Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await page.waitForSelector('textarea, input[type="text"]', { timeout: 15000 });
    await page.reload();
    await page.waitForSelector('textarea, input[type="text"]', { timeout: 15000 });
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible();
  });

  test('should handle rapid page navigation', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Nav Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const routes = ['/dashboard', '/dashboard/chat', '/dashboard/library', '/dashboard/universities', '/dashboard/profile'];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle very long URL path', async ({ page }) => {
    const longPath = '/dashboard/' + 'a'.repeat(500);
    await page.goto(longPath);
    // Should not crash, should show 404 or redirect
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle URL with special characters', async ({ page }) => {
    await page.goto('/dashboard/chat?test=<script>alert(1)</script>');
    const alertTriggered = await page.evaluate(() => (window as any).__alertTriggered);
    expect(alertTriggered).toBeUndefined();
  });

  test('should handle network offline gracefully', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Offline Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await page.waitForSelector('textarea, input[type="text"]', { timeout: 15000 });

    await page.context().setOffline(true);
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Offline message');
    await input.press('Enter');

    // Should not crash; may show error or retry
    await expect(page.locator('body')).toBeVisible();
    await page.context().setOffline(false);
  });

  test('should handle very fast typing in chat', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Typing Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await waitUntilComposerReady(page);
    const input = page.locator('textarea, input[type="text"]').first();
    const typed = 'This is a test message typed very fast';
    await input.fill(typed);
    await input.press('Enter');
    // Scope to the chat log to bypass the sidebar + <h1> duplicates.
    await expect(page.getByRole('log').getByText(typed, { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should handle browser resize without errors', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Resize Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard');

    const sizes = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should handle 10 rapid chat messages without crash', async ({ page, request }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Stress Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await waitUntilComposerReady(page);
    const input = page.locator('textarea, input[type="text"]').first();

    for (let i = 0; i < 10; i++) {
      // Agent-loop stream disables the textarea while the model is
      // responding; wait for it to re-enable before the next fill
      // rather than relying on a fixed sleep.
      await waitUntilComposerReady(page);
      await input.fill(`Stress message ${i}`);
      await input.press('Enter');
    }

    // Last message should land in the chat log (not the thread
    // sidebar, which truncates to the first message's title).
    await expect(page.getByRole('log').getByText('Stress message 9', { exact: true })).toBeVisible({
      timeout: 15000,
    });
  });

  test('should handle SQL injection attempt in chat', async ({ page, request }) => {
    test.setTimeout(60_000);
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'SQL Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await waitUntilComposerReady(page);
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill("'; DROP TABLE users; --");
    await input.press('Enter');
    await expect(page.locator('body')).toBeVisible();
    // Agent-loop reply to the first prompt can take >15s here, so
    // wait on the composer-ready helper with a 30s ceiling before
    // the second fill — the action-timeout on `.fill()` (15s per
    // playwright.config.ts) isn't long enough on a cold backend.
    await waitUntilComposerReady(page, 30_000);
    await input.fill('After SQL attempt');
    await input.press('Enter');
    await expect(page.getByRole('log').getByText('After SQL attempt', { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test('should handle XSS attempt in profile name', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, '<script>alert(1)</script>', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/profile');
    await page.waitForTimeout(2000);
    // Check if script tag is rendered as text, not executed
    const hasScript = await page.evaluate(() => {
      return document.querySelector('script') !== null && document.querySelector('script')?.innerHTML.includes('alert(1)');
    });
    expect(hasScript).toBe(false);
  });

  test('should handle emoji flood in chat', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Emoji Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await waitUntilComposerReady(page);
    const input = page.locator('textarea, input[type="text"]').first();
    const emojis = '🎓'.repeat(100);
    await input.fill(emojis);
    await input.press('Enter');
    // Scope to the chat log; the sidebar + <h1> truncate the string
    // which also makes an unscoped regex match 3 elements.
    await expect(page.getByRole('log').getByText(/🎓/).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should handle right-to-left text', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'RTL Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await waitUntilComposerReady(page);
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('مرحبا بالعالم');
    await input.press('Enter');
    await expect(page.getByRole('log').getByText(/مرحبا/)).toBeVisible({
      timeout: 10000,
    });
  });
});
