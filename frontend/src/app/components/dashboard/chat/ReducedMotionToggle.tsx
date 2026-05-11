/**
 * s34 wave 11 (G6, 2026-04-28) — UI control for the reduced-motion
 * preference.
 *
 * Lives next to HighContrastToggle in ShortcutsHelp's settings strip
 * (the "?" overlay). One button, three states — system / on / off —
 * cycle on click. Mirrors HighContrastToggle's structure exactly so
 * the two settings rows feel like a pair.
 *
 * The helpers in `reducedMotion.ts` already own persistence + the
 * decision matrix; the matchMedia subscription lives in the hook
 * `useReducedMotion` (used by the surfaces themselves). This
 * component owns its own pref-state copy so the toggle re-renders
 * without piggy-backing on a global hook (matching the H4 toggle's
 * convention).
 */

import { useEffect, useState } from "react";
import { Wind } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  loadReducedMotionPreference,
  nextReducedMotionPreference,
  reducedMotionLabel,
  saveReducedMotionPreference,
  type ReducedMotionPreference,
} from "./reducedMotion";

interface ToggleProps {
  className?: string;
}

export function ReducedMotionToggle({ className }: ToggleProps) {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const [pref, setPref] = useState<ReducedMotionPreference>(() =>
    loadReducedMotionPreference(),
  );

  // Cross-tab pref sync — if the same control is touched in another
  // tab we want this button to reflect the change without a refresh.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "samga.chat.reducedMotion") return;
      setPref(loadReducedMotionPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleClick = () => {
    const next = nextReducedMotionPreference(pref);
    setPref(next);
    saveReducedMotionPreference(next);
    // Hand-roll a storage event so other tabs / surfaces with
    // useReducedMotion() refresh without waiting for the next
    // event-loop tick. Some browsers don't dispatch `storage` to
    // the originating tab, so we fire one manually.
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "samga.chat.reducedMotion",
          newValue: next === "system" ? null : next,
        }),
      );
    } catch {
      /* noop — older browsers without StorageEvent ctor */
    }
  };

  const label = reducedMotionLabel(pref, langSafe);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
      }
    >
      <Wind size={12} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export default ReducedMotionToggle;
