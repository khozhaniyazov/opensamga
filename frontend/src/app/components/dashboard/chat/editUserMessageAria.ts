/**
 * s35 wave 24b (2026-04-28) — pure helper for the per-user-message
 * "edit" pencil-button aria-label / title in ChatTranscript.
 *
 * Live recon found two visible papercuts on the edit affordance:
 *
 *  1. The button's `aria-label="Изменить"` is the bare verb.
 *     Clicking it doesn't actually edit in-place — it seeds the
 *     composer with the message text and TRUNCATES the conversation
 *     from that point onward (see ChatTranscript: `seedComposer +
 *     truncateFrom(msg.id)`). That destructive consequence is
 *     invisible to SR users; the button reads like a benign
 *     "rename" pencil.
 *
 *  2. There's no preview cue. When a user has 5 turns and hovers a
 *     pencil on turn 2, they get no AT cue that turn 2's button is
 *     about to delete turns 3-5. We add a turn-aware fragment that
 *     names how many follow-up turns will be discarded, with the
 *     same RU paucal table the rest of s35 uses.
 *
 *  Examples (RU):
 *    no follow-ups  → "Изменить и переслать сообщение"
 *    1 follow-up    → "Изменить и переслать сообщение, 1 следующее сообщение будет удалено"
 *    2 follow-ups   → "Изменить и переслать сообщение, 2 следующих сообщения будут удалены"
 *    11 follow-ups  → "Изменить и переслать сообщение, 11 следующих сообщений будут удалены"
 *    21 follow-ups  → "Изменить и переслать сообщение, 21 следующее сообщение будет удалено"
 *
 *  KZ mirror — uninflected count, mirroring waves 21-23:
 *    no follow-ups  → "Хабарламаны өзгерту және қайта жіберу"
 *    N follow-ups   → "Хабарламаны өзгерту және қайта жіберу, N келесі хабарлама өшіріледі"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * negative / NaN / float follow-up counts and unknown lang.
 */

export type EditUserMessageLang = "ru" | "kz";

export interface EditUserMessageAriaArgs {
  /** Number of messages BELOW this user message that will be
   *  discarded when the user clicks edit (assistant + user
   *  combined). null/NaN/negative coerced to 0. */
  followUpCount: number | null | undefined;
  lang: EditUserMessageLang;
}

function safeIntCount(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  // 1 → singular, 2-4 → paucal, 5-20 + teens 11-14 → genitive
  // plural, 21 → singular. Mirrors the s35 paucal table.
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

/** Pure helper — full aria-label for the edit pencil. */
export function editUserMessageAria(args: EditUserMessageAriaArgs): string {
  const langSafe: EditUserMessageLang = args.lang === "kz" ? "kz" : "ru";
  const count = safeIntCount(args.followUpCount);

  if (langSafe === "kz") {
    const head = "Хабарламаны өзгерту және қайта жіберу";
    if (count === 0) return head;
    return `${head}, ${count} келесі хабарлама өшіріледі`;
  }

  const head = "Изменить и переслать сообщение";
  if (count === 0) return head;
  const idx = ruPluralIndex(count);
  if (idx === 0) {
    // singular agrees with the noun phrase + verb.
    return `${head}, ${count} следующее сообщение будет удалено`;
  }
  if (idx === 1) {
    // paucal — plural noun, plural verb agreement.
    return `${head}, ${count} следующих сообщения будут удалены`;
  }
  return `${head}, ${count} следующих сообщений будут удалены`;
}

/** Pure helper — short visible tooltip (matches the bare-verb
 *  fallback so the visible chrome stays compact on hover). */
export function editUserMessageTitle(lang: EditUserMessageLang): string {
  const langSafe: EditUserMessageLang = lang === "kz" ? "kz" : "ru";
  return langSafe === "kz" ? "Өзгерту" : "Изменить";
}
