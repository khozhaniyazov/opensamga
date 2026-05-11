/**
 * s34 wave 11 (G6, 2026-04-28): React hook for reduced-motion.
 *
 * Wires the pure helpers in `reducedMotion.ts` to:
 *   1. The user's localStorage preference
 *   2. The OS `prefers-reduced-motion: reduce` media query
 *
 * Returns the resolved boolean (true = should reduce). The hook
 * subscribes to both `storage` events (so a setting toggle from
 * another tab propagates) and the `matchMedia` change event (so
 * an OS-level reduced-motion toggle takes effect without a reload).
 */

import { useEffect, useState } from "react";
import {
  loadReducedMotionPreference,
  shouldReduceMotion,
  type ReducedMotionPreference,
} from "./reducedMotion";

const QUERY = "(prefers-reduced-motion: reduce)";

function readSystemPrefers(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [pref, setPref] = useState<ReducedMotionPreference>(() =>
    loadReducedMotionPreference(),
  );
  const [systemPrefers, setSystemPrefers] = useState<boolean>(() =>
    readSystemPrefers(),
  );

  // Cross-tab pref sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "samga.chat.reducedMotion") return;
      setPref(loadReducedMotionPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // OS-level pref sync.
  useEffect(() => {
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      setSystemPrefers(e.matches);
    };
    mql.addEventListener?.("change", onChange);
    return () => mql?.removeEventListener?.("change", onChange);
  }, []);

  return shouldReduceMotion(pref, systemPrefers);
}
