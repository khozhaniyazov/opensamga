/**
 * s35 wave 27a (2026-04-28) — pure helper for the
 * ChatSummaryCard's thread-open button aria-label.
 *
 * Recon (post-wave-26): MemoryCards' ChatSummaryCard renders each
 * recent thread as a `<button>` whose only accessible name is the
 * inner truncated `<span>` containing the title. Two papercuts:
 *   (1) The action is *not* mentioned — SR users hear "Без
 *       названия, 2026-04-25, …" with no verb. They don't know
 *       clicking switches the active thread.
 *   (2) The visible date column (`updated_at.slice(0,10)`) is
 *       just an ISO date — SR users hear "two thousand twenty
 *       six dash zero four dash twenty five" instead of a real
 *       sentence.
 *
 * Fix: bind a consequence-aware aria-label that names the action
 * (open this thread) and surfaces the title + last-updated date
 * in a sentence form. KZ uninflected mirror.
 *
 * Empty / null / whitespace title falls back to "Без названия" /
 * "Атаусыз". Invalid dates are silently dropped (the verb +
 * title sentence still works).
 */

export type ChatSummaryThreadLang = "ru" | "kz";

function safeTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  return title.trim();
}

/** Strip an ISO date down to YYYY-MM-DD if it looks like one;
 *  returns "" for anything else. We DO NOT pretty-format because
 *  this helper stays Intl-free; the date is read aloud as digits
 *  but at least surrounded by a real sentence. */
function safeIsoDate(updatedAt: unknown): string {
  if (typeof updatedAt !== "string") return "";
  const trimmed = updatedAt.trim();
  if (trimmed.length === 0) return "";
  // Accept ISO-ish prefixes; require y-m-d shape.
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Pure helper — full consequence-aware aria-label for a single
 *  ChatSummary thread row. */
export function chatSummaryThreadAriaLabel(args: {
  title: string | null | undefined;
  updatedAt: string | null | undefined;
  lang: ChatSummaryThreadLang;
}): string {
  const langSafe: ChatSummaryThreadLang = args.lang === "kz" ? "kz" : "ru";
  const title = safeTitle(args.title);
  const date = safeIsoDate(args.updatedAt);

  const fallbackTitle = langSafe === "kz" ? "Атаусыз" : "Без названия";
  const titleOut = title.length > 0 ? title : fallbackTitle;

  if (langSafe === "kz") {
    if (date) {
      return `Сұхбатты ашу: ${titleOut}, соңғы жаңарту ${date}`;
    }
    return `Сұхбатты ашу: ${titleOut}`;
  }

  if (date) {
    return `Открыть диалог: ${titleOut}, последнее обновление ${date}`;
  }
  return `Открыть диалог: ${titleOut}`;
}
