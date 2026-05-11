/**
 * s34 wave 3 (G5 wave 2, 2026-04-28) — vitest pins for tap-target
 * Tailwind class helpers.
 */

import { describe, expect, it } from "vitest";
import {
  TAP_TARGET_ROW_CLASS,
  TAP_TARGET_SQUARE_CLASS,
  hasRowTapTarget,
  hasSquareTapTarget,
  tapTargetClassMatchesThreshold,
} from "../tapTarget";

describe("constants", () => {
  it("square class is min-h-[44px] min-w-[44px]", () => {
    expect(TAP_TARGET_SQUARE_CLASS).toBe("min-h-[44px] min-w-[44px]");
  });

  it("row class is min-h-[44px] only (width content-driven)", () => {
    expect(TAP_TARGET_ROW_CLASS).toBe("min-h-[44px]");
  });
});

describe("hasSquareTapTarget", () => {
  it("true when both min-h and min-w are present", () => {
    expect(hasSquareTapTarget("min-h-[44px] min-w-[44px] inline-flex")).toBe(
      true,
    );
  });

  it("true regardless of class ordering", () => {
    expect(hasSquareTapTarget("inline-flex min-w-[44px] min-h-[44px]")).toBe(
      true,
    );
  });

  it("false when only one dimension is present", () => {
    expect(hasSquareTapTarget("min-h-[44px] inline-flex")).toBe(false);
    expect(hasSquareTapTarget("min-w-[44px] inline-flex")).toBe(false);
  });

  it("false on h-11 / w-11 alternatives (we standardize on min-h/min-w)", () => {
    expect(hasSquareTapTarget("h-11 w-11 inline-flex")).toBe(false);
  });

  it("false on null / non-string", () => {
    expect(hasSquareTapTarget(null as unknown as string)).toBe(false);
    expect(hasSquareTapTarget(undefined as unknown as string)).toBe(false);
    expect(hasSquareTapTarget(42 as unknown as string)).toBe(false);
  });
});

describe("hasRowTapTarget", () => {
  it("true when min-h is present (width unconstrained)", () => {
    expect(hasRowTapTarget("min-h-[44px] flex w-full")).toBe(true);
  });

  it("false when min-h is missing", () => {
    expect(hasRowTapTarget("flex w-full px-3 py-2")).toBe(false);
  });
});

describe("tapTargetClassMatchesThreshold", () => {
  it("flags drift between numeric threshold and class string", () => {
    expect(tapTargetClassMatchesThreshold()).toBe(true);
  });
});
