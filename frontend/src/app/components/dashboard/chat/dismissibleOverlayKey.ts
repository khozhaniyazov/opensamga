/**
 * s35 wave 37 (2026-04-28) — pure predicate for "did the user press
 * a key that should dismiss this overlay?"
 *
 * Used by OnboardingTour to make Escape skip the tour. The tour's
 * `aria-modal` is intentionally `"false"` (it doesn't trap focus —
 * boss-confirmed UX: tour skips don't block the page), but a
 * dismissible overlay still owes the user an Escape exit. A keyboard
 * user landing on the dialog with autoFocus on "Next" can't tab back
 * to the page below without first dismissing, so Escape MUST work or
 * the tour becomes a soft trap.
 *
 * Pure helper, not a hook, so the same predicate can be unit-pinned
 * across browsers and the consumer keeps full control of effect
 * lifecycle (mount/unmount listeners only when `active`).
 *
 * Defensive: only `Escape` matches. We don't accept legacy "Esc"
 * (IE-era), don't accept `key === undefined`, don't accept random
 * strings — strict equality keeps a future global keymap from
 * accidentally widening the dismissal surface.
 *
 * Pure: no DOM, no React, no Intl.
 */

interface Args {
  /** `KeyboardEvent.key`. Anything that isn't strictly "Escape"
   *  must NOT trigger dismissal. */
  key: unknown;
  /** Overlay's active flag. Even an Escape press must be ignored
   *  while the overlay is closed (defence against stale listeners
   *  that haven't unmounted yet). */
  active: unknown;
}

function safeBool(v: unknown): boolean {
  return v === true;
}

/** Should the overlay dismiss on this key event? */
export function shouldDismissOverlayOnKey({ key, active }: Args): boolean {
  if (!safeBool(active)) return false;
  return key === "Escape";
}
