/**
 * s35 wave 14b (2026-04-28) — pure helper for the
 * `ScrollToBottomPill` aria-label.
 *
 * Boss bug: when the pill is showing an unread badge, the aria-label
 * was the bare numeric `"${count} · К последнему сообщению"`. SR
 * users had to mentally pair `3` with the localised noun for
 * "messages", and KZ users got the same Russian-style mid-dot
 * separator regardless of their interface language.
 *
 * This helper mirrors the wave-12 `redactionPillLabel` pattern:
 *   - returns the bare label when count is 0 / null / negative,
 *   - prefixes with `${count} ${noun} · ${label}` when count > 0,
 *   - applies RU plural rules (1 → новое сообщение, 2-4 → новых
 *     сообщения, 5-20 + teens → новых сообщений),
 *   - falls back to a single KZ form (`жаңа хабарлама`) since KZ
 *     does not inflect numerals against nouns.
 *
 * Pure: no DOM, no React, no clipboard. Vitest pins the entire
 * pluralisation table.
 */

export type ScrollPillLang = "ru" | "kz";

const PILL_LABEL_RU = "К последнему сообщению";
const PILL_LABEL_KZ = "Соңғы хабарламаға";

/** Russian plural-form picker. Mirrors the rule used by
 *  `redactionPillLabel` in wave 12: 1 → form-1; 2-4 → form-2; else
 *  → form-5. Teens 11-14 are explicitly form-5 to defend against
 *  the `mod 10 === 1` collision. Negative inputs are coerced to
 *  abs(). */
function ruPluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 2;
  if (mod10 === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4) return 1;
  return 2;
}

/** Pure helper — returns the localised plural noun for "new
 *  message(s)" given a positive integer count. Caller is
 *  responsible for guarding against zero / negative inputs. */
export function scrollToBottomPillNoun(
  count: number,
  lang: ScrollPillLang,
): string {
  if (lang === "kz") return "жаңа хабарлама";
  const idx = ruPluralIndex(count);
  if (idx === 0) return "новое сообщение";
  if (idx === 1) return "новых сообщения";
  return "новых сообщений";
}

/** Pure helper — full aria-label for the pill, given the unread
 *  count + the active language. */
export function scrollToBottomPillLabel(
  count: number | null | undefined,
  lang: ScrollPillLang,
): string {
  const base = lang === "kz" ? PILL_LABEL_KZ : PILL_LABEL_RU;
  const n =
    typeof count === "number" && Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return base;
  const noun = scrollToBottomPillNoun(n, lang);
  return `${n} ${noun} · ${base}`;
}
