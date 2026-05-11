/**
 * s29 (D1, 2026-04-27) — SkeletonBubble gating predicate pin.
 *
 * The component itself uses `useEffect` + `useState` + a 300 ms
 * window.setTimeout, so until @testing-library/react lands we
 * exercise the pure gating helper that decides whether to render
 * shimmer at all.
 *
 * The 300 ms grace itself is a constant export (`skeletonGraceMs`);
 * we pin its value so a future bump is intentional, not a typo.
 */
import { describe, it, expect } from "vitest";
import { shouldShowSkeleton, skeletonGraceMs } from "../SkeletonBubble";

describe("shouldShowSkeleton", () => {
  it("hides when not streaming", () => {
    expect(
      shouldShowSkeleton({
        isStreaming: false,
        hasText: false,
        hasReasoning: false,
      }),
    ).toBe(false);
  });
  it("hides once prose has landed", () => {
    expect(
      shouldShowSkeleton({
        isStreaming: true,
        hasText: true,
        hasReasoning: false,
      }),
    ).toBe(false);
  });
  it("hides while ReasoningPanel is showing tool/thinking activity", () => {
    expect(
      shouldShowSkeleton({
        isStreaming: true,
        hasText: false,
        hasReasoning: true,
      }),
    ).toBe(false);
  });
  it("shows during the empty-streaming window", () => {
    expect(
      shouldShowSkeleton({
        isStreaming: true,
        hasText: false,
        hasReasoning: false,
      }),
    ).toBe(true);
  });
  it("hasText wins even when hasReasoning is also true", () => {
    expect(
      shouldShowSkeleton({
        isStreaming: true,
        hasText: true,
        hasReasoning: true,
      }),
    ).toBe(false);
  });
});

describe("skeletonGraceMs", () => {
  it("is pinned at 300ms (intentional bump required to change)", () => {
    expect(skeletonGraceMs).toBe(300);
  });
});
