/**
 * s33 (H4, 2026-04-28) — UI control for the high-contrast theme.
 *
 * Lives in ShortcutsHelp's settings strip (the "?" overlay). One
 * button, three states — system / on / off — cycle on click.
 *
 * Mounting effect: applies/removes `samga-high-contrast` class on
 * `<body>` so CSS in index.css can hang the contrast bumps off it.
 * Listens to `(prefers-contrast: more)` so OS-level changes flip
 * the class while pref="system".
 */

import { useEffect, useState } from "react";
import { Contrast } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  HIGH_CONTRAST_CLASS,
  highContrastLabel,
  loadHighContrastPreference,
  nextHighContrastPreference,
  saveHighContrastPreference,
  shouldApplyHighContrast,
  type HighContrastPreference,
} from "./highContrast";

/** Hook owns the body-class side effect AND the system-query
 *  subscription. Exported so other surfaces (Settings page, future
 *  cmd-palette) can drive the same state without duplicating the
 *  effect. */
export function useHighContrast(): {
  pref: HighContrastPreference;
  setPref: (p: HighContrastPreference) => void;
  isApplied: boolean;
} {
  const [pref, setPrefState] = useState<HighContrastPreference>(() =>
    loadHighContrastPreference(),
  );
  const [systemPrefers, setSystemPrefers] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return false;
      return window.matchMedia("(prefers-contrast: more)").matches;
    } catch {
      return false;
    }
  });

  // Subscribe to OS-level preference changes so pref="system"
  // immediately flips when the user switches their system theme.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(prefers-contrast: more)");
    } catch {
      return;
    }
    const handler = (e: MediaQueryListEvent) => setSystemPrefers(e.matches);
    // Older Safari uses addListener; newer browsers use addEventListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    // Legacy fallback — some Safari builds.
    (mql as any).addListener?.(handler);
    return () => (mql as any).removeListener?.(handler);
  }, []);

  const applied = shouldApplyHighContrast(pref, systemPrefers);

  // Body-class side effect.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    if (!body) return;
    if (applied) {
      body.classList.add(HIGH_CONTRAST_CLASS);
    } else {
      body.classList.remove(HIGH_CONTRAST_CLASS);
    }
  }, [applied]);

  const setPref = (next: HighContrastPreference) => {
    setPrefState(next);
    saveHighContrastPreference(next);
  };

  return { pref, setPref, isApplied: applied };
}

interface ToggleProps {
  /** Optional className override — lets the consumer match the
   *  surrounding chrome (settings strip vs. overlay vs. mini chip). */
  className?: string;
}

/** UI button — cycles through pref states on click. */
export function HighContrastToggle({ className }: ToggleProps) {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const { pref, setPref } = useHighContrast();
  const label = highContrastLabel(pref, langSafe);

  return (
    <button
      type="button"
      onClick={() => setPref(nextHighContrastPreference(pref))}
      aria-label={label}
      title={label}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
      }
    >
      <Contrast size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export default HighContrastToggle;
