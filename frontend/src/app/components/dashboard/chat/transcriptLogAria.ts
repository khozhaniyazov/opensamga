/**
 * s35 wave 26b (2026-04-28) — pure helper for the chat
 * transcript's `role="log"` aria-label.
 *
 * Boss bug surfaced during the wave-25 hunt: ChatTranscript's
 * scroll container is `role="log" aria-live="polite"` but has no
 * `aria-label`. SR users land on it and hear "log" with no name —
 * they don't know they're in the chat transcript.
 *
 * Fix: bind a stable, count-aware aria-label that names the region
 * AND tells the user how many turns are in the transcript. The
 * empty-state copy is a separate sentence so SR users know there
 * are no messages yet, instead of guessing from silence.
 *
 * Output (RU):
 *   empty:        "Беседа: пока нет сообщений"
 *   1 message:    "Беседа: 1 сообщение"
 *   2 messages:   "Беседа: 2 сообщения"
 *   5+ messages:  "Беседа: 5 сообщений"
 *
 * Output (KZ):
 *   empty:        "Сұхбат: әзірге хабарлама жоқ"
 *   N messages:   "Сұхбат: N хабарлама"
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * lang and null/NaN/Infinity/negative/float counts.
 */

export type TranscriptLogLang = "ru" | "kz";

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

function ruMessageNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "сообщение";
  if (idx === 1) return "сообщения";
  return "сообщений";
}

/** Pure helper — full aria-label for the transcript log region. */
export function transcriptLogAria(args: {
  messageCount: number | null | undefined;
  lang: TranscriptLogLang;
}): string {
  const langSafe: TranscriptLogLang = args.lang === "kz" ? "kz" : "ru";
  const n = safeCount(args.messageCount);

  if (langSafe === "kz") {
    if (n === 0) return "Сұхбат: әзірге хабарлама жоқ";
    return `Сұхбат: ${n} хабарлама`;
  }

  if (n === 0) return "Беседа: пока нет сообщений";
  return `Беседа: ${n} ${ruMessageNoun(n)}`;
}
