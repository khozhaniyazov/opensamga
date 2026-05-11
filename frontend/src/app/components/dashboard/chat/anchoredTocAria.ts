/**
 * s35 wave 23b (2026-04-28) — pure helpers for AnchoredToc's
 * accessibility wire-up.
 *
 * Two micro-gaps in the existing AnchoredToc, surfaced by reading
 * through the s35 a11y sweep:
 *
 * 1. The "Содержание" / "Мазмұны" toggle button currently has
 *    aria-label="Скрыть содержание" / "Показать содержание" with
 *    NO mention of the entry count. Long answers can have 8-15
 *    headings; SR users have no idea how big the table of contents
 *    is until they expand it. Same problem the wave-15b row label
 *    solved for ThreadRail. Output:
 *
 *      open  RU + 4 entries → "Скрыть содержание, 4 раздела"
 *      open  RU + 11 entries → "Скрыть содержание, 11 разделов" (genitive)
 *      closed RU + 1 entry  → "Показать содержание, 1 раздел"
 *      KZ                    → "Мазмұнды жасыру/ашу, N бөлім" (uninflected)
 *
 * 2. Each TOC entry button is a bare `<button>{e.text}</button>` —
 *    no aria-label, so SR users hear just the heading text with
 *    no level cue. h3 sub-headings are visually indented via the
 *    `pl-4` class but the indent itself is invisible to AT users.
 *    Adding an explicit "Перейти к разделу: …" prefix and a
 *    "(подраздел)" suffix for level-3 entries closes the gap:
 *
 *      level=2 RU → "Перейти к разделу: Введение"
 *      level=3 RU → "Перейти к подразделу: Доказательство"
 *      level=2 KZ → "Бөлімге өту: Кіріспе"
 *      level=3 KZ → "Ішкі бөлімге өту: Дәлелдеу"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null/empty
 * heading text (falls back to "(без названия)" / "(атаусыз)") and
 * unknown lang.
 */

export type AnchoredTocLang = "ru" | "kz";

export interface TocToggleAriaArgs {
  open: boolean;
  /** Number of entries in the table of contents. Coerced to
   *  non-negative int. */
  count: number | null | undefined;
  lang: AnchoredTocLang;
}

export interface TocEntryAriaArgs {
  /** The visible heading text. Null/empty/whitespace falls back
   *  to "(без названия)" / "(атаусыз)". */
  text: string | null | undefined;
  /** Heading level — 2 (top) or 3 (sub). Other values default to
   *  2. */
  level: number | null | undefined;
  lang: AnchoredTocLang;
}

function safeIntCount(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  // 1 → singular, 2-4 → paucal, 5-20 + teens 11-14 → genitive
  // plural, 21 → singular. Locked-in across s35 helpers.
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

/** Pure helper — toggle-button aria-label including entry count. */
export function tocToggleAria(args: TocToggleAriaArgs): string {
  const langSafe: AnchoredTocLang = args.lang === "kz" ? "kz" : "ru";
  const count = safeIntCount(args.count);

  if (langSafe === "kz") {
    const verb = args.open ? "Мазмұнды жасыру" : "Мазмұнды ашу";
    if (count === 0) return verb;
    return `${verb}, ${count} бөлім`;
  }
  const verb = args.open ? "Скрыть содержание" : "Показать содержание";
  if (count === 0) return verb;
  const idx = ruPluralIndex(count);
  const noun = idx === 0 ? "раздел" : idx === 1 ? "раздела" : "разделов";
  return `${verb}, ${count} ${noun}`;
}

/** Pure helper — per-entry button aria-label with level cue. */
export function tocEntryAria(args: TocEntryAriaArgs): string {
  const langSafe: AnchoredTocLang = args.lang === "kz" ? "kz" : "ru";
  const fallback = langSafe === "kz" ? "(атаусыз)" : "(без названия)";
  const textSafe =
    typeof args.text === "string" && args.text.trim().length > 0
      ? args.text.trim()
      : fallback;
  const level =
    typeof args.level === "number" &&
    Number.isFinite(args.level) &&
    args.level === 3
      ? 3
      : 2;

  if (langSafe === "kz") {
    const head = level === 3 ? "Ішкі бөлімге өту" : "Бөлімге өту";
    return `${head}: ${textSafe}`;
  }
  const head = level === 3 ? "Перейти к подразделу" : "Перейти к разделу";
  return `${head}: ${textSafe}`;
}
