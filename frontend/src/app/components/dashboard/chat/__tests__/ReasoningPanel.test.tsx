/**
 * s29 (D2, 2026-04-27) — stepSubheaderLabel pin.
 *
 * The component itself is hooks-heavy (timers, contexts, memoization)
 * so until @testing-library/react lands we exercise the pure label
 * helper that drives the streaming-only "Шаг N" / "N-қадам" chip.
 *
 * Pinning bilingual copy + the gating contract (hide on done, hide
 * on iteration < 1) covers the full surface a regression could break.
 */
import { describe, it, expect } from "vitest";
import { stepSubheaderLabel } from "../ReasoningPanel";

describe("stepSubheaderLabel", () => {
  it("returns null when not streaming (post-run summary owns the count)", () => {
    expect(
      stepSubheaderLabel({ isStreaming: false, currentStep: 2, lang: "ru" }),
    ).toBeNull();
  });
  it("returns null when no iterations have fired yet", () => {
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: 0, lang: "ru" }),
    ).toBeNull();
  });
  it("returns null on negative or non-finite step counters", () => {
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: -1, lang: "ru" }),
    ).toBeNull();
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: NaN, lang: "ru" }),
    ).toBeNull();
  });
  it("Russian label includes step number", () => {
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: 1, lang: "ru" }),
    ).toBe("Шаг 1");
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: 4, lang: "ru" }),
    ).toBe("Шаг 4");
  });
  it("Kazakh label uses ordinal suffix", () => {
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: 1, lang: "kz" }),
    ).toBe("1-қадам");
    expect(
      stepSubheaderLabel({ isStreaming: true, currentStep: 3, lang: "kz" }),
    ).toBe("3-қадам");
  });
});
