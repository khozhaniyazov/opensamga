/**
 * s35 wave 47 (2026-04-28) — vitest pins for message-bubble
 * virtualization helpers.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_INTRINSIC_HEIGHT_PX,
  DEFAULT_TAIL_KEEP_COUNT,
  MIN_THREAD_LENGTH_FOR_OPTIMIZATION,
  messageVirtualizationStyle,
  shouldOptimizeMessage,
} from "../messageVirtualization";

describe("constants", () => {
  it("default intrinsic height is 240px (median bubble height)", () => {
    expect(DEFAULT_INTRINSIC_HEIGHT_PX).toBe(240);
  });

  it("default tail-keep is 5 (≈ visible viewport)", () => {
    expect(DEFAULT_TAIL_KEEP_COUNT).toBe(5);
  });

  it("min thread length for optimization is 12", () => {
    expect(MIN_THREAD_LENGTH_FOR_OPTIMIZATION).toBe(12);
  });
});

describe("shouldOptimizeMessage — short threads", () => {
  it("does not optimize empty thread", () => {
    expect(shouldOptimizeMessage({ index: 0, total: 0 })).toBe(false);
  });

  it("does not optimize when total < MIN_THREAD_LENGTH_FOR_OPTIMIZATION", () => {
    for (let i = 0; i < 11; i++) {
      expect(shouldOptimizeMessage({ index: i, total: 11 })).toBe(false);
    }
  });

  it("starts optimizing at exactly the threshold (12)", () => {
    // total=12, default tail=5 → optimize first 7 (indexes 0-6).
    expect(shouldOptimizeMessage({ index: 0, total: 12 })).toBe(true);
    expect(shouldOptimizeMessage({ index: 6, total: 12 })).toBe(true);
    expect(shouldOptimizeMessage({ index: 7, total: 12 })).toBe(false);
    expect(shouldOptimizeMessage({ index: 11, total: 12 })).toBe(false);
  });
});

describe("shouldOptimizeMessage — tail-keep", () => {
  it("96-message thread keeps last 5 unoptimized (default)", () => {
    // The boss's actual 96-message thread.
    expect(shouldOptimizeMessage({ index: 0, total: 96 })).toBe(true);
    expect(shouldOptimizeMessage({ index: 90, total: 96 })).toBe(true);
    // index 91 is total-tail = 96-5 = 91 → cutoff is exclusive.
    expect(shouldOptimizeMessage({ index: 91, total: 96 })).toBe(false);
    expect(shouldOptimizeMessage({ index: 95, total: 96 })).toBe(false);
  });

  it("custom tail-keep=10", () => {
    expect(
      shouldOptimizeMessage({ index: 85, total: 96, tailKeepCount: 10 }),
    ).toBe(true);
    expect(
      shouldOptimizeMessage({ index: 86, total: 96, tailKeepCount: 10 }),
    ).toBe(false);
  });

  it("tail-keep=0 optimizes every off-screen message including last", () => {
    expect(
      shouldOptimizeMessage({ index: 95, total: 96, tailKeepCount: 0 }),
    ).toBe(true);
  });
});

describe("shouldOptimizeMessage — defensive coercion", () => {
  it("negative index → false", () => {
    expect(shouldOptimizeMessage({ index: -1, total: 50 })).toBe(false);
  });

  it("index >= total → false (out of bounds)", () => {
    expect(shouldOptimizeMessage({ index: 50, total: 50 })).toBe(false);
    expect(shouldOptimizeMessage({ index: 100, total: 50 })).toBe(false);
  });

  it("NaN / Infinity inputs fall through safely", () => {
    expect(shouldOptimizeMessage({ index: NaN as never, total: 50 })).toBe(
      false,
    );
    expect(shouldOptimizeMessage({ index: 5, total: Infinity as never })).toBe(
      false,
    );
  });
});

describe("messageVirtualizationStyle", () => {
  it("returns empty object when optimization is off", () => {
    expect(messageVirtualizationStyle({ index: 0, total: 5 })).toEqual({});
    expect(messageVirtualizationStyle({ index: 95, total: 96 })).toEqual({});
  });

  it("returns content-visibility + contain-intrinsic-size when on", () => {
    const style = messageVirtualizationStyle({ index: 0, total: 96 });
    expect(style.contentVisibility).toBe("auto");
    expect(style.containIntrinsicSize).toBe("auto 240px");
  });

  it("custom intrinsic height", () => {
    const style = messageVirtualizationStyle({
      index: 0,
      total: 96,
      intrinsicHeightPx: 320,
    });
    expect(style.containIntrinsicSize).toBe("auto 320px");
  });

  it("falls back to default height when intrinsic is invalid", () => {
    const style = messageVirtualizationStyle({
      index: 0,
      total: 96,
      intrinsicHeightPx: NaN as never,
    });
    expect(style.containIntrinsicSize).toBe("auto 240px");
  });

  it("returned object has no other CSS properties", () => {
    const style = messageVirtualizationStyle({ index: 0, total: 96 });
    expect(Object.keys(style).sort()).toEqual([
      "containIntrinsicSize",
      "contentVisibility",
    ]);
  });
});

describe("purity", () => {
  it("same input → same output (predicate)", () => {
    const a = shouldOptimizeMessage({ index: 5, total: 50 });
    const b = shouldOptimizeMessage({ index: 5, total: 50 });
    expect(a).toBe(b);
  });

  it("same input → equal output (style)", () => {
    const a = messageVirtualizationStyle({ index: 5, total: 50 });
    const b = messageVirtualizationStyle({ index: 5, total: 50 });
    expect(a).toEqual(b);
  });
});
