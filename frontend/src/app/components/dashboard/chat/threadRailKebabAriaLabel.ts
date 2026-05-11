/**
 * s35 wave 18b (2026-04-28) — pure helper for the per-thread
 * kebab button's `aria-label`.
 *
 * Today every kebab in the ThreadRail row map renders the static
 * `aria-label="Actions"` (English-only, generic, identical for
 * every row). When an SR user tabs through the list they hear
 * "Actions, button" repeated for every thread, with no anchor to
 * which thread the button operates on. With 30+ pinned threads
 * the rail becomes effectively unnavigable for AT users.
 *
 * This helper composes a contextual label:
 *   "Действия для чата «Сравнить мои баллы»" (RU)
 *   "«Сравнить мои баллы» чаты үшін әрекеттер" (KZ)
 * with title fallbacks matching the wave-15b convention
 * ("Без названия" / "Атаусыз"). Title hard-cap 60 cp keeps the
 * SR phrase short.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * whitespace title input.
 */

export type ThreadRailKebabLang = "ru" | "kz";

export interface ThreadRailKebabAriaArgs {
  /** Thread title. Null/empty/whitespace ⇒ fallback. */
  title: string | null | undefined;
  lang: ThreadRailKebabLang;
}

const TITLE_MAX_LENGTH = 60;

function truncateTitle(s: string): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "";
  const codepoints = Array.from(trimmed);
  if (codepoints.length <= TITLE_MAX_LENGTH) return trimmed;
  const head = codepoints
    .slice(0, TITLE_MAX_LENGTH - 1)
    .join("")
    .replace(/\s+$/u, "");
  return head + "…";
}

/** Pure helper — composed aria-label. */
export function threadRailKebabAriaLabel(
  args: ThreadRailKebabAriaArgs,
): string {
  const langSafe: ThreadRailKebabLang = args.lang === "kz" ? "kz" : "ru";
  const fallback = langSafe === "kz" ? "Атаусыз" : "Без названия";
  const titleRaw =
    typeof args.title === "string" && args.title.trim().length > 0
      ? truncateTitle(args.title)
      : fallback;
  if (langSafe === "kz") {
    return `«${titleRaw}» чаты үшін әрекеттер`;
  }
  return `Действия для чата «${titleRaw}»`;
}

export const THREAD_RAIL_KEBAB_TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
