/**
 * s35 wave 15a (2026-04-28) — pure relative-time formatter for the
 * thread rail + future surfaces.
 *
 * The rest of the chat code base parses `updated_at` ISO strings via
 * `new Date(...)` (`continueThread.parseUpdatedAt`,
 * `OutdatedDataPill`, `threadArchiveStorage`) but every existing
 * surface only checks "is this within N days?" — none of them
 * actually present the relative time. The ThreadRail today shows no
 * timestamp at all, so SR users hear the same generic
 * "chat.threads.aria.threadItem" copy on every row and have no way
 * to distinguish today's chat from one from last month without
 * tabbing into it.
 *
 * This module owns the formatting in one place so vitest can pin
 * boundary cases (just-now / minutes / hours / yesterday / N days
 * ago / N weeks / N months / N years) for both RU and KZ. The thread
 * row aria-label helper (wave 15b) consumes this and joins it with a
 * plural message-count phrase.
 *
 * Pure: no DOM, no React, no Intl* (avoids the cross-browser
 * RelativeTimeFormat support gap on older Safari without polyfills).
 * Caller passes `now` so vitest can pin without freezing time.
 */

export type RelativeTimeLang = "ru" | "kz";

export interface FormatRelativeTimeArgs {
  /** ISO-8601 string or `Date`. Strings that fail to parse return
   *  `null` so the renderer can fall back to "обновлено недавно". */
  value: string | Date | null | undefined;
  /** Reference point. Caller-provided so tests don't need to
   *  freeze time. Defaults to `new Date()` when omitted. */
  now?: Date;
  lang: RelativeTimeLang;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Internal — pick the RU plural form for an integer count.
 *  Mirrors the rule used by `redactionPillLabel` (wave 12) and
 *  `scrollToBottomPillLabel` (wave 14b). */
function ruPluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 2;
  if (mod10 === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4) return 1;
  return 2;
}

/** Pure helper — coerce `value` to a Date or return null on
 *  failure. Defensive against negative epoch and "Invalid Date". */
export function parseRelativeTimeValue(
  value: string | Date | null | undefined,
): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

/** Pure helper — turn (count, unit, lang) into the localised noun
 *  phrase. Exposed for direct vitest probing. */
export function relativeTimeUnit(
  count: number,
  unit: "minute" | "hour" | "day" | "week" | "month" | "year",
  lang: RelativeTimeLang,
): string {
  const n = Math.max(1, Math.floor(count));
  if (lang === "kz") {
    if (unit === "minute") return `${n} минут`;
    if (unit === "hour") return `${n} сағат`;
    if (unit === "day") return `${n} күн`;
    if (unit === "week") return `${n} апта`;
    if (unit === "month") return `${n} ай`;
    return `${n} жыл`;
  }
  const idx = ruPluralIndex(n);
  if (unit === "minute") {
    if (idx === 0) return `${n} минуту`;
    if (idx === 1) return `${n} минуты`;
    return `${n} минут`;
  }
  if (unit === "hour") {
    if (idx === 0) return `${n} час`;
    if (idx === 1) return `${n} часа`;
    return `${n} часов`;
  }
  if (unit === "day") {
    if (idx === 0) return `${n} день`;
    if (idx === 1) return `${n} дня`;
    return `${n} дней`;
  }
  if (unit === "week") {
    if (idx === 0) return `${n} неделю`;
    if (idx === 1) return `${n} недели`;
    return `${n} недель`;
  }
  if (unit === "month") {
    if (idx === 0) return `${n} месяц`;
    if (idx === 1) return `${n} месяца`;
    return `${n} месяцев`;
  }
  if (idx === 0) return `${n} год`;
  if (idx === 1) return `${n} года`;
  return `${n} лет`;
}

/** Pure helper — format a relative time as a short past-tense
 *  phrase. Returns `null` on parse failure so the renderer can
 *  decide on a fallback (e.g. omit the timestamp from the
 *  aria-label entirely instead of speaking "Invalid Date").
 *
 *  Future timestamps (now < value, e.g. clock skew) collapse to
 *  the "just now" bucket — better than rendering "in 3 minutes",
 *  which would only ever be a server clock-drift artefact in this
 *  product. */
export function formatRelativeTime(
  args: FormatRelativeTimeArgs,
): string | null {
  const d = parseRelativeTimeValue(args.value);
  if (!d) return null;
  const now = args.now instanceof Date ? args.now : new Date();
  if (!Number.isFinite(now.getTime())) return null;
  const diff = Math.max(0, now.getTime() - d.getTime());
  if (diff < MINUTE) {
    return args.lang === "kz" ? "жаңа ғана" : "только что";
  }
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE);
    const phrase = relativeTimeUnit(n, "minute", args.lang);
    return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    const phrase = relativeTimeUnit(n, "hour", args.lang);
    return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
  }
  if (diff < 2 * DAY) {
    return args.lang === "kz" ? "кеше" : "вчера";
  }
  if (diff < WEEK) {
    const n = Math.floor(diff / DAY);
    const phrase = relativeTimeUnit(n, "day", args.lang);
    return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
  }
  if (diff < MONTH) {
    const n = Math.floor(diff / WEEK);
    const phrase = relativeTimeUnit(n, "week", args.lang);
    return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
  }
  if (diff < YEAR) {
    const n = Math.floor(diff / MONTH);
    const phrase = relativeTimeUnit(n, "month", args.lang);
    return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
  }
  const n = Math.floor(diff / YEAR);
  const phrase = relativeTimeUnit(n, "year", args.lang);
  return args.lang === "kz" ? `${phrase} бұрын` : `${phrase} назад`;
}
