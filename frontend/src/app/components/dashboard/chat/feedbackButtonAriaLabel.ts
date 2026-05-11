/**
 * s35 wave 20b (2026-04-28) — pure helper for the
 * `FeedbackButtons` thumbs-up / thumbs-down per-message buttons'
 * `aria-label`.
 *
 * Today both buttons pass the bare verb ("Полезно" / "Не полезно")
 * into `aria-label`. `aria-pressed` already encodes the toggle
 * state, but JAWS / NVDA only announce that as "pressed" /
 * "not pressed" tail-suffix — the user has no localised cue that
 * tapping again *removes* their rating, and no acknowledgement of
 * the active state in the label itself. This helper folds the
 * active-state + toggle hint into the label:
 *
 *   inactive up / RU   : "Полезно"
 *   inactive down / RU : "Не полезно"
 *   active up / RU     : "Полезно — нажмите ещё раз, чтобы убрать оценку"
 *   active down / RU   : "Не полезно — нажмите ещё раз, чтобы убрать оценку"
 *   inactive up / KZ   : "Пайдалы"
 *   active up / KZ     : "Пайдалы — бағаны алу үшін қайта басыңыз"
 *   ...etc
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * direction / lang via explicit fallbacks.
 *
 * The component additionally toggles `aria-pressed` (booleans) so
 * AT users still get the SR-builtin "pressed" announcement; the
 * label-level cue is complementary, not redundant — particularly
 * for AT modes that don't surface `aria-pressed` (older browsers,
 * legacy AT versions).
 */

export type FeedbackButtonDirection = "up" | "down";

export type FeedbackButtonLang = "ru" | "kz";

export interface FeedbackButtonAriaLabelArgs {
  direction: FeedbackButtonDirection;
  /** Whether *this* direction is currently the active rating
   *  (`rating === 1` for up, `rating === -1` for down). */
  active: boolean;
  lang: FeedbackButtonLang;
}

/** Pure helper — full state-aware aria-label string. */
export function feedbackButtonAriaLabel(
  args: FeedbackButtonAriaLabelArgs,
): string {
  const langSafe: FeedbackButtonLang = args.lang === "kz" ? "kz" : "ru";
  const dirSafe: FeedbackButtonDirection =
    args.direction === "down" ? "down" : "up";
  const base =
    langSafe === "kz"
      ? dirSafe === "down"
        ? "Пайдалы емес"
        : "Пайдалы"
      : dirSafe === "down"
        ? "Не полезно"
        : "Полезно";
  if (!args.active) return base;
  const tail =
    langSafe === "kz"
      ? "бағаны алу үшін қайта басыңыз"
      : "нажмите ещё раз, чтобы убрать оценку";
  return `${base} — ${tail}`;
}
