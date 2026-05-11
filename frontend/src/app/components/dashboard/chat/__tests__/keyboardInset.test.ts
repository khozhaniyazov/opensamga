/**
 * s34 wave 2 (G2, 2026-04-28) — vitest pins for the virtual-keyboard
 * inset math.
 */

import { describe, expect, it } from "vitest";
import {
  KEYBOARD_INSET_MAX_PX,
  KEYBOARD_INSET_NOISE_FLOOR_PX,
  composerPaddingBottomCss,
  computeKeyboardInset,
  isKeyboardLifted,
  shouldTrackKeyboardInset,
} from "../keyboardInset";

describe("constants", () => {
  it("noise floor is 80px", () => {
    expect(KEYBOARD_INSET_NOISE_FLOOR_PX).toBe(80);
  });

  it("max inset is 600px", () => {
    expect(KEYBOARD_INSET_MAX_PX).toBe(600);
  });
});

describe("computeKeyboardInset", () => {
  it("returns 0 when layout matches visual (no keyboard)", () => {
    expect(computeKeyboardInset(800, 800)).toBe(0);
  });

  it("returns the delta when keyboard is up", () => {
    expect(computeKeyboardInset(800, 480)).toBe(320);
    expect(computeKeyboardInset(926, 580)).toBe(346); // iPhone Pro Max landscape-ish
  });

  it("returns 0 below the noise floor (browser chrome flicker)", () => {
    expect(computeKeyboardInset(800, 750)).toBe(0); // delta=50 < 80
    expect(computeKeyboardInset(800, 721)).toBe(0); // delta=79 < 80
  });

  it("starts reporting at the noise floor exactly", () => {
    expect(computeKeyboardInset(800, 720)).toBe(80); // delta=80
  });

  it("caps at KEYBOARD_INSET_MAX_PX", () => {
    expect(computeKeyboardInset(800, 100)).toBe(600); // delta=700, capped
  });

  it("rounds float deltas", () => {
    expect(computeKeyboardInset(800.4, 480.2)).toBe(320);
  });

  it("returns 0 for non-finite or non-positive inputs", () => {
    expect(computeKeyboardInset(null, 480)).toBe(0);
    expect(computeKeyboardInset(800, undefined)).toBe(0);
    expect(computeKeyboardInset(NaN, 480)).toBe(0);
    expect(computeKeyboardInset(800, -100)).toBe(0);
    expect(computeKeyboardInset(0, 480)).toBe(0);
  });

  it("returns 0 if visual exceeds layout (browser bug guard)", () => {
    // negative delta: should never lift the composer
    expect(computeKeyboardInset(700, 800)).toBe(0);
  });
});

describe("composerPaddingBottomCss", () => {
  it("safe-area only when no keyboard", () => {
    expect(composerPaddingBottomCss(0)).toBe(
      "max(1rem, env(safe-area-inset-bottom))",
    );
  });

  it("layers keyboard inset on top of safe-area when lifted", () => {
    expect(composerPaddingBottomCss(320)).toBe(
      "calc(max(1rem, env(safe-area-inset-bottom)) + 320px)",
    );
  });

  it("clamps negative input back to safe-area only", () => {
    expect(composerPaddingBottomCss(-50)).toBe(
      "max(1rem, env(safe-area-inset-bottom))",
    );
  });

  it("rounds the px contribution", () => {
    expect(composerPaddingBottomCss(120.7)).toBe(
      "calc(max(1rem, env(safe-area-inset-bottom)) + 121px)",
    );
  });
});

describe("isKeyboardLifted", () => {
  it("true for any positive inset", () => {
    expect(isKeyboardLifted(1)).toBe(true);
    expect(isKeyboardLifted(320)).toBe(true);
  });

  it("false for zero or negative", () => {
    expect(isKeyboardLifted(0)).toBe(false);
    expect(isKeyboardLifted(-1)).toBe(false);
  });
});

describe("shouldTrackKeyboardInset (s35 wave 43)", () => {
  it("touchscreen phone (Chrome Android)", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: true,
        coarsePointerMatches: true,
        hasVisualViewport: true,
      }),
    ).toBe(true);
  });

  it("touchscreen phone (iOS Safari) — coarse pointer alone", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: true,
        coarsePointerMatches: true,
        hasVisualViewport: true,
      }),
    ).toBe(true);
  });

  it("touchscreen Windows laptop without ontouchstart but coarse pointer", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: false,
        coarsePointerMatches: true,
        hasVisualViewport: true,
      }),
    ).toBe(true);
  });

  it("regression: desktop Chrome with mouse — no track (THE bug fix)", () => {
    // visualViewport present, but no touch + fine pointer →
    // hook must not subscribe; otherwise spurious deltas push
    // composer padding to hundreds of px.
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: false,
        coarsePointerMatches: false,
        hasVisualViewport: true,
      }),
    ).toBe(false);
  });

  it("desktop Firefox without matchMedia (coarse=null) — no track", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: false,
        coarsePointerMatches: null,
        hasVisualViewport: true,
      }),
    ).toBe(false);
  });

  it("touch device but visualViewport API missing — no track", () => {
    // We can't measure the inset without the API, so don't
    // pretend we can.
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: true,
        coarsePointerMatches: true,
        hasVisualViewport: false,
      }),
    ).toBe(false);
  });

  it("SSR-shaped env (everything false/null) — no track", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: false,
        coarsePointerMatches: null,
        hasVisualViewport: false,
      }),
    ).toBe(false);
  });

  it("touch device with no coarse-pointer media-query support but ontouchstart present", () => {
    expect(
      shouldTrackKeyboardInset({
        hasTouchStart: true,
        coarsePointerMatches: null,
        hasVisualViewport: true,
      }),
    ).toBe(true);
  });

  it("purity: same input → same output", () => {
    const env = {
      hasTouchStart: false,
      coarsePointerMatches: false,
      hasVisualViewport: true,
    };
    const a = shouldTrackKeyboardInset(env);
    const b = shouldTrackKeyboardInset(env);
    expect(a).toBe(b);
    expect(a).toBe(false);
  });
});
