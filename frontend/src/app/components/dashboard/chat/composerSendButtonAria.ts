/**
 * s35 wave 17b (2026-04-28) — pure helper for the composer's
 * send-button `aria-label` and `title`.
 *
 * Today the button uses a single static label ("Send" / "Отправить")
 * regardless of why it's disabled. SR users tabbing onto a greyed-out
 * send button only hear "Send, button, dimmed" — they have to figure
 * out the *reason* (empty input vs over-limit vs in-flight) from
 * elsewhere on the page.
 *
 * This helper composes a richer label that explains the current
 * state, while keeping the happy-path label identical to the
 * legacy translation key:
 *
 *   - sending (isSending)         → "Stop and resend / Остановите ответ перед новой отправкой"
 *     (purely defensive — UI swaps to the Stop button in this
 *     state, but if a caller ever renders the Send button while
 *     isSending=true, the SR still gets a coherent reason.)
 *   - over the hard limit         → "Сообщение слишком длинное (N из M символов)"
 *   - empty / whitespace input    → "Введите сообщение, чтобы отправить"
 *   - happy path                  → "Отправить (Enter)"
 *
 * KZ mirror is provided for every branch.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * non-finite numbers. The `lang` argument is the same RU/KZ
 * channel every other s35 helper uses — unknown values fall back
 * to RU. The optional `sendLabel` argument lets the caller forward
 * the existing i18n key value ("chat.send") so the happy-path text
 * stays consistent with the project translation table; if it's
 * missing or empty, the helper falls back to a hard-coded
 * "Отправить" / "Жіберу".
 */

export type ComposerSendButtonLang = "ru" | "kz";

export type ComposerSendButtonState =
  | "ready"
  | "empty"
  | "over-limit"
  | "sending";

export interface ComposerSendButtonAriaArgs {
  /** Raw textarea value. Whitespace-only is treated as empty. */
  input: string | null | undefined;
  /** Hard cap on character count (matches the `HARD_LIMIT`
   *  constant in ChatComposer). Falls back to Number.MAX_SAFE_INTEGER
   *  when null / non-finite, which means we never report
   *  "over-limit" if the caller hasn't passed a real cap. */
  hardLimit: number | null | undefined;
  /** True iff a response is currently streaming. Even though the
   *  visible button swaps to a Stop control in this state, we
   *  still expose the right SR text for defensive callers. */
  isSending: boolean;
  /** Optional override for the happy-path "Send" label — typically
   *  the value of `t("chat.send")`. */
  sendLabel?: string | null;
  lang: ComposerSendButtonLang;
}

/** Pure predicate — derives the high-level state. Exported so
 *  callers (and vitest) can pin it independently. */
export function composerSendButtonState(
  args: ComposerSendButtonAriaArgs,
): ComposerSendButtonState {
  if (args.isSending) return "sending";
  const safeInput = typeof args.input === "string" ? args.input : "";
  const cap =
    typeof args.hardLimit === "number" && Number.isFinite(args.hardLimit)
      ? args.hardLimit
      : Number.MAX_SAFE_INTEGER;
  if (safeInput.length > cap) return "over-limit";
  if (safeInput.trim().length === 0) return "empty";
  return "ready";
}

/** Pure helper — full aria-label for the button. */
export function composerSendButtonAriaLabel(
  args: ComposerSendButtonAriaArgs,
): string {
  const langSafe: ComposerSendButtonLang = args.lang === "kz" ? "kz" : "ru";
  const state = composerSendButtonState(args);
  const sendFallback = langSafe === "kz" ? "Жіберу" : "Отправить";
  const happy =
    typeof args.sendLabel === "string" && args.sendLabel.trim().length > 0
      ? args.sendLabel.trim()
      : sendFallback;

  if (state === "ready") {
    return langSafe === "kz" ? `${happy} (Enter)` : `${happy} (Enter)`;
  }

  if (state === "empty") {
    return langSafe === "kz"
      ? "Жіберу үшін хабарлама теріңіз"
      : "Введите сообщение, чтобы отправить";
  }

  if (state === "over-limit") {
    const safeInput = typeof args.input === "string" ? args.input : "";
    const cap =
      typeof args.hardLimit === "number" && Number.isFinite(args.hardLimit)
        ? args.hardLimit
        : Number.MAX_SAFE_INTEGER;
    return langSafe === "kz"
      ? `Хабарлама тым ұзын (${safeInput.length} / ${cap} таңба)`
      : `Сообщение слишком длинное (${safeInput.length} из ${cap} символов)`;
  }

  // sending
  return langSafe === "kz"
    ? "Алдыңғы жауап аяқталғанша күтіңіз"
    : "Дождитесь окончания ответа перед новой отправкой";
}

/** Pure helper — the visible `title` tooltip. We deliberately
 *  reuse the aria-label string for tooltip parity, but expose a
 *  named export so callers don't have to encode the equivalence
 *  themselves. */
export function composerSendButtonTitle(
  args: ComposerSendButtonAriaArgs,
): string {
  return composerSendButtonAriaLabel(args);
}
