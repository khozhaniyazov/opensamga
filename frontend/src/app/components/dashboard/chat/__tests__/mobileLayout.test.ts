/**
 * s33 wave 3 (G3+G5) — vitest pins for the mobile-layout helpers.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_TAP_TARGET_PX,
  NARROW_VIEWPORT_PX,
  carouselLayoutMode,
  isViewportNarrow,
  meetsTapTarget,
} from "../mobileLayout";

describe("constants", () => {
  it("narrow viewport trip point is 380px", () => {
    expect(NARROW_VIEWPORT_PX).toBe(380);
  });

  it("min tap target is 44px (AAA)", () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
  });
});

describe("isViewportNarrow", () => {
  it("true below the trip point", () => {
    expect(isViewportNarrow(320)).toBe(true);
    expect(isViewportNarrow(360)).toBe(true);
    expect(isViewportNarrow(379)).toBe(true);
  });

  it("false at and above the trip point", () => {
    expect(isViewportNarrow(380)).toBe(false);
    expect(isViewportNarrow(420)).toBe(false);
    expect(isViewportNarrow(1280)).toBe(false);
  });

  it("defends against null / non-finite", () => {
    expect(isViewportNarrow(null)).toBe(false);
    expect(isViewportNarrow(undefined)).toBe(false);
    expect(isViewportNarrow(NaN)).toBe(false);
    expect(isViewportNarrow(Infinity)).toBe(false);
  });
});

describe("meetsTapTarget", () => {
  it("true at exactly 44x44", () => {
    expect(meetsTapTarget({ width: 44, height: 44 })).toBe(true);
  });

  it("true above 44x44 in both dimensions", () => {
    expect(meetsTapTarget({ width: 80, height: 60 })).toBe(true);
  });

  it("false when either dimension falls short", () => {
    expect(meetsTapTarget({ width: 43, height: 44 })).toBe(false);
    expect(meetsTapTarget({ width: 44, height: 43 })).toBe(false);
    expect(meetsTapTarget({ width: 20, height: 20 })).toBe(false);
  });

  it("supports custom minPx override", () => {
    expect(meetsTapTarget({ width: 30, height: 30, minPx: 28 })).toBe(true);
    expect(meetsTapTarget({ width: 30, height: 30, minPx: 32 })).toBe(false);
  });

  it("defends against null / non-finite inputs", () => {
    expect(meetsTapTarget({ width: null, height: 44 })).toBe(false);
    expect(meetsTapTarget({ width: 44, height: null })).toBe(false);
    expect(meetsTapTarget({ width: NaN, height: 44 })).toBe(false);
  });
});

describe("carouselLayoutMode", () => {
  it("scroll-rail when itemCount <= 2 regardless of width", () => {
    expect(carouselLayoutMode({ width: 320, itemCount: 1 })).toBe(
      "scroll-rail",
    );
    expect(carouselLayoutMode({ width: 320, itemCount: 2 })).toBe(
      "scroll-rail",
    );
  });

  it("scroll-rail on wide viewport even with many items", () => {
    expect(carouselLayoutMode({ width: 1280, itemCount: 5 })).toBe(
      "scroll-rail",
    );
  });

  it("wrapped-grid on narrow viewport with >=3 items", () => {
    expect(carouselLayoutMode({ width: 320, itemCount: 3 })).toBe(
      "wrapped-grid",
    );
    expect(carouselLayoutMode({ width: 360, itemCount: 4 })).toBe(
      "wrapped-grid",
    );
  });

  it("scroll-rail on null/undefined width (assume desktop)", () => {
    expect(carouselLayoutMode({ width: null, itemCount: 5 })).toBe(
      "scroll-rail",
    );
    expect(carouselLayoutMode({ width: undefined, itemCount: 5 })).toBe(
      "scroll-rail",
    );
  });
});
