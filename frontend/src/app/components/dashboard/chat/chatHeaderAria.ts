/**
 * s35 wave 23a (2026-04-28) — pure helpers for ChatHeader's
 * usage-readout pill and clear-history button aria-labels.
 *
 * Two visible micro-bugs that show up on every screen-reader pass
 * of the chat header:
 *
 * 1. The usage pill renders just the bare numeric "12/40" with no
 *    aria-label, so SR users hear "12 slash 40, span" — no clue
 *    that this is a daily message-quota readout, no clue what
 *    happens at 40, no localised wording. We compose a phrase
 *    that names the metric, the remaining count, and the
 *    near-limit state so AT users hear the same warning sighted
 *    users get from the amber chrome.
 *
 *      under  RU : "Сегодня использовано 12 из 40 сообщений, осталось 28"
 *      near   RU : "Сегодня использовано 33 из 40 сообщений, осталось 7 — близко к лимиту"
 *      reached RU : "Сегодня использовано 40 из 40 сообщений, лимит достигнут"
 *      KZ mirrors  : "Бүгін …"
 *
 * 2. The clear-history (Trash2) button has aria-label="Очистить"
 *    only — the same problem we closed for ClearConfirmModal in
 *    wave-22b: SR users hear the bare verb with no consequence
 *    cue. We name the action target ("чат" / "чат") and the
 *    irreversibility cue, matching the modal's destructive-button
 *    label so the *opener* and the *confirm* read consistently.
 *
 *    The button still raises the modal — destructive intent is
 *    confirmed there — so this label is descriptive of what the
 *    *click* does (open the confirm dialog), not the eventual
 *    delete:
 *
 *      RU : "Очистить чат — откроется подтверждение"
 *      KZ : "Чатты тазалау — растау сұралады"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null/
 * negative/non-finite usage numbers and unknown lang.
 */

export type ChatHeaderLang = "ru" | "kz";

export interface ChatHeaderUsageAriaArgs {
  /** Messages used today. Coerced to non-negative int. */
  used: number | null | undefined;
  /** Daily message ceiling. <=0 → treated as "no limit set" and
   *  the helper falls back to bare-readout phrasing. */
  limit: number | null | undefined;
  lang: ChatHeaderLang;
}

function safeInt(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

/** Pure helper — usage-pill aria-label. */
export function chatHeaderUsageAria(args: ChatHeaderUsageAriaArgs): string {
  const langSafe: ChatHeaderLang = args.lang === "kz" ? "kz" : "ru";
  const used = safeInt(args.used);
  const limit = safeInt(args.limit);

  if (limit <= 0) {
    // No quota configured — read out the raw count as info, not a
    // limit warning.
    return langSafe === "kz"
      ? `Бүгін ${used} хабарлама пайдаланылды`
      : `Сегодня использовано ${used} сообщений`;
  }

  // Cap displayed `used` at limit for the "remaining" math but
  // keep the raw used in the spoken numerator so SR users still
  // hear the over-budget condition if it happens.
  const remaining = Math.max(0, limit - used);
  const reached = used >= limit;
  const near = !reached && used >= limit * 0.8;

  if (langSafe === "kz") {
    if (reached) {
      return `Бүгін ${limit}-ден ${used} хабарлама пайдаланылды, лимитке жетті`;
    }
    if (near) {
      return `Бүгін ${limit}-ден ${used} хабарлама пайдаланылды, ${remaining} қалды — лимитке жақын`;
    }
    return `Бүгін ${limit}-ден ${used} хабарлама пайдаланылды, ${remaining} қалды`;
  }
  if (reached) {
    return `Сегодня использовано ${used} из ${limit} сообщений, лимит достигнут`;
  }
  if (near) {
    return `Сегодня использовано ${used} из ${limit} сообщений, осталось ${remaining} — близко к лимиту`;
  }
  return `Сегодня использовано ${used} из ${limit} сообщений, осталось ${remaining}`;
}

/** Pure helper — clear-history button aria-label. The button
 *  raises the confirm modal; destructive consequence is on the
 *  modal's button (wave-22b). */
export function clearChatButtonAria(lang: ChatHeaderLang): string {
  const langSafe: ChatHeaderLang = lang === "kz" ? "kz" : "ru";
  if (langSafe === "kz") {
    return "Чатты тазалау — растау сұралады";
  }
  return "Очистить чат — откроется подтверждение";
}
