/**
 * v3.9 (F4, 2026-04-30) — voice input capability detection.
 *
 * Pure helpers that introspect the running browser's SpeechRecognition
 * support and resolve the locale tag we'll feed to the recognizer.
 *
 * Why split this out:
 *   1. The component shell stays free of `(window as any).…` casts.
 *   2. Capability detection runs once at mount; pinning it here lets
 *      vitest exercise edge cases (no-API browsers, partial APIs)
 *      without booting jsdom-window-mock contortions.
 *   3. Locale resolution is two layers — UI lang (RU/KZ) plus a
 *      preferred BCP-47 list. Future browsers may add KZ-Cyrl
 *      support; we want to fall back to RU automatically without
 *      rewriting every call site.
 *
 * No DOM mutation. No React. No Intl beyond string operations.
 */

export type VoiceLang = "ru" | "kz";

/** BCP-47 tags we'll attempt in priority order for each UI lang.
 *
 *  Why two tags for KZ: Chrome / Edge support `kk-KZ` since
 *  Speech-API v2; Safari historically only ships RU on the desktop
 *  build. Falling back to `ru-RU` for KZ users on Safari is better
 *  than refusing voice input entirely — the recognized text will be
 *  RU-Cyrillic which is mutually-intelligible enough to dictate
 *  numerals + simple terms. The user can still edit before sending. */
export const VOICE_LOCALE_PRIORITY: Readonly<
  Record<VoiceLang, readonly string[]>
> = {
  ru: ["ru-RU", "ru"],
  kz: ["kk-KZ", "kk", "ru-RU", "ru"],
};

/** Probe-only result: does this browser expose any SpeechRecognition
 *  constructor at all? Returns the constructor when present so the
 *  caller can `new` it without re-introspecting. Defensive against
 *  SSR / Node test environments where `window` is undefined. */
export interface VoiceCapability {
  supported: boolean;
  /** The constructor we'd use. `unknown` keeps the surface API
   *  type-only — runtime callers cast at the new-up site. */
  Ctor: unknown;
}

/** Read SpeechRecognition off a window-shaped object. Pure: takes
 *  the window in (testable) instead of touching the global. */
export function detectVoiceCapability(
  win: unknown = typeof window === "undefined" ? null : window,
): VoiceCapability {
  if (!win || typeof win !== "object") return { supported: false, Ctor: null };
  const w = win as Record<string, unknown>;
  const Ctor =
    (w["SpeechRecognition"] as unknown) ||
    (w["webkitSpeechRecognition"] as unknown) ||
    null;
  return { supported: typeof Ctor === "function", Ctor };
}

/** Resolve the BCP-47 tag we'll set on a fresh recognizer.
 *
 *  Strategy:
 *    - Honour the priority table for the requested UI lang.
 *    - The first tag is always tried; we don't have a way to
 *      ASK the browser which tags it supports (no enumeration API
 *      on SpeechRecognition), so we just feed our best guess and
 *      let the recognizer's `onerror` (`language-not-supported`)
 *      drive a fallback retry.
 *
 *  Returns the array so the caller can iterate fallbacks on error.
 *  Never empty — even unknown UI lang resolves to the RU table. */
export function resolveVoiceLocaleChain(uiLang: unknown): readonly string[] {
  const safe: VoiceLang = uiLang === "kz" ? "kz" : "ru";
  return VOICE_LOCALE_PRIORITY[safe];
}

/** Convenience: first preferred tag for UI lang. Used as the
 *  initial `recognition.lang` setting. */
export function preferredVoiceLocale(uiLang: unknown): string {
  const chain = resolveVoiceLocaleChain(uiLang);
  return chain[0] ?? "ru-RU";
}
