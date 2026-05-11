/**
 * s35 wave 46 (2026-04-28) — vitest setup file.
 *
 * Wires `@testing-library/jest-dom` matchers (toBeInTheDocument,
 * toHaveTextContent, toHaveAttribute, …) into vitest's `expect`,
 * and registers an automatic afterEach cleanup so DOM nodes from
 * one test never bleed into the next.
 *
 * Loaded by `vitest.config.ts` → `setupFiles`. Pure-helper tests
 * that don't render don't pay any cost: `cleanup()` is a no-op
 * when nothing has mounted, and the matcher imports are tree-
 * shaken at module level.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
