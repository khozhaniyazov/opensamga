/**
 * s35 wave 37 (2026-04-28) — vitest pin tests for
 * `shouldDismissOverlayOnKey`. Pure predicate, no DOM.
 */

import { describe, expect, it } from "vitest";
import { shouldDismissOverlayOnKey } from "../dismissibleOverlayKey";

describe("shouldDismissOverlayOnKey — happy path", () => {
  it("Escape + active → true", () => {
    expect(shouldDismissOverlayOnKey({ key: "Escape", active: true })).toBe(
      true,
    );
  });

  it("Escape but inactive → false", () => {
    expect(shouldDismissOverlayOnKey({ key: "Escape", active: false })).toBe(
      false,
    );
  });

  it("non-Escape + active → false", () => {
    expect(shouldDismissOverlayOnKey({ key: "Enter", active: true })).toBe(
      false,
    );
    expect(shouldDismissOverlayOnKey({ key: " ", active: true })).toBe(false);
    expect(shouldDismissOverlayOnKey({ key: "Tab", active: true })).toBe(false);
  });
});

describe("shouldDismissOverlayOnKey — defensive", () => {
  it("legacy 'Esc' (IE) NOT accepted", () => {
    // Boss-confirmed: strict 'Escape' only. Older browsers we
    // don't support; a future global keymap accidentally widening
    // this would silently change UX.
    expect(shouldDismissOverlayOnKey({ key: "Esc", active: true })).toBe(false);
  });

  it("undefined / null key → false", () => {
    expect(shouldDismissOverlayOnKey({ key: undefined, active: true })).toBe(
      false,
    );
    expect(shouldDismissOverlayOnKey({ key: null, active: true })).toBe(false);
  });

  it("non-string key → false", () => {
    expect(shouldDismissOverlayOnKey({ key: 27, active: true })).toBe(false);
    expect(shouldDismissOverlayOnKey({ key: {}, active: true })).toBe(false);
  });

  it("active coerced via strict-equality (truthy ≠ true)", () => {
    expect(shouldDismissOverlayOnKey({ key: "Escape", active: 1 })).toBe(false);
    expect(shouldDismissOverlayOnKey({ key: "Escape", active: "yes" })).toBe(
      false,
    );
    expect(
      shouldDismissOverlayOnKey({ key: "Escape", active: undefined }),
    ).toBe(false);
  });
});

describe("shouldDismissOverlayOnKey — purity", () => {
  it("same input → same output", () => {
    const a = shouldDismissOverlayOnKey({ key: "Escape", active: true });
    shouldDismissOverlayOnKey({ key: "Enter", active: false });
    shouldDismissOverlayOnKey({ key: "Escape", active: false });
    const b = shouldDismissOverlayOnKey({ key: "Escape", active: true });
    expect(a).toBe(b);
  });
});
