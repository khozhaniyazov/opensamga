/**
 * s35 wave 44 (2026-04-28) — pure helper for the "N сообщений"
 * count chip used by `ChatHeader` subtitle (and any other place
 * that wants to render a bare message-count noun without the
 * "Беседа: …" prefix that `transcriptLogAria` adds).
 *
 * Boss-spotted bug during the wave-44 sweep: ChatHeader subtitle
 * was using an inline `lang === "kz" ? "хабарлама" : "сообщений"`,
 * which produces "1 сообщений" / "2 сообщений" / "5 сообщений" —
 * always the genitive plural, regardless of count. The full RU
 * paucal table fixes it: 1 → "сообщение", 2-4 → "сообщения",
 * 5-20+ + teens 11-14 → "сообщений", with the units rule for
 * 21/22/.../31 etc.
 *
 * KZ stays uninflected ("хабарлама") — KZ doesn't have RU-style
 * paucal forms, so we return the count + the bare noun.
 *
 * Output (RU):
 *   0  → "0 сообщений"
 *   1  → "1 сообщение"
 *   2  → "2 сообщения"
 *   5  → "5 сообщений"
 *   11 → "11 сообщений"   (teens rule)
 *   21 → "21 сообщение"   (units rule: 21 ends in 1 → singular)
 *   22 → "22 сообщения"
 *   25 → "25 сообщений"
 *
 * Output (KZ):
 *   N  → "N хабарлама"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * lang and null/NaN/Infinity/negative/float counts.
 */

export type MessageCountLang = "ru" | "kz";

function safeCount(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

/** Pure helper — return the RU-paucal noun form for "сообщение". */
export function messageNounRu(n: number): string {
  const idx = ruPluralIndex(safeCount(n));
  if (idx === 0) return "сообщение";
  if (idx === 1) return "сообщения";
  return "сообщений";
}

/** Pure helper — full "N сообщений" label. */
export function messageCountLabel(args: {
  count: number | null | undefined;
  lang: MessageCountLang;
}): string {
  const langSafe: MessageCountLang = args.lang === "kz" ? "kz" : "ru";
  const n = safeCount(args.count);

  if (langSafe === "kz") {
    return `${n} хабарлама`;
  }

  return `${n} ${messageNounRu(n)}`;
}
