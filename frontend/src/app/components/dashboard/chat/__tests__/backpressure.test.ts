/**
 * s33 (D6) — vitest pins for the backpressure helpers.
 */

import { describe, expect, it } from "vitest";
import {
  BACKPRESSURE_LAG_THRESHOLD_MS,
  BACKPRESSURE_POLL_MS,
  backpressureLabel,
  isRealDelta,
  shouldShowBackpressure,
} from "../backpressure";

describe("constants", () => {
  it("threshold is 3500ms", () => {
    expect(BACKPRESSURE_LAG_THRESHOLD_MS).toBe(3500);
  });
  it("poll cadence is 500ms", () => {
    expect(BACKPRESSURE_POLL_MS).toBe(500);
  });
});

describe("shouldShowBackpressure", () => {
  it("hidden when not sending", () => {
    expect(
      shouldShowBackpressure({
        isSending: false,
        lastDeltaAt: 0,
        now: 100_000,
      }),
    ).toBe(false);
  });

  it("hidden when lastDeltaAt is null (no real delta yet)", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: null,
        now: 100_000,
      }),
    ).toBe(false);
  });

  it("hidden when lag is below threshold", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: 100_000,
        now: 100_000 + 3000,
      }),
    ).toBe(false);
  });

  it("shown at threshold (>=)", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: 100_000,
        now: 100_000 + BACKPRESSURE_LAG_THRESHOLD_MS,
      }),
    ).toBe(true);
  });

  it("shown when lag is well above threshold", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: 100_000,
        now: 100_000 + 10_000,
      }),
    ).toBe(true);
  });

  it("supports custom thresholdMs override", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: 100_000,
        now: 100_000 + 1500,
        thresholdMs: 1000,
      }),
    ).toBe(true);
  });

  it("defends against non-finite inputs", () => {
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: NaN,
        now: 100_000,
      }),
    ).toBe(false);
    expect(
      shouldShowBackpressure({
        isSending: true,
        lastDeltaAt: 100_000,
        now: NaN,
      }),
    ).toBe(false);
  });
});

describe("isRealDelta", () => {
  it("true on growth that prepends prev text", () => {
    expect(isRealDelta("hello", "hello world")).toBe(true);
  });

  it("true when prev was empty (first delta)", () => {
    expect(isRealDelta("", "first chunk")).toBe(true);
  });

  it("false on equal length (no growth)", () => {
    expect(isRealDelta("hello", "hello")).toBe(false);
  });

  it("false on shrink (likely a remount/reset)", () => {
    expect(isRealDelta("hello world", "hello")).toBe(false);
  });

  it("false on growth that does NOT prepend prev (suspicious mutation)", () => {
    // Some kind of parts-prefix swap that ate prior chars — we
    // refuse to count it because it's likely a remount, not a real
    // SSE delta.
    expect(isRealDelta("hello", "ahello world")).toBe(false);
  });

  it("defends against null / undefined / non-string inputs", () => {
    expect(isRealDelta(null, "hi")).toBe(true);
    expect(isRealDelta(undefined, "hi")).toBe(true);
    expect(isRealDelta("hi", null)).toBe(false);
    expect(isRealDelta("hi", undefined)).toBe(false);
  });
});

describe("backpressureLabel", () => {
  it("returns RU label", () => {
    expect(backpressureLabel("ru")).toContain("медленная");
  });
  it("returns KZ label", () => {
    expect(backpressureLabel("kz")).toContain("баяу");
  });
});
