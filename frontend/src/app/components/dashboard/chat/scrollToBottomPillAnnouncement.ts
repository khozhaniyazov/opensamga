/**
 * s35 wave 25c (2026-04-28) — pure helper for the
 * `ScrollToBottomPill` SR live-region announcement.
 *
 * Boss bug surfaced during recon: when new messages arrive while
 * the user has scrolled up (pill visible, unread badge ticking up),
 * SR users get NOTHING. The badge is a silent visual update; the
 * existing aria-label is only read on focus / hover. So a SR user
 * mid-conversation has no idea a reply has come in.
 *
 * Fix: render a sr-only `[role="status"][aria-live="polite"]`
 * sibling to the pill and feed it a short announcement whenever
 * unread COUNT crosses a meaningful threshold. We don't fire on
 * every delta — that would chatter — only when the count rises.
 *
 * RU paucal mirrors the s35 pluralisation table the rest of the
 * waves share. KZ uses the uninflected mirror.
 *
 * Pure: no DOM, no React, no Intl*. The component handles state.
 */

export type ScrollPillAnnounceLang = "ru" | "kz";

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

function ruNewMessageNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "новое сообщение";
  if (idx === 1) return "новых сообщения";
  return "новых сообщений";
}

/** Pure helper — short announcement for the live-region.
 *  Returns an empty string when count is 0 (so nothing speaks).
 *  Caller should compare prev vs next count and only flush when
 *  next > prev (rising edge). */
export function scrollToBottomPillAnnouncement(
  count: number | null | undefined,
  lang: ScrollPillAnnounceLang,
): string {
  const n = safeCount(count);
  if (n === 0) return "";
  const langSafe: ScrollPillAnnounceLang = lang === "kz" ? "kz" : "ru";

  if (langSafe === "kz") {
    return `${n} жаңа хабарлама төменде`;
  }
  const noun = ruNewMessageNoun(n);
  return `${n} ${noun} ниже`;
}

/** Pure helper — decides whether to flush a NEW announcement.
 *  Only flushes on RISING edges (next > prev) AND when next > 0.
 *  Caller passes the previously-flushed count, gets back a
 *  string-or-null (null = stay silent). */
export function nextScrollPillAnnouncement(args: {
  prevCount: number;
  nextCount: number;
  lang: ScrollPillAnnounceLang;
}): string | null {
  const prev = safeCount(args.prevCount);
  const next = safeCount(args.nextCount);
  if (next <= prev) return null;
  if (next === 0) return null;
  return scrollToBottomPillAnnouncement(next, args.lang);
}
