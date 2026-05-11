/**
 * s35 wave 21a (2026-04-28) — pure helper for the
 * `ThreadRail` search-results live-region announcement.
 *
 * Today the search input filters threads as the user types, but
 * the result *count* is communicated only by visible row removal
 * (sighted) and a static "Ничего не найдено" empty paragraph
 * (visible to SR users only when zero matches). For SR users
 * filtering through 30+ pinned threads, the lack of count feedback
 * means they can't tell whether their query is too narrow / too
 * broad without tabbing through every remaining row.
 *
 * This helper composes a polite live-region announcement:
 *
 *   query empty   → "" (suppress; the user isn't filtering)
 *   1 match       → "1 чат найден"  / "1 чат табылды"
 *   2-4 matches   → "3 чата найдено" / RU paucal; KZ uses single form
 *   5+ matches    → "12 чатов найдено" / KZ single form
 *   0 matches     → "Ничего не найдено" / "Ештеңе табылған жоқ"
 *
 * Pure: no DOM, no React, no Intl*. RU pluralisation rule matches
 * the wave-15b `threadRowAriaLabel` paucal table (1 → singular,
 * 2-4 → paucal, 5-20 + teens 11-14 → genitive plural, 21 →
 * singular). KZ is uninflected.
 *
 * The component owns the (separate) `<div role="status"
 * aria-live="polite">` sibling and the throttled emit (only when
 * count or query changes; the helper itself is stateless). Same
 * pattern as wave 13b composer counter live cell + wave 19a copy
 * announcement.
 */

export type ThreadSearchLang = "ru" | "kz";

export interface ThreadSearchAnnouncementArgs {
  /** Match count after filtering. Coerced to non-negative int. */
  count: number | null | undefined;
  /** The current search query. Empty / whitespace-only → suppress
   *  the announcement entirely (user isn't actively filtering). */
  query: string | null | undefined;
  lang: ThreadSearchLang;
}

function safeInt(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  // Mirror of threadRowAriaLabel/redactionPillLabel/etc.: 1 →
  // singular, 2-4 → paucal, 5-20 + teens 11-14 → genitive
  // plural, 21 → singular again. (Russian pluralisation locked
  // in s35 to be consistent across all chat helpers.)
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

/** Pure helper — full live-region announcement string. Returns
 *  empty string when the user isn't actively filtering. */
export function threadSearchAnnouncement(
  args: ThreadSearchAnnouncementArgs,
): string {
  const langSafe: ThreadSearchLang = args.lang === "kz" ? "kz" : "ru";
  const trimmedQuery = typeof args.query === "string" ? args.query.trim() : "";
  if (trimmedQuery.length === 0) return "";
  const count = safeInt(args.count);
  if (count === 0) {
    return langSafe === "kz" ? "Ештеңе табылған жоқ" : "Ничего не найдено";
  }
  if (langSafe === "kz") {
    return `${count} чат табылды`;
  }
  // RU branch — pluralise.
  const idx = ruPluralIndex(count);
  const noun = idx === 0 ? "чат" : idx === 1 ? "чата" : "чатов";
  const verb = idx === 0 ? "найден" : "найдено";
  return `${count} ${noun} ${verb}`;
}
