/**
 * v4.9 (2026-05-05) — static-source contract tests for the
 * error-boundary → telemetry wiring.
 *
 * Why static-source instead of render-based? The wiring is
 * structural (one helper call inside each Fallback function);
 * a render-based test would need to coerce three different
 * `react-error-boundary` fallbacks to throw, mock the
 * `track` import, and then assert call shape — heavyweight
 * for what is, in practice, "ensure these three lines exist".
 *
 * Static-source pin keeps regression coverage cheap. Matches
 * `feedback_static_source_contract_tests.md`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// __dirname under vitest = the test file's dir. ErrorBoundaries.tsx
// sits one level up.
const __filename = fileURLToPath(import.meta.url);
const SUT = resolve(dirname(__filename), "..", "ErrorBoundaries.tsx");
const SRC = readFileSync(SUT, "utf8");

describe("ErrorBoundaries → telemetry wiring (v4.9)", () => {
  it("imports `track` from the lib/telemetry module", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*track\s*\}\s*from\s*["']\.\.\/\.\.\/lib\/telemetry["']/,
    );
  });

  it("defines reportBoundary helper that emits `react.error_boundary`", () => {
    expect(SRC).toMatch(/function\s+reportBoundary\s*\(/);
    expect(SRC).toMatch(/track\(\s*["']react\.error_boundary["']/);
  });

  it("calls reportBoundary from each of the 3 fallback tiers", () => {
    // Each tier should call reportBoundary with its tier literal.
    expect(SRC).toMatch(/reportBoundary\(\s*["']global["']/);
    expect(SRC).toMatch(/reportBoundary\(\s*["']route["']/);
    expect(SRC).toMatch(/reportBoundary\(\s*["']feature["']/);

    // …and reportBoundary is invoked exactly 3 times (one per fallback).
    const calls = SRC.match(/reportBoundary\(/g) ?? [];
    // 3 invocations + 1 declaration = 4 occurrences of `reportBoundary(`.
    // Be lenient: just assert ≥ 3 invocations by tier-literal counting.
    const tierCalls = (
      SRC.match(/reportBoundary\(\s*["'](global|route|feature)["']/g) ?? []
    ).length;
    expect(tierCalls).toBe(3);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("preserves console.error in each fallback (browser-extension consoles still see crashes)", () => {
    expect(SRC).toMatch(/console\.error\(\s*"\[GlobalErrorBoundary\]"/);
    expect(SRC).toMatch(/console\.error\(\s*"\[RouteErrorBoundary\]"/);
    expect(SRC).toMatch(/console\.error\(\s*"\[FeatureErrorBoundary\]"/);
  });

  it("caps message+name lengths to bound the telemetry buffer entry size", () => {
    // The reportBoundary helper truncates long stack/message strings
    // before they hit the buffer. Pin the cap so future refactors don't
    // accidentally drop the truncation.
    expect(SRC).toMatch(/\.slice\(0,\s*240\)/); // message
    expect(SRC).toMatch(/\.slice\(0,\s*60\)/); // name
  });
});
