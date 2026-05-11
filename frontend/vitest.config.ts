/**
 * Vitest config (s27, 2026-04-27).
 *
 * Standalone from `vite.config.ts` so the prod build pipeline stays
 * untouched. We only add: test runner + jsdom + alias parity.
 *
 * s35 wave 46 (2026-04-28): @testing-library/react is now wired
 * up via `src/test/setup.ts` (jest-dom matchers + afterEach
 * cleanup). Component tests live next to pure-helper tests in
 * `__tests__/` directories. Pure-helper tests don't pay any
 * cost from the setup.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      // Added s28 v2.9 (2026-04-29). No threshold yet — boss has not
      // picked one. CI publishes the report as an artifact so we can
      // observe the number trend before locking it in. To enforce a
      // floor later, add a `thresholds: { lines: N, ... }` block.
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/test/**",
        "**/tests/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "**/types.ts",
        "src/test/**",
        "src/i18n/locales/**",
        "**/dist/**",
        "**/node_modules/**",
      ],
    },
  },
});
