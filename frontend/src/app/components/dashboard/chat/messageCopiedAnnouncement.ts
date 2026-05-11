/**
 * s35 wave 19a (2026-04-28) — pure helper for the SR-only
 * "copied to clipboard" live-region announcement on
 * `MessageActions`.
 *
 * Today the Copy button visually morphs from `<Copy>` → `<Check>`
 * for ~1.4 s and the `aria-label` text flips from "Копировать" to
 * "Скопировано". That works for SR users who happen to *re-read*
 * the button, but most don't — they fire the action and move on.
 * A polite live-region announcement closes the gap and confirms
 * the format that was actually copied (markdown vs plain text),
 * since wave-29's split control offers both.
 *
 * This helper builds the bilingual phrase. The component owns the
 * (separate) `<div role="status" aria-live="polite">` sibling and
 * the pulse-then-clear timing — same pattern as the wave-13b
 * composer counter live cell.
 *
 *   markdown / RU  → "Скопировано как Markdown"
 *   plain    / RU  → "Скопировано как текст"
 *   markdown / KZ  → "Markdown ретінде көшірілді"
 *   plain    / KZ  → "Қарапайым мәтін ретінде көшірілді"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * format / lang via explicit fallbacks.
 */

export type MessageCopiedFormat = "markdown" | "plain";

export type MessageCopiedLang = "ru" | "kz";

export interface MessageCopiedAnnouncementArgs {
  format: MessageCopiedFormat;
  lang: MessageCopiedLang;
}

/** Pure helper — full announcement string for the live region. */
export function messageCopiedAnnouncement(
  args: MessageCopiedAnnouncementArgs,
): string {
  const langSafe: MessageCopiedLang = args.lang === "kz" ? "kz" : "ru";
  const formatSafe: MessageCopiedFormat =
    args.format === "plain" ? "plain" : "markdown";
  if (langSafe === "kz") {
    return formatSafe === "plain"
      ? "Қарапайым мәтін ретінде көшірілді"
      : "Markdown ретінде көшірілді";
  }
  return formatSafe === "plain"
    ? "Скопировано как текст"
    : "Скопировано как Markdown";
}
