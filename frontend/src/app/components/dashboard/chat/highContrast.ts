/**
 * s33 (H4, 2026-04-28) — High-contrast theme toggle.
 *
 * Boss brief from roadmap row H4: "zinc-800 on zinc-50 bumps to
 * zinc-950 on white". The default chat surface uses zinc-800 body
 * text on zinc-50/white backgrounds, which is WCAG AA but not
 * AAA. A non-trivial slice of UNT students prep on cheap LCD
 * monitors with washed-out gamma — for them the difference between
 * "zinc-800 on zinc-50" and "zinc-950 on white" is the difference
 * between "I can read this" and "I'm squinting".
 *
 * Implementation pattern (mirroring the `prefers-reduced-motion`
 * approach from G6): a body-level class `samga-high-contrast` is
 * toggled via the user's preference. CSS overrides hung off that
 * class do the actual color bumps. Pure helpers below own the
 * persistence + initial-state logic.
 *
 * State machine:
 *   - "system"  (default) — follows `prefers-contrast: more` media query
 *   - "on"      — force enabled
 *   - "off"     — force disabled
 *
 * Storage: `samga.chat.highContrast` localStorage key, plain string
 * value. Corrupt/unknown values fall back to "system".
 */

export type HighContrastPreference = "system" | "on" | "off";

export const HIGH_CONTRAST_KEY = "samga.chat.highContrast";

/** Body-level class CSS hangs off. */
export const HIGH_CONTRAST_CLASS = "samga-high-contrast";

const VALID_PREFS: ReadonlySet<string> = new Set(["system", "on", "off"]);

/** Pure helper — coerce arbitrary string input to a valid pref.
 *  Returns "system" on null/undefined/junk. */
export function coerceHighContrastPreference(
  raw: unknown,
): HighContrastPreference {
  if (typeof raw === "string" && VALID_PREFS.has(raw)) {
    return raw as HighContrastPreference;
  }
  return "system";
}

/** Pure helper — given a preference and the system query result,
 *  decide whether to render the high-contrast class.
 *
 *  - pref="on" → true
 *  - pref="off" → false
 *  - pref="system" → systemPrefers
 */
export function shouldApplyHighContrast(
  pref: HighContrastPreference,
  systemPrefers: boolean,
): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  // pref === "system" — fall back to OS / browser query.
  return Boolean(systemPrefers);
}

/** Pure helper — load preference from localStorage. */
export function loadHighContrastPreference(): HighContrastPreference {
  try {
    if (typeof localStorage === "undefined") return "system";
    const raw = localStorage.getItem(HIGH_CONTRAST_KEY);
    return coerceHighContrastPreference(raw);
  } catch {
    return "system";
  }
}

/** Pure helper — persist preference. Defends against quota errors. */
export function saveHighContrastPreference(pref: HighContrastPreference): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (pref === "system") {
      // No need to persist the default — keeps storage clean for
      // users who toggle once and reset.
      localStorage.removeItem(HIGH_CONTRAST_KEY);
      return;
    }
    localStorage.setItem(HIGH_CONTRAST_KEY, pref);
  } catch {
    /* quota / private mode / disabled — silent */
  }
}

/** Pure helper — cycle through the 3-state pref on click.
 *  system → on → off → system. */
export function nextHighContrastPreference(
  current: HighContrastPreference,
): HighContrastPreference {
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

/** Pure helper — localized button label per preference. */
export function highContrastLabel(
  pref: HighContrastPreference,
  lang: "ru" | "kz",
): string {
  const map: Record<HighContrastPreference, { ru: string; kz: string }> = {
    system: { ru: "Контраст: авто", kz: "Контраст: авто" },
    on: { ru: "Контраст: включен", kz: "Контраст: қосулы" },
    off: { ru: "Контраст: выключен", kz: "Контраст: өшірулі" },
  };
  return map[pref][lang];
}
