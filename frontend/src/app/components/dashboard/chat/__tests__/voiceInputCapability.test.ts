/**
 * v3.9 (F4, 2026-04-30) — vitest pins for voiceInputCapability.
 * Pure helpers, no DOM.
 */

import { describe, expect, it } from "vitest";
import {
  detectVoiceCapability,
  preferredVoiceLocale,
  resolveVoiceLocaleChain,
  VOICE_LOCALE_PRIORITY,
} from "../voiceInputCapability";

describe("detectVoiceCapability", () => {
  it("standard SpeechRecognition present → supported", () => {
    const fakeWin = { SpeechRecognition: function () {} };
    const cap = detectVoiceCapability(fakeWin);
    expect(cap.supported).toBe(true);
    expect(typeof cap.Ctor).toBe("function");
  });

  it("webkitSpeechRecognition fallback → supported", () => {
    const fakeWin = { webkitSpeechRecognition: function () {} };
    const cap = detectVoiceCapability(fakeWin);
    expect(cap.supported).toBe(true);
  });

  it("standard wins over webkit when both present", () => {
    const std = function std() {};
    const webkit = function webkit() {};
    const fakeWin = {
      SpeechRecognition: std,
      webkitSpeechRecognition: webkit,
    };
    expect(detectVoiceCapability(fakeWin).Ctor).toBe(std);
  });

  it("neither constructor → not supported", () => {
    expect(detectVoiceCapability({}).supported).toBe(false);
    expect(detectVoiceCapability({}).Ctor).toBe(null);
  });

  it("non-function values → not supported", () => {
    const fakeWin = { SpeechRecognition: "not a constructor" };
    expect(detectVoiceCapability(fakeWin).supported).toBe(false);
  });

  it("null / undefined / non-object win → not supported", () => {
    expect(detectVoiceCapability(null).supported).toBe(false);
    expect(detectVoiceCapability(undefined).supported).toBe(false);
    expect(detectVoiceCapability(42 as unknown).supported).toBe(false);
    expect(detectVoiceCapability("window" as unknown).supported).toBe(false);
  });
});

describe("resolveVoiceLocaleChain", () => {
  it("RU UI lang → RU-priority chain", () => {
    expect(resolveVoiceLocaleChain("ru")).toEqual(VOICE_LOCALE_PRIORITY.ru);
  });

  it("KZ UI lang → KZ-priority chain (kk-KZ first, ru-RU as fallback)", () => {
    const chain = resolveVoiceLocaleChain("kz");
    expect(chain[0]).toBe("kk-KZ");
    expect(chain).toContain("ru-RU");
  });

  it("unknown / null / non-string → defaults to RU chain", () => {
    expect(resolveVoiceLocaleChain(null)).toEqual(VOICE_LOCALE_PRIORITY.ru);
    expect(resolveVoiceLocaleChain(undefined)).toEqual(
      VOICE_LOCALE_PRIORITY.ru,
    );
    expect(resolveVoiceLocaleChain("en")).toEqual(VOICE_LOCALE_PRIORITY.ru);
    expect(resolveVoiceLocaleChain(42)).toEqual(VOICE_LOCALE_PRIORITY.ru);
  });

  it("never returns empty", () => {
    expect(resolveVoiceLocaleChain("ru").length).toBeGreaterThan(0);
    expect(resolveVoiceLocaleChain("kz").length).toBeGreaterThan(0);
    expect(resolveVoiceLocaleChain(null).length).toBeGreaterThan(0);
  });
});

describe("preferredVoiceLocale", () => {
  it("RU → ru-RU", () => {
    expect(preferredVoiceLocale("ru")).toBe("ru-RU");
  });

  it("KZ → kk-KZ", () => {
    expect(preferredVoiceLocale("kz")).toBe("kk-KZ");
  });

  it("unknown → ru-RU", () => {
    expect(preferredVoiceLocale("xx")).toBe("ru-RU");
    expect(preferredVoiceLocale(null)).toBe("ru-RU");
    expect(preferredVoiceLocale(undefined)).toBe("ru-RU");
  });
});

describe("purity", () => {
  it("repeated calls with same args return same value", () => {
    expect(preferredVoiceLocale("kz")).toBe(preferredVoiceLocale("kz"));
    expect(resolveVoiceLocaleChain("ru")).toBe(resolveVoiceLocaleChain("ru"));
  });
});
