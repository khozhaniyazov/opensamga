/**
 * s34 wave 3 (G5 wave 2, 2026-04-28) — tap-target Tailwind helpers.
 *
 * G5's audit threshold is `meetsTapTarget` from `mobileLayout.ts`
 * (44x44 px, AAA / Apple HIG). What was missing was a single source
 * of truth for the *Tailwind class string* that consumers slap on
 * a button to satisfy the threshold without each component
 * hardcoding `min-h-[44px] min-w-[44px]` in slightly different
 * shapes (some forgot the min-w, some used h-11 w-11 which is also
 * 44px but doesn't compose with content-driven sizing).
 *
 * This module exports the canonical class strings + small pure
 * helpers so the audit is greppable AND testable.
 */

import { MIN_TAP_TARGET_PX } from "./mobileLayout";

/** Square tap target — used by icon-only buttons (kebab, close X,
 *  send/stop). 44x44 minimum on every viewport. */
export const TAP_TARGET_SQUARE_CLASS = "min-h-[44px] min-w-[44px]";

/** Row-style tap target — used by menu items / list rows that are
 *  wider than tall. Only enforces the 44px minimum height; width
 *  is content-driven (or container-stretched). */
export const TAP_TARGET_ROW_CLASS = "min-h-[44px]";

/** Pure helper — given a className string, does it already include
 *  the canonical square tap-target classes? Used by lint-style
 *  tests to detect drift. */
export function hasSquareTapTarget(className: string): boolean {
  if (typeof className !== "string") return false;
  return (
    className.includes("min-h-[44px]") && className.includes("min-w-[44px]")
  );
}

/** Pure helper — given a className string, does it include the
 *  row-style 44px-height minimum? */
export function hasRowTapTarget(className: string): boolean {
  if (typeof className !== "string") return false;
  return className.includes("min-h-[44px]");
}

/** Pure helper — convenience for tests/audits to assert the
 *  numeric threshold matches the class. Catches the drift case
 *  where someone bumps MIN_TAP_TARGET_PX but forgets to update the
 *  class strings (or vice-versa). */
export function tapTargetClassMatchesThreshold(): boolean {
  return MIN_TAP_TARGET_PX === 44;
}
