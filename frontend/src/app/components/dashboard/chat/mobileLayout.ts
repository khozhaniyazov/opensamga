/**
 * s33 wave 3 (G3+G5, 2026-04-28) — mobile layout helpers.
 *
 * Boss brief from roadmap rows G3 + G5: chip rails (citations,
 * recommendations, capability cards) currently overflow on 320px
 * viewports because their min-width is 260-320px. G3 says: wrap
 * gracefully when the viewport is too narrow rather than forcing
 * horizontal scroll. G5 says: every interactive control needs >=
 * 44x44 px tap area (Apple HIG / WCAG 2.5.5 AAA).
 *
 * This module owns the layout-decision constants + a pure breakpoint
 * helper. Components subscribe via useViewportNarrow() to flip
 * between scroll-rail and wrapped-grid modes without each consumer
 * re-implementing the matchMedia plumbing.
 */

/** Viewport-width trip point under which we switch from a
 *  horizontal-scroll rail to a wrapped two-column grid. 380px is
 *  the threshold where two 260px-min cards stop fitting side-by-
 *  side AND the user is most likely on a budget phone in portrait. */
export const NARROW_VIEWPORT_PX = 380;

/** Minimum tap target size, per WCAG 2.5.5 AAA / Apple HIG. */
export const MIN_TAP_TARGET_PX = 44;

/** Pure helper — given a viewport width, decide whether to render
 *  the wrapped layout. Defends against non-finite input by returning
 *  false (assume desktop). */
export function isViewportNarrow(width: number | null | undefined): boolean {
  if (typeof width !== "number" || !Number.isFinite(width)) return false;
  return width < NARROW_VIEWPORT_PX;
}

/** Pure helper — given an element's width and height in px, decide
 *  whether it meets the AAA tap-target threshold. Either dimension
 *  failing fails the audit; defensive on null/non-finite. */
export function meetsTapTarget(args: {
  width: number | null | undefined;
  height: number | null | undefined;
  minPx?: number;
}): boolean {
  const { width, height, minPx = MIN_TAP_TARGET_PX } = args;
  if (typeof width !== "number" || !Number.isFinite(width)) return false;
  if (typeof height !== "number" || !Number.isFinite(height)) return false;
  return width >= minPx && height >= minPx;
}

/** Pure helper — given the rail's child count + viewport width,
 *  return the layout class hint for the carousel container.
 *
 *  - "scroll-rail": horizontal scroll with snap-x (>= 380px wide
 *    OR <=2 cards regardless of width — wrapping a 1-card rail just
 *    looks empty).
 *  - "wrapped-grid": flex-wrap two-column on narrow viewports.
 */
export function carouselLayoutMode(args: {
  width: number | null | undefined;
  itemCount: number;
}): "scroll-rail" | "wrapped-grid" {
  const { width, itemCount } = args;
  if (itemCount <= 2) return "scroll-rail";
  return isViewportNarrow(width) ? "wrapped-grid" : "scroll-rail";
}
