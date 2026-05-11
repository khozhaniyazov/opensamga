/**
 * s34 wave 11 (G6, 2026-04-28): vitest pins for reducedMotion.ts.
 *
 * The state machine is the contract — pin every transition + the
 * coercion + storage round-trip + label localization + the
 * motionClass helper that drives the surface-level decisions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REDUCED_MOTION_KEY,
  coerceReducedMotionPreference,
  loadReducedMotionPreference,
  motionClass,
  nextReducedMotionPreference,
  reducedMotionLabel,
  saveReducedMotionPreference,
  shouldReduceMotion,
} from "../reducedMotion";

describe("REDUCED_MOTION_KEY", () => {
  it("is 'samga.chat.reducedMotion'", () => {
    expect(REDUCED_MOTION_KEY).toBe("samga.chat.reducedMotion");
  });
});

describe("coerceReducedMotionPreference", () => {
  it("accepts the three valid values", () => {
    expect(coerceReducedMotionPreference("system")).toBe("system");
    expect(coerceReducedMotionPreference("on")).toBe("on");
    expect(coerceReducedMotionPreference("off")).toBe("off");
  });

  it("falls back to 'system' on null/undefined/junk", () => {
    expect(coerceReducedMotionPreference(null)).toBe("system");
    expect(coerceReducedMotionPreference(undefined)).toBe("system");
    expect(coerceReducedMotionPreference("garbage")).toBe("system");
    expect(coerceReducedMotionPreference(42)).toBe("system");
    expect(coerceReducedMotionPreference({})).toBe("system");
  });
});

describe("shouldReduceMotion", () => {
  it("'on' wins over OS pref", () => {
    expect(shouldReduceMotion("on", false)).toBe(true);
    expect(shouldReduceMotion("on", true)).toBe(true);
  });

  it("'off' wins over OS pref", () => {
    expect(shouldReduceMotion("off", false)).toBe(false);
    expect(shouldReduceMotion("off", true)).toBe(false);
  });

  it("'system' defers to OS pref", () => {
    expect(shouldReduceMotion("system", false)).toBe(false);
    expect(shouldReduceMotion("system", true)).toBe(true);
  });
});

describe("nextReducedMotionPreference (cycle)", () => {
  it("system → on → off → system", () => {
    expect(nextReducedMotionPreference("system")).toBe("on");
    expect(nextReducedMotionPreference("on")).toBe("off");
    expect(nextReducedMotionPreference("off")).toBe("system");
  });

  it("recovers from a corrupt value (defensive)", () => {
    expect(nextReducedMotionPreference("garbage" as unknown as "system")).toBe(
      "system",
    );
  });
});

describe("reducedMotionLabel", () => {
  it("RU labels", () => {
    expect(reducedMotionLabel("system", "ru")).toBe("Анимация: авто");
    expect(reducedMotionLabel("on", "ru")).toBe("Анимация: уменьшена");
    expect(reducedMotionLabel("off", "ru")).toBe("Анимация: включена");
  });

  it("KZ labels", () => {
    expect(reducedMotionLabel("system", "kz")).toBe("Анимация: авто");
    expect(reducedMotionLabel("on", "kz")).toBe("Анимация: азайтылған");
    expect(reducedMotionLabel("off", "kz")).toBe("Анимация: қосулы");
  });
});

describe("motionClass", () => {
  it("returns the animated class when reduce=false", () => {
    expect(motionClass(false, "animate-pulse")).toBe("animate-pulse");
  });

  it("returns the empty string when reduce=true and no fallback", () => {
    expect(motionClass(true, "animate-pulse")).toBe("");
  });

  it("returns the static fallback when reduce=true", () => {
    expect(motionClass(true, "animate-pulse", "opacity-70")).toBe("opacity-70");
  });
});

describe("loadReducedMotionPreference + saveReducedMotionPreference", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(REDUCED_MOTION_KEY);
    } catch {
      /* noop */
    }
  });
  afterEach(() => {
    try {
      localStorage.removeItem(REDUCED_MOTION_KEY);
    } catch {
      /* noop */
    }
  });

  it("defaults to 'system' when no key is set", () => {
    expect(loadReducedMotionPreference()).toBe("system");
  });

  it("round-trips 'on'", () => {
    saveReducedMotionPreference("on");
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("on");
    expect(loadReducedMotionPreference()).toBe("on");
  });

  it("round-trips 'off'", () => {
    saveReducedMotionPreference("off");
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("off");
    expect(loadReducedMotionPreference()).toBe("off");
  });

  it("'system' clears the key (treated as default)", () => {
    saveReducedMotionPreference("on");
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("on");
    saveReducedMotionPreference("system");
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBeNull();
    expect(loadReducedMotionPreference()).toBe("system");
  });

  it("falls back to 'system' on a corrupt value", () => {
    localStorage.setItem(REDUCED_MOTION_KEY, "garbage");
    expect(loadReducedMotionPreference()).toBe("system");
  });
});
