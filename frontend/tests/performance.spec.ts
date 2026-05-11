import { test, expect } from '@playwright/test';
import { createOnboardedUser, loginAsUser, logout } from './helpers';

const uniqueEmail = () => `e2e_perf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@samga.ai`;

test.describe('Performance', () => {
  test.beforeEach(async ({ page }) => {
    await logout(page);
  });

  test('landing page should load within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Landing page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(3000);
  });

  test('login page should load within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Login page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(3000);
  });

  test('dashboard should load within 5 seconds after login', async ({ page, request }) => {
    const email = uniqueEmail();
    const start = Date.now();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Dashboard load time after login: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5000);
  });

  test('chat page should load within 3 seconds', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const start = Date.now();
    await page.goto('/dashboard/chat');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Chat page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(3000);
  });

  test('library page should load within 5 seconds', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const start = Date.now();
    await page.goto('/dashboard/library');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Library page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5000);
  });

  test('universities page should load within 5 seconds', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const start = Date.now();
    await page.goto('/dashboard/universities');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Universities page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5000);
  });

  test('profile page should load within 3 seconds', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const start = Date.now();
    await page.goto('/dashboard/profile');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;
    console.log(`Profile page load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(3000);
  });

  test('no console errors on dashboard load', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
  });

  test('no console errors on chat page', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.goto('/dashboard/chat');
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
  });

  test('no failed network requests on initial load', async ({ page, request }) => {
    const failed: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('/api/')) {
        failed.push(`${resp.url()} -> ${resp.status()}`);
      }
    });
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    await page.waitForTimeout(3000);
    expect(failed).toEqual([]);
  });

  test('LCP should be under 2.5s on landing page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const lcp = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          resolve(last?.startTime || 0);
        });
        observer.observe({ entryTypes: ['largest-contentful-paint'] });
        setTimeout(() => resolve(0), 5000);
      });
    });
    console.log(`LCP: ${lcp}ms`);
    expect(lcp).toBeLessThan(2500);
  });

  test('CLS should be near zero on dashboard', async ({ page, request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'Perf Test', email, 'TestPass123!');
    await loginAsUser(page, token);
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
            }
          }
        });
        observer.observe({ entryTypes: ['layout-shift'] });
        setTimeout(() => resolve(clsValue), 3000);
      });
    });
    console.log(`CLS: ${cls}`);
    expect(cls).toBeLessThan(0.1);
  });
});
