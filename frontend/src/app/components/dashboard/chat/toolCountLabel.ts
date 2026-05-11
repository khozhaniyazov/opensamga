/**
 * s35 wave 44 (2026-04-28) — pure helper for the "N инструмент(а/ов)"
 * count label used by `ToolCallTimeline` step header and by
 * `reasoningHeader.buildDoneLabel`.
 *
 * Boss-spotted bug during the wave-44 sweep: ToolCallTimeline
 * step header was using an inline `n === 1 ? "1 инструмент" :
 * \`${n} инструментов\`` — but for n=2/3/4 the RU paucal form is
 * "инструмента", not "инструментов". `reasoningHeader.ts` got it
 * right via `pluralRuTools`, ToolCallTimeline didn't. Same noun,
 * different code path, drifted.
 *
 * Fix: single shared helper with the full paucal table. KZ stays
 * uninflected ("құрал") — KZ doesn't have RU-style paucal forms.
 *
 * Output (RU):
 *   0  → "0 инструментов"
 *   1  → "1 инструмент"
 *   2  → "2 инструмента"
 *   5  → "5 инструментов"
 *   11 → "11 инструментов"   (teens rule)
 *   21 → "21 инструмент"     (units rule: 21 ends in 1 → singular)
 *   22 → "22 инструмента"
 *   25 → "25 инструментов"
 *
 * Output (KZ):
 *   N → "N құрал"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * lang and null/NaN/Infinity/negative/float counts.
 */

export type ToolCountLang = "ru" | "kz";

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

/** Pure helper — return the RU-paucal noun form for "инструмент". */
export function toolNounRu(n: number): string {
  const idx = ruPluralIndex(safeCount(n));
  if (idx === 0) return "инструмент";
  if (idx === 1) return "инструмента";
  return "инструментов";
}

/** Pure helper — full "N инструмент(а/ов)" label. */
export function toolCountLabel(args: {
  count: number | null | undefined;
  lang: ToolCountLang;
}): string {
  const langSafe: ToolCountLang = args.lang === "kz" ? "kz" : "ru";
  const n = safeCount(args.count);

  if (langSafe === "kz") {
    return `${n} құрал`;
  }

  return `${n} ${toolNounRu(n)}`;
}
