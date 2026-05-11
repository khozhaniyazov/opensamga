/**
 * s34 wave 2 (G2, 2026-04-28) — virtual-keyboard inset hook.
 *
 * Subscribes to `window.visualViewport` resize/scroll events and
 * reports the current keyboard inset in px (0 when no keyboard is
 * up). Math lives in `keyboardInset.ts` so this file is just the
 * lifecycle plumbing.
 *
 * SSR-safe: returns 0 when `window` is undefined or when the
 * `visualViewport` API is missing (older Firefox / desktop).
 */

import { useEffect, useState } from "react";
import {
  computeKeyboardInset,
  shouldTrackKeyboardInset,
} from "./keyboardInset";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = (window as any).visualViewport as VisualViewport | undefined;

    // s35 wave 43 (2026-04-28): gate the subscription on touch
    // capability. Desktop browsers ship visualViewport but don't
    // have a soft keyboard, and the API can report spurious
    // deltas during scrollbar flicker / modal mount / large-DOM
    // mutations. Those deltas were inflating composer padding
    // and squeezing the transcript to 0px (composer-jumps-to-top
    // bug). Touch devices opt in via `shouldTrackKeyboardInset`.
    const env = {
      hasTouchStart: "ontouchstart" in window,
      coarsePointerMatches:
        typeof window.matchMedia === "function"
          ? window.matchMedia("(any-pointer: coarse)").matches
          : null,
      hasVisualViewport: !!vv,
    };
    if (!shouldTrackKeyboardInset(env)) return;
    if (!vv) return; // belt + braces; satisfies the type narrower

    const recompute = () => {
      const layoutH = window.innerHeight;
      const visualH = vv.height;
      setInset(computeKeyboardInset(layoutH, visualH));
    };

    recompute();
    vv.addEventListener("resize", recompute);
    // s35 wave 43 (2026-04-28): dropped the `visualViewport.scroll`
    // listener. `scroll` fires for any pinch-zoom pan or in-page
    // scroll on iOS Safari and was the spurious-trigger path —
    // soft-keyboard show/hide always emits `resize`, which is the
    // only signal we actually need.
    window.addEventListener("orientationchange", recompute);
    return () => {
      vv.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, []);

  return inset;
}
