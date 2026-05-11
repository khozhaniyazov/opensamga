/**
 * s35 wave 19b (2026-04-28) — pure helper for the
 * `MessageActions` Regenerate button's `aria-label`.
 *
 * Today the regenerate button passes the same flat `regenLabel`
 * ("Перегенерировать" / "Қайталау") into both `aria-label` and
 * `title`, with the disabled-state explanation only surfacing in
 * `title` (sighted hover). SR users hitting a disabled button hear
 * just "Перегенерировать, button, dimmed" with no reason — they
 * don't know that the button is intentionally disabled because
 * regeneration only applies to the last assistant turn.
 *
 * This helper folds the disabled-state explanation into the
 * aria-label itself, mirroring the wave-17b
 * `composerSendButtonAriaLabel` 4-state pattern (ready / disabled-
 * with-reason).
 *
 *   enabled  / RU : "Перегенерировать"
 *   enabled  / KZ : "Қайталау"
 *   disabled / RU : "Перегенерировать (доступно только для последнего ответа)"
 *   disabled / KZ : "Қайталау (тек соңғы жауап үшін қолжетімді)"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * unknown `lang`.
 */

export type RegenerateButtonLang = "ru" | "kz";

export interface RegenerateButtonAriaArgs {
  /** Whether regeneration is currently allowed (typically the
   *  component's `canRegen` flag — true when this is the tail
   *  assistant turn AND the prior message is a user turn). */
  canRegen: boolean;
  /** Optional override for the enabled-state base label (typically
   *  the resolved `t("chat.action.regenerate")`). When null /
   *  empty / whitespace, the helper falls back to its localised
   *  default. */
  enabledLabel?: string | null;
  lang: RegenerateButtonLang;
}

function safeLabel(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Pure helper — full state-aware aria-label string. */
export function regenerateButtonAria(args: RegenerateButtonAriaArgs): string {
  const langSafe: RegenerateButtonLang = args.lang === "kz" ? "kz" : "ru";
  const fallback = langSafe === "kz" ? "Қайталау" : "Перегенерировать";
  const base = safeLabel(args.enabledLabel) ?? fallback;
  if (args.canRegen) return base;
  // Disabled — append the reason in parentheses.
  const reason =
    langSafe === "kz"
      ? "тек соңғы жауап үшін қолжетімді"
      : "доступно только для последнего ответа";
  return `${base} (${reason})`;
}
