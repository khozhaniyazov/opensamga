/**
 * s34 wave 2 (G1, 2026-04-28) — bottom-sheet ThreadRail helpers.
 *
 * Boss roadmap row G1: "Bottom-sheet ThreadRail on mobile (hamburger
 * toggles) instead of left drawer that overlaps prose". Before this
 * wave the rail was a flex sibling of the chat column, so on
 * narrow viewports opening it pushed the conversation off-screen
 * entirely. The mobile presentation is now an overlay sliding up
 * from the bottom — the prose stays put, a backdrop fades in, and
 * tapping outside or the close button retracts the sheet.
 *
 * The breakpoint is 768px (Tailwind `md`) so it matches the existing
 * `(min-width: 768px)` matchMedia gate in ChatPage that auto-closes
 * the rail when the viewport shrinks. Below 768 → sheet; at and
 * above → inline aside.
 *
 * This module pins the layout-decision constants so the same trip
 * point lives in exactly one place; the consumer hook
 * `useViewportMobile` reads from here.
 */

/** Viewport-width trip point under which ThreadRail renders as a
 *  bottom-sheet overlay rather than an inline left aside. Matches
 *  Tailwind's `md:` breakpoint and the existing matchMedia gate
 *  in ChatPage (`(min-width: 768px)`). */
export const MOBILE_SHEET_BREAKPOINT_PX = 768;

/** Maximum sheet height as a fraction of the dynamic viewport height.
 *  85% leaves enough top inset to peek the chat behind it (so users
 *  remember the conversation context while picking a thread) and to
 *  expose a tap-target for "tap outside to close". */
export const MOBILE_SHEET_MAX_HEIGHT_VH = 85;

/** Backdrop opacity for the dimmed scrim behind the sheet. Matches
 *  shadcn / Material BottomSheet conventions. */
export const MOBILE_SHEET_BACKDROP_OPACITY = 0.4;

/** Pure helper — given a viewport width, decide whether the rail
 *  should render as a bottom-sheet (true) or as an inline left aside
 *  (false). Defends against non-finite input by returning `false`
 *  (assume desktop) so a missing/SSR width never spuriously flips
 *  desktop browsers into mobile mode mid-session.
 */
export function isMobileViewport(width: number | null | undefined): boolean {
  if (typeof width !== "number" || !Number.isFinite(width)) return false;
  return width < MOBILE_SHEET_BREAKPOINT_PX;
}

/** Pure helper — pick a layout mode label from the viewport width.
 *  Wrapping `isMobileViewport` in a string discriminator makes
 *  consumers more legible (`mode === "sheet"` reads better than a
 *  raw boolean inside JSX). */
export function railLayoutMode(
  width: number | null | undefined,
): "sheet" | "inline" {
  return isMobileViewport(width) ? "sheet" : "inline";
}

/** Pure helper — should the modal backdrop be rendered right now?
 *  A backdrop is only meaningful when (a) we're on a narrow
 *  viewport AND (b) the sheet is open. On desktop the rail is
 *  inline and a scrim would be confusing. */
export function shouldRenderBackdrop(args: {
  open: boolean;
  width: number | null | undefined;
}): boolean {
  return Boolean(args.open) && isMobileViewport(args.width);
}

/** Pure helper — should body scroll be locked? Same gate as the
 *  backdrop: we only lock when the sheet is actually overlaying
 *  the page. Returning a boolean rather than touching the DOM
 *  keeps this trivially testable and lets the consumer decide
 *  how to apply it (className toggle, useEffect side-effect, etc).
 */
export function shouldLockBodyScroll(args: {
  open: boolean;
  width: number | null | undefined;
}): boolean {
  return shouldRenderBackdrop(args);
}
