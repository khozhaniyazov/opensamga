/**
 * s34 wave 11 (G6, 2026-04-28) — `prefers-reduced-motion` honoured
 * on the streaming surfaces.
 *
 * Boss ask (chat UI/UX roadmap §G6): the streaming shimmer and
 * other purely-decorative animations should sit still when the
 * user has asked their OS for reduced motion. Today we have a
 * handful of `animate-pulse` / `animate-spin` classes scattered
 * across the chat surfaces:
 *
 *   - SkeletonBubble: 3 pulsing skeleton bars while the assistant
 *     is composing the first reply
 *   - ReasoningPanel header: pulsing brain icon while streaming
 *   - ThinkingBlock collapsed header: pulsing "Thinking..." text
 *     while the live thinking stream is open
 *   - ToolCallTimeline: spinning loader on in-flight tool calls
 *   - ChatTranscript caret: pulsing 1ch underscore on the live
 *     bubble's last character
 *   - RetryPill: spinning loader during auto-retry countdown
 *
 * Each surface still needs to *render* — the user has to know the
 * model is working — but the *animation* is what reduced-motion
 * users want suppressed. Replacing the moving styles with their
 * static-equivalents is the canonical approach.
 *
 * Implementation pattern (mirrors the H4 high-contrast helper):
 *   - State machine: "system" (default) | "on" (force-reduced) |
 *     "off" (force-allowed)
 *   - `loadReducedMotionPreference()` reads from localStorage
 *   - `shouldReduceMotion(pref, systemPrefers)` decides whether to
 *     suppress
 *   - `useReducedMotion()` (in useReducedMotion.ts) wires it up to
 *     React + `matchMedia('(prefers-reduced-motion: reduce)')`
 *
 * The renderer side picks an animation class via
 * `motionClass(reduce, animatedClass, staticClass?)` so the
 * decision lives in the helper, not in twenty inline ternaries.
 *
 * Pure (no React, no DOM, no fetch) so it's vitest-pinnable.
 */

export type ReducedMotionPreference = "system" | "on" | "off";

export const REDUCED_MOTION_KEY = "samga.chat.reducedMotion";

const VALID_PREFS: ReadonlySet<string> = new Set(["system", "on", "off"]);

/** Coerce arbitrary string input to a valid pref. Returns "system"
 *  on null/undefined/junk. */
export function coerceReducedMotionPreference(
  raw: unknown,
): ReducedMotionPreference {
  if (typeof raw === "string" && VALID_PREFS.has(raw)) {
    return raw as ReducedMotionPreference;
  }
  return "system";
}

/** Decide whether motion should be reduced.
 *    pref="on"     → true
 *    pref="off"    → false
 *    pref="system" → systemPrefers (the matchMedia query result) */
export function shouldReduceMotion(
  pref: ReducedMotionPreference,
  systemPrefers: boolean,
): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return Boolean(systemPrefers);
}

/** Load preference from localStorage. Defends against private-mode
 *  storage + parse failures. */
export function loadReducedMotionPreference(): ReducedMotionPreference {
  try {
    if (typeof localStorage === "undefined") return "system";
    const raw = localStorage.getItem(REDUCED_MOTION_KEY);
    return coerceReducedMotionPreference(raw);
  } catch {
    return "system";
  }
}

/** Persist preference. "system" is treated as the absence of an
 *  override and removes the key, matching the high-contrast helper. */
export function saveReducedMotionPreference(
  pref: ReducedMotionPreference,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (pref === "system") {
      localStorage.removeItem(REDUCED_MOTION_KEY);
      return;
    }
    localStorage.setItem(REDUCED_MOTION_KEY, pref);
  } catch {
    /* quota / private mode / disabled — silent */
  }
}

/** Cycle through the 3-state pref on click. system → on → off → system. */
export function nextReducedMotionPreference(
  current: ReducedMotionPreference,
): ReducedMotionPreference {
  switch (current) {
    case "system":
      return "on";
    case "on":
      return "off";
    case "off":
      return "system";
    default:
      return "system";
  }
}

/** Localized button label per preference. */
export function reducedMotionLabel(
  pref: ReducedMotionPreference,
  lang: "ru" | "kz",
): string {
  const map: Record<ReducedMotionPreference, { ru: string; kz: string }> = {
    system: { ru: "Анимация: авто", kz: "Анимация: авто" },
    on: { ru: "Анимация: уменьшена", kz: "Анимация: азайтылған" },
    off: { ru: "Анимация: включена", kz: "Анимация: қосулы" },
  };
  return map[pref][lang];
}

/** Pick between an animated and a static className.
 *
 *  Renderer pattern:
 *    <Brain className={motionClass(reduce, "animate-pulse", "")} />
 *
 *  When `reduce` is true and no static fallback is provided, we
 *  return the empty string so the surface reads as a static icon. */
export function motionClass(
  reduce: boolean,
  animated: string,
  staticFallback: string = "",
): string {
  return reduce ? staticFallback : animated;
}
