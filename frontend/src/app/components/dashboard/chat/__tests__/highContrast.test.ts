/**
 * s33 (H4) — vitest pins for the high-contrast preference helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HIGH_CONTRAST_CLASS,
  HIGH_CONTRAST_KEY,
  coerceHighContrastPreference,
  highContrastLabel,
  loadHighContrastPreference,
  nextHighContrastPreference,
  saveHighContrastPreference,
  shouldApplyHighContrast,
} from "../highContrast";

describe("constants", () => {
  it("storage key + class are stable", () => {
    expect(HIGH_CONTRAST_KEY).toBe("samga.chat.highContrast");
    expect(HIGH_CONTRAST_CLASS).toBe("samga-high-contrast");
  });
});

describe("coerceHighContrastPreference", () => {
  it("accepts valid pref strings", () => {
    expect(coerceHighContrastPreference("system")).toBe("system");
    expect(coerceHighContrastPreference("on")).toBe("on");
    expect(coerceHighContrastPreference("off")).toBe("off");
  });

  it("falls back to system on null/undefined/junk/non-string", () => {
    expect(coerceHighContrastPreference(null)).toBe("system");
    expect(coerceHighContrastPreference(undefined)).toBe("system");
    expect(coerceHighContrastPreference("ON")).toBe("system"); // case-sensitive
    expect(coerceHighContrastPreference("yes")).toBe("system");
    expect(coerceHighContrastPreference(42)).toBe("system");
    expect(coerceHighContrastPreference({})).toBe("system");
  });
});

describe("shouldApplyHighContrast", () => {
  it("on/off override regardless of system query", () => {
    expect(shouldApplyHighContrast("on", false)).toBe(true);
    expect(shouldApplyHighContrast("on", true)).toBe(true);
    expect(shouldApplyHighContrast("off", true)).toBe(false);
    expect(shouldApplyHighContrast("off", false)).toBe(false);
  });

  it("system follows the OS-level query result", () => {
    expect(shouldApplyHighContrast("system", true)).toBe(true);
    expect(shouldApplyHighContrast("system", false)).toBe(false);
  });
});

describe("nextHighContrastPreference", () => {
  it("cycles system → on → off → system", () => {
    expect(nextHighContrastPreference("system")).toBe("on");
    expect(nextHighContrastPreference("on")).toBe("off");
    expect(nextHighContrastPreference("off")).toBe("system");
  });
});

describe("loadHighContrastPreference / saveHighContrastPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns 'system' when nothing is stored", () => {
    expect(loadHighContrastPreference()).toBe("system");
  });

  it("round-trips on/off through localStorage", () => {
    saveHighContrastPreference("on");
    expect(localStorage.getItem(HIGH_CONTRAST_KEY)).toBe("on");
    expect(loadHighContrastPreference()).toBe("on");

    saveHighContrastPreference("off");
    expect(localStorage.getItem(HIGH_CONTRAST_KEY)).toBe("off");
    expect(loadHighContrastPreference()).toBe("off");
  });

  it("system removes the key (keeps storage clean)", () => {
    saveHighContrastPreference("on");
    saveHighContrastPreference("system");
    expect(localStorage.getItem(HIGH_CONTRAST_KEY)).toBeNull();
    expect(loadHighContrastPreference()).toBe("system");
  });

  it("recovers from a corrupt stored value", () => {
    localStorage.setItem(HIGH_CONTRAST_KEY, "<garbage>");
    expect(loadHighContrastPreference()).toBe("system");
  });
});

describe("highContrastLabel", () => {
  it("returns RU labels", () => {
    expect(highContrastLabel("system", "ru")).toBe("Контраст: авто");
    expect(highContrastLabel("on", "ru")).toBe("Контраст: включен");
    expect(highContrastLabel("off", "ru")).toBe("Контраст: выключен");
  });

  it("returns KZ labels", () => {
    expect(highContrastLabel("system", "kz")).toBe("Контраст: авто");
    expect(highContrastLabel("on", "kz")).toBe("Контраст: қосулы");
    expect(highContrastLabel("off", "kz")).toBe("Контраст: өшірулі");
  });
});
