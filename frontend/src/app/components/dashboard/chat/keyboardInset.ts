/**
 * s34 wave 2 (G2, 2026-04-28) — virtual-keyboard inset helpers.
 *
 * Boss roadmap row G2: "Sticky composer on mobile, no virtual-
 * keyboard layout shift". The historic problem on iOS Safari and
 * Chrome Android: when the soft keyboard pops up, the layout
 * viewport doesn't change but the visual viewport does — meaning a
 * `position: sticky; bottom: 0` composer ends up *underneath* the
 * keyboard, and the chat scroll container snaps to the wrong
 * height. The composer needs to know how many pixels are obscured
 * by the keyboard and lift itself by that amount.
 *
 * `window.visualViewport.height` reports the height *after*
 * keyboard reveal; `window.innerHeight` (or `100dvh`) reports the
 * full layout-viewport height. The difference is the keyboard
 * inset. Subscribe to `visualViewport.resize` to keep this in sync
 * during keyboard show/hide animations.
 *
 * Pure helpers here so the math is testable without a browser; the
 * subscription hook lives in `useKeyboardInset.ts`.
 */

/** When the visual viewport differs from the layout viewport by
 *  less than this many pixels, treat the difference as noise (some
 *  browsers report tiny non-keyboard deltas during scroll-bar
 *  flicker). 80px is the empirically-safe floor for "real keyboard"
 *  vs "browser chrome shimmer" on iOS Safari + Chrome Android. */
export const KEYBOARD_INSET_NOISE_FLOOR_PX = 80;

/** Cap for the inset we'll ever report — guards against runaway
 *  values during browser bugs (Safari has been observed reporting
 *  negative or absurdly-large viewport heights mid-orientation
 *  change). 600px is more than any real keyboard takes. */
export const KEYBOARD_INSET_MAX_PX = 600;

/** Pure helper — given the layout-viewport height and the
 *  visual-viewport height, return how many pixels the keyboard
 *  obscures. Returns 0 when there's no keyboard, when inputs are
 *  invalid, or when the delta is below the noise floor.
 *
 *  Examples:
 *    computeKeyboardInset(800, 800) === 0              // no keyboard
 *    computeKeyboardInset(800, 480) === 320            // keyboard up
 *    computeKeyboardInset(800, 750) === 0              // < noise floor
 *    computeKeyboardInset(800, 100) === 600            // capped
 */
export function computeKeyboardInset(
  layoutHeight: number | null | undefined,
  visualHeight: number | null | undefined,
): number {
  if (typeof layoutHeight !== "number" || !Number.isFinite(layoutHeight)) {
    return 0;
  }
  if (typeof visualHeight !== "number" || !Number.isFinite(visualHeight)) {
    return 0;
  }
  if (layoutHeight <= 0 || visualHeight <= 0) return 0;
  const delta = layoutHeight - visualHeight;
  if (delta < KEYBOARD_INSET_NOISE_FLOOR_PX) return 0;
  if (delta > KEYBOARD_INSET_MAX_PX) return KEYBOARD_INSET_MAX_PX;
  return Math.round(delta);
}

/** Pure helper — produce the CSS `padding-bottom` value the composer
 *  wrapper should apply. We always include `env(safe-area-inset-
 *  bottom)` for hardware notch/home-bar inset, then layer the
 *  computed keyboard inset on top in pixels.
 *
 *  Returns the value as a CSS calc() string so it can drop
 *  straight into `style={{ paddingBottom: ... }}`.
 */
export function composerPaddingBottomCss(keyboardInsetPx: number): string {
  const safeInset = "env(safe-area-inset-bottom)";
  if (keyboardInsetPx <= 0) {
    return `max(1rem, ${safeInset})`;
  }
  return `calc(max(1rem, ${safeInset}) + ${Math.round(keyboardInsetPx)}px)`;
}

/** Pure helper — does the composer need to lift itself right now?
 *  Convenience boolean for class-toggling (e.g. a CSS variable
 *  that disables transitions during keyboard reveal so the lift
 *  doesn't visibly animate). */
export function isKeyboardLifted(keyboardInsetPx: number): boolean {
  return keyboardInsetPx > 0;
}

/** s35 wave 43 (2026-04-28) — environment shape consumed by
 *  `shouldTrackKeyboardInset`. Pulled into its own type so the
 *  hook can build it from `window` and the tests can build it
 *  from a literal.
 *
 *  - `hasTouchStart`: `'ontouchstart' in window` — true on every
 *    real touchscreen device, false on every desktop browser
 *    that doesn't have a touchscreen.
 *  - `coarsePointerMatches`: `window.matchMedia('(any-pointer: coarse)').matches`
 *    — true when the device has a coarse pointer (touch / stylus).
 *    `null` when matchMedia is unavailable (older Firefox / SSR).
 *  - `hasVisualViewport`: whether `window.visualViewport` exists —
 *    we still respect the existing API-presence gate so we don't
 *    return false on a touch device that lacks the API.
 */
export interface KeyboardInsetEnv {
  hasTouchStart: boolean;
  coarsePointerMatches: boolean | null;
  hasVisualViewport: boolean;
}

/** s35 wave 43 (2026-04-28) — should the hook actually subscribe
 *  to `visualViewport` resize events on this device?
 *
 *  Why this exists: on desktop Chrome / Firefox / Edge, the
 *  visualViewport API is present and CAN report deltas vs the
 *  layout viewport during scrollbar flicker, modal open/close,
 *  or large-DOM mutations (e.g. appending a new chat bubble +
 *  forcing the transcript to recompute scrollHeight). Those
 *  deltas can briefly exceed the 80px noise floor, the hook
 *  reports a non-zero inset, the composer wrapper grows by
 *  hundreds of px of padding, and the transcript flex child
 *  gets squeezed to 0px tall — boss reported this as "composer
 *  jumped to the top of the screen" after sending a Cyrillic
 *  message. Reload was the only recovery.
 *
 *  Fix: only track the inset on devices that genuinely have a
 *  software keyboard. Touch capability is the right proxy:
 *
 *    - `'ontouchstart' in window` is true on every real
 *      touchscreen (phones, tablets, hybrid laptops with touch).
 *    - `(any-pointer: coarse)` is true on the same set, and
 *      additionally on stylus-only devices.
 *    - Either signal alone suffices; we OR them together so a
 *      touchscreen Windows laptop without `ontouchstart` (rare
 *      but exists) still gets the lift.
 *
 *  The visualViewport gate stays — if the API is missing we have
 *  nothing to subscribe to anyway.
 *
 *  Edge case: a desktop browser with the dev-tools "device
 *  toolbar" active spoofs `ontouchstart`. That's the right
 *  behaviour — the dev WANTS to test mobile-shaped behaviour.
 */
export function shouldTrackKeyboardInset(env: KeyboardInsetEnv): boolean {
  if (!env.hasVisualViewport) return false;
  if (env.hasTouchStart) return true;
  if (env.coarsePointerMatches === true) return true;
  return false;
}
