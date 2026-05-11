import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for accessibility (axe-core) sweeps.
 *
 * Intentionally separate from tests/visual/visual.config.ts so we can run the
 * two test types independently.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../../test-results/a11y/results.json" }]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15000,
    navigationTimeout: 20000,
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    contextOptions: {
      reducedMotion: "reduce",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: "../../test-results/a11y",
});
