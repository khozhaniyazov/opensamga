/**
 * s35 wave 22b (2026-04-28) — pure helpers for the
 * `ClearConfirmModal` accessibility wire-up.
 *
 * Today the destructive "Очистить" / "Тазалау" button on the
 * confirm dialog ships only the bare verb as its visible text and
 * has no aria-label. SR users hear "Очистить, button" with no
 * indication that this action is irreversible — the consequence
 * sentence ("Все сообщения будут удалены. Это действие нельзя
 * отменить.") sits in a separate `<p>` that's not bound to either
 * the dialog (`aria-describedby`) or the button itself. So a user
 * who tabs straight from the dialog opener to the destructive
 * button can fire it without the warning ever being spoken.
 *
 * This wave fixes both gaps with two pure helpers:
 *   1. `clearConfirmDescriptionId` — single source of truth for
 *      the body paragraph's id, used both as the `<p id=...>`
 *      attribute and as the dialog's `aria-describedby` so SR
 *      users hear the consequence the moment the dialog opens.
 *   2. `clearConfirmDestructiveAriaLabel` — composes a
 *      consequence-aware aria-label for the destructive button,
 *      so even if the user tabs past the description, the action
 *      itself spells out what it does.
 *
 *   RU : "Очистить чат — удалить все сообщения, действие необратимо"
 *   KZ : "Чатты тазалау — барлық хабарламалар жойылады, әрекет қайтарылмайды"
 *
 * `clearConfirmCancelAriaLabel` mirrors the cancel button so SR
 * users hear it as the safe-default action.
 *
 *   RU : "Отмена — закрыть без удаления"
 *   KZ : "Болдырмау — жоюсыз жабу"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * lang.
 */

export type ClearConfirmLang = "ru" | "kz";

/** Stable DOM id for the body paragraph. The dialog references
 *  this via `aria-describedby` so the consequence sentence is
 *  announced on open. Single export so both the consumer's JSX
 *  and the dialog's aria-describedby read from the same string —
 *  no drift possible. */
export const CLEAR_CONFIRM_DESCRIPTION_ID = "clear-confirm-description";

/** Pure helper — destructive-button aria-label. */
export function clearConfirmDestructiveAriaLabel(
  lang: ClearConfirmLang,
): string {
  const langSafe: ClearConfirmLang = lang === "kz" ? "kz" : "ru";
  if (langSafe === "kz") {
    return "Чатты тазалау — барлық хабарламалар жойылады, әрекет қайтарылмайды";
  }
  return "Очистить чат — удалить все сообщения, действие необратимо";
}

/** Pure helper — cancel-button aria-label. */
export function clearConfirmCancelAriaLabel(lang: ClearConfirmLang): string {
  const langSafe: ClearConfirmLang = lang === "kz" ? "kz" : "ru";
  if (langSafe === "kz") {
    return "Болдырмау — жоюсыз жабу";
  }
  return "Отмена — закрыть без удаления";
}
