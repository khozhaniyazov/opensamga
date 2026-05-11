/**
 * s33 wave 3 (G3, 2026-04-28) — viewport-narrow subscription hook.
 *
 * Wraps `matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`)`
 * with a SSR-safe default. Components import this once and get a
 * stable boolean that flips on viewport resize / device rotation.
 */

import { useEffect, useState } from "react";
import { NARROW_VIEWPORT_PX } from "./mobileLayout";

export function useViewportNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`)
        .matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`);
    } catch {
      return;
    }
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    (mql as any).addListener?.(handler);
    return () => (mql as any).removeListener?.(handler);
  }, []);

  return narrow;
}
