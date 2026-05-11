/**
 * s33 (B3) — vitest pins for the onboarding-tour helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_DONE_KEY,
  ONBOARDING_DONE_VALUE,
  buildOnboardingSteps,
  isOnboardingDone,
  markOnboardingDone,
  nextOnboardingStep,
  onboardingControlLabels,
  resetOnboarding,
} from "../onboardingTourState";

describe("constants", () => {
  it("storage key + value are stable", () => {
    expect(ONBOARDING_DONE_KEY).toBe("samga.chat.onboardingDone");
    expect(ONBOARDING_DONE_VALUE).toBe("v1");
  });
});

describe("isOnboardingDone / markOnboardingDone / resetOnboarding", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("starts not-done on a fresh install", () => {
    expect(isOnboardingDone()).toBe(false);
  });

  it("mark + reset round-trip", () => {
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
    resetOnboarding();
    expect(isOnboardingDone()).toBe(false);
  });

  it("ignores stored values that don't match the current version", () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, "v0");
    expect(isOnboardingDone()).toBe(false);
  });
});

describe("buildOnboardingSteps", () => {
  it("returns 3 steps in canonical order (RU)", () => {
    const steps = buildOnboardingSteps("ru");
    expect(steps.map((s) => s.id)).toEqual([
      "rail_toggle",
      "composer",
      "sources_drawer",
    ]);
  });

  it("KZ wording differs from RU on each step body", () => {
    const ru = buildOnboardingSteps("ru");
    const kz = buildOnboardingSteps("kz");
    for (let i = 0; i < ru.length; i += 1) {
      expect(kz[i].id).toBe(ru[i].id);
      expect(kz[i].body).not.toBe(ru[i].body);
    }
  });

  it("each step has a non-empty target selector", () => {
    for (const step of buildOnboardingSteps("ru")) {
      expect(step.targetSelector.length).toBeGreaterThan(0);
    }
  });
});

describe("nextOnboardingStep", () => {
  it("advances by one within bounds", () => {
    expect(nextOnboardingStep(0, 3)).toBe(1);
    expect(nextOnboardingStep(1, 3)).toBe(2);
  });

  it("returns -1 when at or past the last step", () => {
    expect(nextOnboardingStep(2, 3)).toBe(-1);
    expect(nextOnboardingStep(99, 3)).toBe(-1);
  });

  it("clamps negative current to 0", () => {
    expect(nextOnboardingStep(-3, 3)).toBe(0);
  });

  it("returns -1 on empty list", () => {
    expect(nextOnboardingStep(0, 0)).toBe(-1);
  });
});

describe("onboardingControlLabels", () => {
  it("RU defaults", () => {
    const l = onboardingControlLabels("ru");
    expect(l.next).toBe("Дальше");
    expect(l.finish).toBe("Поехали");
    expect(l.skip).toBe("Пропустить");
    expect(l.step(2, 3)).toBe("2 / 3");
  });

  it("KZ defaults", () => {
    const l = onboardingControlLabels("kz");
    expect(l.next).toBe("Әрі қарай");
    expect(l.finish).toBe("Бастау");
    expect(l.skip).toBe("Өткізіп жіберу");
    expect(l.step(1, 3)).toBe("1 / 3");
  });
});
