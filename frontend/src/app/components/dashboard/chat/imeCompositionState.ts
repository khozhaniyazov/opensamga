/**
 * s35 wave 37 (2026-04-28) — pure state-transition helper for the
 * ChatComposer's IME (input-method-editor) composing flag.
 *
 * Background: `composerHintAriaText` already accepts a `composing`
 * argument that suppresses the "Enter — отправить" SR cue while a
 * CJK / Korean / Cyrillic-with-accents composition is mid-flight
 * (Enter would commit the IME glyph rather than send the message,
 * so announcing send-on-Enter would be wrong). Pre-wave the
 * ChatComposer hard-coded `composing: false` because there was no
 * IME state listener on the textarea — the helper's smartness was
 * inert for any user typing through an IME.
 *
 * This helper is the pure FSM: given the next composition event
 * type and the previous flag, return the new flag. The caller wires
 * it to `onCompositionStart` / `onCompositionEnd` (and treats any
 * other event as a no-op so accidental wiring doesn't drop state).
 *
 * Why a helper, not just inline `setState(true/false)`:
 *   1. Defensive: unknown event types must not reset state — if a
 *      future framework upgrade re-types the handler signature, we
 *      shouldn't silently flip composing back to false.
 *   2. Boolean-coercion-safe: callers that pass `1` / `"yes"` / `0`
 *      should not accidentally satisfy a strict-boolean check —
 *      mirrors the rest of the chat-helper layer (cf.
 *      composerHintAria, chatAnimationClasses).
 *   3. Testable in isolation — vitest pin guards against silent
 *      state drift across browsers (Safari's compositionupdate
 *      semantics differ from Chromium's).
 *
 * Pure: no DOM, no React, no Intl.
 */

export type ImeEventType =
  | "compositionstart"
  | "compositionupdate"
  | "compositionend";

interface Args {
  /** Next composition event's `type` (or any unknown string). */
  eventType: unknown;
  /** Previous composing flag. */
  prev: unknown;
}

function safeBool(v: unknown): boolean {
  return v === true;
}

/**
 * Compute the next `composing` flag.
 *
 * Rules:
 *   - "compositionstart" → true
 *   - "compositionend"   → false
 *   - "compositionupdate" → unchanged (composition is mid-flight)
 *   - anything else      → unchanged (defensive — never silently
 *                          drops state)
 *
 * `prev` is coerced to a strict boolean so non-boolean inputs don't
 * mask bugs upstream.
 */
export function nextImeComposing({ eventType, prev }: Args): boolean {
  const safePrev = safeBool(prev);
  if (eventType === "compositionstart") return true;
  if (eventType === "compositionend") return false;
  // compositionupdate or any other type: state unchanged.
  return safePrev;
}

/**
 * Predicate: should the textarea suppress its Enter-sends-message
 * behaviour right now?  True if either the React synthetic event
 * reports `isComposing` (Chromium / Firefox) OR our tracked
 * composition flag is still true (Safari edge cases where
 * `isComposing` is not set on the trailing keydown).
 *
 * Defence-in-depth — both signals are OR'd so a missing flag on
 * either side doesn't accidentally send a half-composed glyph.
 */
export function shouldSuppressEnterForIme({
  reactIsComposing,
  trackedComposing,
}: {
  reactIsComposing: unknown;
  trackedComposing: unknown;
}): boolean {
  return safeBool(reactIsComposing) || safeBool(trackedComposing);
}
