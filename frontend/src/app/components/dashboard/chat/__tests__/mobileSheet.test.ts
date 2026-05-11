/**
 * s34 wave 2 (G1, 2026-04-28) — vitest pins for the bottom-sheet
 * ThreadRail layout helpers.
 */

import { describe, expect, it } from "vitest";
import {
  MOBILE_SHEET_BACKDROP_OPACITY,
  MOBILE_SHEET_BREAKPOINT_PX,
  MOBILE_SHEET_MAX_HEIGHT_VH,
  isMobileViewport,
  railLayoutMode,
  shouldLockBodyScroll,
  shouldRenderBackdrop,
} from "../mobileSheet";

describe("constants", () => {
  it("breakpoint is 768px (Tailwind md)", () => {
    expect(MOBILE_SHEET_BREAKPOINT_PX).toBe(768);
  });

  it("sheet max height is 85dvh", () => {
    expect(MOBILE_SHEET_MAX_HEIGHT_VH).toBe(85);
  });

  it("backdrop opacity is 0.4", () => {
    expect(MOBILE_SHEET_BACKDROP_OPACITY).toBeCloseTo(0.4, 5);
  });
});

describe("isMobileViewport", () => {
  it("true below 768px", () => {
    expect(isMobileViewport(320)).toBe(true);
    expect(isMobileViewport(414)).toBe(true);
    expect(isMobileViewport(767)).toBe(true);
  });

  it("false at and above 768px", () => {
    expect(isMobileViewport(768)).toBe(false);
    expect(isMobileViewport(1024)).toBe(false);
    expect(isMobileViewport(1920)).toBe(false);
  });

  it("defends against null / non-finite (returns desktop)", () => {
    expect(isMobileViewport(null)).toBe(false);
    expect(isMobileViewport(undefined)).toBe(false);
    expect(isMobileViewport(NaN)).toBe(false);
    expect(isMobileViewport(Infinity)).toBe(false);
  });
});

describe("railLayoutMode", () => {
  it("returns 'sheet' on narrow viewports", () => {
    expect(railLayoutMode(320)).toBe("sheet");
    expect(railLayoutMode(767)).toBe("sheet");
  });

  it("returns 'inline' at and above breakpoint", () => {
    expect(railLayoutMode(768)).toBe("inline");
    expect(railLayoutMode(1280)).toBe("inline");
  });

  it("returns 'inline' on null width (SSR / safe default)", () => {
    expect(railLayoutMode(null)).toBe("inline");
  });
});

describe("shouldRenderBackdrop", () => {
  it("true only when open AND mobile", () => {
    expect(shouldRenderBackdrop({ open: true, width: 320 })).toBe(true);
  });

  it("false when closed even on mobile", () => {
    expect(shouldRenderBackdrop({ open: false, width: 320 })).toBe(false);
  });

  it("false when open on desktop", () => {
    expect(shouldRenderBackdrop({ open: true, width: 1280 })).toBe(false);
  });

  it("false on null/undefined width", () => {
    expect(shouldRenderBackdrop({ open: true, width: null })).toBe(false);
    expect(shouldRenderBackdrop({ open: true, width: undefined })).toBe(false);
  });
});

describe("shouldLockBodyScroll", () => {
  it("matches shouldRenderBackdrop semantics (gate is identical)", () => {
    const cases: Array<{ open: boolean; width: number | null }> = [
      { open: true, width: 320 },
      { open: false, width: 320 },
      { open: true, width: 1280 },
      { open: false, width: 1280 },
      { open: true, width: null },
    ];
    for (const c of cases) {
      expect(shouldLockBodyScroll(c)).toBe(shouldRenderBackdrop(c));
    }
  });
});
