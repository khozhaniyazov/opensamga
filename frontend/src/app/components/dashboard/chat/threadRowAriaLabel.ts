/**
 * s35 wave 15b (2026-04-28) — pure aria-label builder for the
 * thread rail row.
 *
 * The thread rail's row currently sets a constant
 * `t("chat.threads.aria.threadItem")` (= "Открыть чат") on every
 * row. SR users can't tell rows apart without tab-into-and-listen,
 * which means a long thread list is effectively a wall of identical
 * "Open chat" buttons. This helper returns a per-row label like:
 *
 *   "Объясни ошибку (12 сообщений · 3 дня назад · закреплено)"
 *
 * with localised plural agreement for the message count, the
 * relative-time phrase from `formatRelativeTime` (wave 15a), and an
 * optional "pinned" / "archived" suffix.
 *
 * Pure: no DOM, no React. Caller passes `now` so vitest can pin
 * without freezing time.
 */

import {
  formatRelativeTime,
  type RelativeTimeLang,
} from "./formatRelativeTime";

export type ThreadRowAriaLang = RelativeTimeLang;

export interface ThreadRowAriaArgs {
  /** Resolved thread title or the i18n fallback ("Без названия" /
   *  "Основной чат"). Caller must pre-resolve so the helper stays
   *  pure. */
  title: string | null | undefined;
  /** Backend `message_count` field. Negative / NaN is coerced to
   *  zero. */
  messageCount: number | null | undefined;
  /** Backend `updated_at` ISO-8601 string or null. */
  updatedAt: string | null | undefined;
  /** True if this thread is pinned via the user-visible affordance.
   *  Adds " · закреплено" / " · бекітілген" to the label. */
  pinned?: boolean;
  /** True if this thread is in the archived bucket (manual or
   *  auto). Adds " · в архиве" / " · мұрағатта". Mutually exclusive
   *  with `pinned` in practice; if both flagged, both are rendered. */
  archived?: boolean;
  /** Reference time. Defaults to `new Date()`. */
  now?: Date;
  lang: ThreadRowAriaLang;
}

/** Internal — RU plural form picker shared with
 *  `formatRelativeTime` and `scrollToBottomPillLabel`. */
function ruPluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 2;
  if (mod10 === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4) return 1;
  return 2;
}

/** Pure helper — return the localised "N message(s)" phrase.
 *  Exposed for direct vitest probing. */
export function threadRowMessageCountPhrase(
  count: number,
  lang: ThreadRowAriaLang,
): string {
  const safe = Number.isFinite(count) ? count : 0;
  const n = Math.max(0, Math.floor(safe));
  if (lang === "kz") return `${n} хабарлама`;
  const idx = ruPluralIndex(n);
  if (idx === 0) return `${n} сообщение`;
  if (idx === 1) return `${n} сообщения`;
  return `${n} сообщений`;
}

/** Pure helper — full aria-label for the row. Always non-empty:
 *  falls back to the title alone when message count is zero AND
 *  updated_at can't be parsed, since "Object.is(label, '')" would
 *  break SR navigation. */
export function threadRowAriaLabel(args: ThreadRowAriaArgs): string {
  const title =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.trim()
      : args.lang === "kz"
        ? "Атаусыз"
        : "Без названия";
  const parts: string[] = [];
  const count =
    typeof args.messageCount === "number" && Number.isFinite(args.messageCount)
      ? Math.max(0, Math.floor(args.messageCount))
      : 0;
  if (count > 0) {
    parts.push(threadRowMessageCountPhrase(count, args.lang));
  }
  const rel = formatRelativeTime({
    value: args.updatedAt ?? null,
    now: args.now,
    lang: args.lang,
  });
  if (rel) parts.push(rel);
  if (args.pinned) {
    parts.push(args.lang === "kz" ? "бекітілген" : "закреплено");
  }
  if (args.archived) {
    parts.push(args.lang === "kz" ? "мұрағатта" : "в архиве");
  }
  if (parts.length === 0) return title;
  return `${title} (${parts.join(" · ")})`;
}
