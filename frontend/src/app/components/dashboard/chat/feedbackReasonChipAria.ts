/**
 * s35 wave 21b (2026-04-28) — pure helper for the
 * `FeedbackButtons` per-reason chip's `aria-label`.
 *
 * The thumbs-down popover renders 4 canned-reason chips (RU/KZ
 * lists from `feedbackReasons.ts`). Today the chip buttons are
 * bare `<button>` elements with no `aria-label`, no `aria-pressed`,
 * and no role context — SR users tabbing into the popover hear
 * just the chip text ("Неточный", "Слишком общий", etc.) with no
 * indication that:
 *  (1) the chip is a *toggle* (clicking again deselects);
 *  (2) the chip's *current* selection state.
 * This helper composes a contextual aria-label that includes the
 * chip's selection state and the toggle hint when active:
 *
 *   inactive RU : "Причина: «Неточный»"
 *   active   RU : "Причина: «Неточный» — выбрано, нажмите ещё раз, чтобы снять"
 *   inactive KZ : "Себеп: «Дәл емес»"
 *   active   KZ : "Себеп: «Дәл емес» — таңдалды, алу үшін қайта басыңыз"
 *
 * The chip already toggles through component-level
 * `setReason(active ? null : r.id)` — this is purely an SR
 * reasonability patch; visible chrome (rose-50 active tint, pill
 * shape) doesn't change.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * empty / whitespace label and unknown lang.
 */

export type FeedbackReasonChipLang = "ru" | "kz";

export interface FeedbackReasonChipAriaArgs {
  /** The chip's localised label as rendered (e.g. "Неточный").
   *  Null/empty/whitespace falls back to "Без названия" (RU) /
   *  "Атаусыз" (KZ). */
  label: string | null | undefined;
  /** Whether this chip is the currently selected reason. */
  active: boolean;
  lang: FeedbackReasonChipLang;
}

/** Pure helper — full state-aware aria-label string. */
export function feedbackReasonChipAria(
  args: FeedbackReasonChipAriaArgs,
): string {
  const langSafe: FeedbackReasonChipLang = args.lang === "kz" ? "kz" : "ru";
  const fallback = langSafe === "kz" ? "Атаусыз" : "Без названия";
  const labelSafe =
    typeof args.label === "string" && args.label.trim().length > 0
      ? args.label.trim()
      : fallback;
  const head =
    langSafe === "kz" ? `Себеп: «${labelSafe}»` : `Причина: «${labelSafe}»`;
  if (!args.active) return head;
  const tail =
    langSafe === "kz"
      ? "таңдалды, алу үшін қайта басыңыз"
      : "выбрано, нажмите ещё раз, чтобы снять";
  return `${head} — ${tail}`;
}
