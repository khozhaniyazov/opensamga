/**
 * s35 wave 38 (2026-04-28) — pure helper for the structured
 * error-bubble Retry button.
 *
 * Pre-wave the button used a bare verb aria-label ("Повторить" /
 * "Қайталау") and the surrounding `<div role="alert">` carried
 * the failed-stream text but no consequence cue — SR users
 * landing on Retry by tab-traversal heard only "повторить,
 * кнопка" with no indication that:
 *   1. The click re-sends the prior user-turn prompt.
 *   2. Doing so removes the visible error bubble (the failure
 *      record disappears from the transcript on success).
 *
 * The new helper emits a consequence-aware label "Повторить
 * запрос — отправить «Hello world…» заново" and degrades
 * gracefully when the prompt is empty/whitespace ("Повторить
 * запрос"). Prompts longer than 80 graphemes are truncated with
 * an ellipsis so the AT announcement doesn't run a full
 * 8000-char composer payload.
 *
 * Pure: no DOM, no React, no Intl.
 */

export type ErrorRetryLang = "ru" | "kz";

interface Args {
  /** The user-turn text that will be re-submitted. May be null /
   *  undefined when retry metadata wasn't preserved upstream. */
  retryPrompt: unknown;
  lang: unknown;
}

const PROMPT_PREVIEW_MAX = 80;

function safeLang(lang: unknown): ErrorRetryLang {
  return lang === "kz" ? "kz" : "ru";
}

function safeText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Trim trailing whitespace inside the cut so we don't get
  // "word…" with a stray space before the ellipsis.
  return `${s.slice(0, max).trimEnd()}…`;
}

const COPY = {
  ru: {
    bareVerb: "Повторить запрос",
    withPrompt: (preview: string) =>
      `Повторить запрос — отправить «${preview}» заново`,
  },
  kz: {
    bareVerb: "Сұранысты қайталау",
    withPrompt: (preview: string) =>
      `Сұранысты қайталау — «${preview}» қайта жіберу`,
  },
} as const;

/** Pure helper — aria-label for the Retry affordance on a failed
 *  assistant bubble. */
export function errorRetryAriaLabel({ retryPrompt, lang }: Args): string {
  const c = COPY[safeLang(lang)];
  const text = safeText(retryPrompt);
  if (text.length === 0) return c.bareVerb;
  const preview = truncate(text, PROMPT_PREVIEW_MAX);
  return c.withPrompt(preview);
}

/** Pure helper — visible button label. Stays bare verb so the
 *  error bubble's chrome stays compact; SR users hear the
 *  consequence-aware version via aria-label. */
export function errorRetryButtonLabel(lang: unknown): string {
  return COPY[safeLang(lang)].bareVerb;
}
