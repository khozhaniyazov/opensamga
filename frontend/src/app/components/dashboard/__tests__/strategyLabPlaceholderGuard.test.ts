import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v3.73 (B18, 2026-05-02): static-source contract test pinning the
 * Strategy Lab "0 placeholder" row guard.
 *
 * Bug recap: the data-quality box always rendered the placeholder
 * row, even when `placeholderThresholds === 0`. Output:
 *   "0 placeholder · 0 записей посчитаны неизвестными"
 * which is internally contradictory (the value reads "0 records
 * counted as unknown" while the hint copy talks about
 * placeholder records being a real concern). v3.73 hides the row
 * entirely when the count is 0 — the Trust + Decision rows below
 * still convey the "verify with the official source" message.
 *
 * Static-source test because StrategyLabPage pulls AuthContext +
 * LanguageProvider + apiGet + react-router and the change here is
 * purely structural (a `placeholderThresholds > 0 ? ... : null`
 * gate around an existing block).
 */

const SUT = resolve(__dirname, "..", "StrategyLabPage.tsx");

function readSource(): string {
  return readFileSync(SUT, "utf8");
}

describe("StrategyLabPage — v3.73 placeholder row guard (B18)", () => {
  it("wraps the '0 placeholder' ReportRow in a `placeholderThresholds > 0` gate", () => {
    const src = readSource();
    // The new shape:
    //   {placeholderThresholds > 0 ? (
    //     <ReportRow label="0 placeholder" ... />
    //   ) : null}
    expect(src).toMatch(
      /placeholderThresholds\s*>\s*0\s*\?\s*\(?\s*<ReportRow[\s\S]{0,300}label=["']0 placeholder["']/,
    );
  });

  it("does NOT introduce a separate label fork for KZ vs RU on this row", () => {
    const src = readSource();
    // Pre-v3.73 was `label={isKz ? "0 placeholder" : "0 placeholder"}` —
    // a redundant ternary that was forced by surrounding JSX style.
    // The single literal label is fine because "placeholder" is not
    // translated for either locale (the i18n live in the value string).
    expect(src).not.toMatch(/label=\{\s*isKz\s*\?\s*["']0 placeholder["']/);
  });

  it("keeps the Trust + Decision rows unconditional", () => {
    const src = readSource();
    expect(src).toMatch(/label=\{\s*isKz\s*\?\s*["']Сенімділік["']/);
    expect(src).toMatch(/label=\{\s*isKz\s*\?\s*["']Шешім["']/);
  });
});
