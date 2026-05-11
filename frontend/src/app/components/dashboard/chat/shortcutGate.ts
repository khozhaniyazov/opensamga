/**
 * Phase C (s22): pure-JS helpers for keyboard-shortcut gating.
 *
 * The "?" shortcut (and anything else we wire globally in chat) must
 * NOT fire while the user is typing in an input, textarea, or
 * contenteditable — otherwise the shortcut overlay pops open every
 * time they legitimately type "?" into the composer. Same problem for
 * users who are editing inside a modal: we don't want a second modal
 * to stack on top of an already-focused one.
 *
 * This module is isolated so the Node harness can exercise the gate
 * rules without a browser. `isEditableTarget` accepts a generic
 * target shape so we can feed it plain objects from tests.
 */

export interface MinimalTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/**
 * Return true if the given event target is an editable surface where
 * printable keys should be passed through to the native handler.
 */
export function isEditableTarget(
  target: MinimalTarget | null | undefined,
): boolean {
  if (!target) return false;
  const tag = (target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable === true) return true;
  // Inside a role=dialog / aria-modal -> treat as "busy" so the
  // shortcut doesn't stack on an open modal.
  if (typeof target.closest === "function") {
    try {
      if (target.closest('[role="dialog"]')) return true;
      if (target.closest('[aria-modal="true"]')) return true;
    } catch {
      /* noop */
    }
  }
  return false;
}

/**
 * Exact gate for the "show shortcuts" binding. Returns true iff the
 * event should open the help overlay. Matches "?" (Shift+/) and
 * straight "?" on a US layout, but NOT when any other modifier
 * (Ctrl/Alt/Meta) is held — those combinations belong to the OS or
 * the browser.
 */
export interface ShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: MinimalTarget | null;
  defaultPrevented?: boolean;
}

export function shouldOpenShortcutsHelp(e: ShortcutEventLike): boolean {
  if (!e || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key !== "?") return false;
  return !isEditableTarget(e.target ?? null);
}
