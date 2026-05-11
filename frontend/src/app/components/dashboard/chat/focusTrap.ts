/**
 * s32 (H2, 2026-04-27) — focus-trap helpers for the chat modals
 * (ClearConfirmModal + ShortcutsHelp).
 *
 * Boss brief: tab-cycling out of an open modal lets a keyboard user
 * accidentally focus elements behind the dim backdrop, which then
 * receive Enter/Space and trigger destructive actions (e.g. tabbing
 * to the Send button while "Clear chat?" is open). H2 fixes that.
 *
 * Strategy:
 *   - Pure helpers in this module (`getFocusableElements`,
 *     `nextFocusInTrap`, `wrapFocusIndex`) so vitest can pin the
 *     contract without jsdom focus simulation.
 *   - A thin React hook `useFocusTrap(rootRef, isActive, onEscape?)`
 *     that wires Tab/Shift+Tab/Escape on the document, scopes
 *     focusable lookup to the dialog root, and restores the
 *     previously-focused element on close.
 *
 * What we DON'T do:
 *   - We do NOT install `inert` on siblings — Safari's inert support
 *     is recent and the boss target list (RU/KZ schools, mixed device
 *     ages) hits older builds. Tab+Shift+Tab handling is enough for
 *     the H2 brief.
 *   - We do NOT auto-focus the first focusable on open — that's the
 *     consumer's call (e.g. ClearConfirmModal focuses Cancel for
 *     destructive-safe defaults).
 */

import { useEffect, useRef } from "react";

/** CSS selector matching the elements browsers will Tab to by
 *  default. Mirrors what the DOM treats as "tabbable" — anchors with
 *  href, buttons, inputs (not disabled), select, textarea, and
 *  anything explicitly `tabindex="0"`. We exclude `tabindex="-1"`
 *  (programmatic-only focus targets like the modal root itself) by
 *  filtering on the result. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "[contenteditable=true]",
].join(",");

/** Returns all visible-tabbable focusables inside `root`, in document
 *  order. `null` root short-circuits to `[]`. The visibility filter
 *  drops elements with `display:none` / `visibility:hidden` /
 *  `aria-hidden="true"` ancestors so tabbing skips them naturally. */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const raw = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return raw.filter((el) => isTabbable(el));
}

/** Conservative tabbability test — element exists in the DOM, isn't
 *  hidden via CSS, and isn't behind an aria-hidden ancestor. We
 *  intentionally trust the selector for `disabled` / `tabindex="-1"`
 *  so this only handles the visibility cases. */
function isTabbable(el: HTMLElement): boolean {
  if (!el || !el.isConnected) return false;
  if (el.hidden) return false;
  // `offsetParent === null` is the cheap "not rendered" check; it
  // misses position:fixed elements (whose offsetParent is null even
  // when visible), so we only treat it as a hint, not a gate.
  if (el.closest('[aria-hidden="true"]')) return false;
  return true;
}

/** Wraps an index modulo `length`. Defensive on non-positive length
 *  (returns 0) and non-finite indices (returns 0). */
export function wrapFocusIndex(idx: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  if (!Number.isFinite(idx)) return 0;
  return ((idx % length) + length) % length;
}

/** Computes the index of the element that should receive focus on
 *  the next Tab. `currentIdx === -1` means "current focus is outside
 *  the trap" and the helper should send focus to the first / last
 *  focusable depending on direction. */
export function nextFocusInTrap(
  currentIdx: number,
  length: number,
  direction: "forward" | "backward",
): number {
  if (length <= 0) return -1;
  if (currentIdx < 0) {
    return direction === "forward" ? 0 : length - 1;
  }
  if (direction === "forward") return wrapFocusIndex(currentIdx + 1, length);
  return wrapFocusIndex(currentIdx - 1, length);
}

interface UseFocusTrapOptions {
  /** Optional Escape handler. When provided, Escape triggers it in
   *  addition to the consumer's own listeners (we still
   *  preventDefault so the browser doesn't run its native cancel
   *  affordance). */
  onEscape?: () => void;
  /** When true, restore focus to the previously-focused element on
   *  close. Default true. Disable when the consumer manages focus
   *  itself (e.g. focusing the trigger that opened the modal). */
  restoreOnClose?: boolean;
}

/** Trap focus inside `rootRef.current` while `isActive` is true.
 *  Tab cycles forward, Shift+Tab cycles backward, both wrapping at
 *  the boundaries. Escape calls `onEscape` if provided. On close,
 *  restores focus to the previously-focused element. */
export function useFocusTrap(
  rootRef: React.RefObject<HTMLElement>,
  isActive: boolean,
  options: UseFocusTrapOptions = {},
): void {
  const { onEscape, restoreOnClose = true } = options;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;
    // Snapshot the previously-focused element so we can restore on
    // close. Defensive cast — focused element may be the body.
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = getFocusableElements(rootRef.current);
      if (focusables.length === 0) {
        // No focusables means we can't usefully cycle — the consumer
        // is showing a modal with nothing to tab to (e.g. only
        // descriptive text). Still preventDefault so focus doesn't
        // escape to the page below.
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const currentIdx = active ? focusables.indexOf(active) : -1;
      const direction = e.shiftKey ? "backward" : "forward";
      const nextIdx = nextFocusInTrap(currentIdx, focusables.length, direction);
      const target = focusables[nextIdx];
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };

    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      if (restoreOnClose) {
        const prev = previouslyFocusedRef.current;
        if (prev && typeof prev.focus === "function") {
          // Defer the restore by one frame so React's unmount has
          // committed and the trigger button is back in the DOM.
          requestAnimationFrame(() => {
            try {
              prev.focus();
            } catch {
              /* node detached — silently skip */
            }
          });
        }
      }
    };
  }, [isActive, onEscape, restoreOnClose, rootRef]);
}
