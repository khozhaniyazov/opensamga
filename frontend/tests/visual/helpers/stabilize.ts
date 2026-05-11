import { Page, Locator } from "@playwright/test";

/**
 * Stabilize a page before taking a screenshot:
 * 1. Wait for network idle.
 * 2. Hide dynamic / animated elements.
 * 3. Freeze Date.now so timestamps don't drift.
 * 4. Mask avatar images.
 * 5. Wait 300ms after fonts are reported loaded.
 */
export async function stabilize(page: Page): Promise<void> {
  // 1. Network idle
  await page.waitForLoadState("networkidle");

  // 2. Hide dynamic elements via CSS injection
  await page.addStyleTag({
    content: `
      [data-dynamic],
      .animate-pulse,
      .skeleton,
      [class*="skeleton"],
      [class*="animate-pulse"],
      [class*="shimmer"],
      [class*="loading"],
      .Toastify__toast-container,
      [role="status"][aria-live="polite"] {
        visibility: hidden !important;
      }
      /* Keep canvas visible but pause any animation loops if possible */
      canvas {
        animation: none !important;
      }
    `,
  });

  // 3. Freeze Date.now and timers
  await page.evaluate(() => {
    const frozen = Date.now();
    // @ts-ignore
    Date._realNow = Date.now;
    Date.now = () => frozen;
  });

  // 4. Mask avatar images (replace src with transparent pixel)
  await page.evaluate(() => {
    const imgs = document.querySelectorAll('img[src*="avatar"], img[alt*="avatar" i]');
    imgs.forEach((img) => {
      (img as HTMLImageElement).src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    });
  });

  // 5. Wait for fonts (document.fonts.ready) then small buffer
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  // Scroll to top to ensure deterministic viewport
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Build the default mask locators for a page.
 */
export function defaultMasks(page: Page): Locator[] {
  return [
    page.locator("[data-mask]"),
    page.locator("[data-dynamic]"),
    page.locator(".animate-pulse"),
    page.locator(".Toastify__toast-container"),
  ];
}
