/**
 * s34 wave 2 (G1, 2026-04-28) — viewport-mobile subscription hook.
 *
 * Wraps `matchMedia("(max-width: ${MOBILE_SHEET_BREAKPOINT_PX -
 * 1}px)")` with an SSR-safe default (`false` → desktop). Components
 * import this once and get a stable boolean that flips on viewport
 * resize / device rotation.
 *
 * Distinct from `useViewportNarrow` (which trips at 380px for
 * carousel/citation chip wrap) — this hook trips at the real
 * mobile/desktop boundary (768px = md:).
 */

import { useEffect, useState } from "react";
import { MOBILE_SHEET_BREAKPOINT_PX } from "./mobileSheet";

export function useViewportMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia(
        `(max-width: ${MOBILE_SHEET_BREAKPOINT_PX - 1}px)`,
      ).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(
        `(max-width: ${MOBILE_SHEET_BREAKPOINT_PX - 1}px)`,
      );
    } catch {
      return;
    }
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    (mql as any).addListener?.(handler);
    return () => (mql as any).removeListener?.(handler);
  }, []);

  return mobile;
}
