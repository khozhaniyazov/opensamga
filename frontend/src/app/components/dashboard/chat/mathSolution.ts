/**
 * s32 (C4, 2026-04-27) — auto-detect when an assistant message is a
 * math-solution (a numbered series of solving steps) so we can
 * decorate each list item with a "Шаг N:" / "Қадам N:" label.
 *
 * Boss brief: math-heavy answers (UNT prep, all year long) read as
 * a wall of "1. 2. 3." with cramped LaTeX between them. Students
 * scanning for "where did the substitution happen" can't anchor on
 * a step number alone — they want a labeled step.
 *
 * Detection heuristic (intentionally conservative — no false-
 * positives on prose lists):
 *   1. Raw markdown contains an ordered list (>= 2 items shaped
 *      `^\d+\. `).
 *   2. The full message contains at least one math signal —
 *      $...$, $$...$$, \(...\), \[...\], \frac, \sqrt, \int, \sum,
 *      `=` next to digits/letters, or a power/subscript.
 * If both hold, `looksLikeMathSolution` returns true; otherwise
 * we fall back to plain numbered list rendering.
 *
 * Tradeoff: a list that just *describes* an algebraic concept
 * ("there are 3 important formulas") with ad-hoc inline math
 * markers will get step-labeled. We prefer the false-positive
 * tradeoff (labelled = harmless visual addition) over false-
 * negative (an actual math solution missing the labels).
 */

/** Pure detection helper. Returns true iff `rawText` looks like a
 *  numbered math solution. */
export function looksLikeMathSolution(
  rawText: string | null | undefined,
): boolean {
  if (!rawText || typeof rawText !== "string") return false;
  if (rawText.length === 0) return false;
  if (countOrderedListItems(rawText) < 2) return false;
  if (!hasMathSignal(rawText)) return false;
  return true;
}

/** Count `^\d+\. ` lines as a proxy for ordered-list items in raw
 *  markdown. We don't try to detect contiguity — even a 2-step list
 *  separated by prose is enough signal. */
export function countOrderedListItems(rawText: string): number {
  if (!rawText) return 0;
  let count = 0;
  for (const line of rawText.split(/\r?\n/)) {
    if (/^\s{0,3}\d{1,3}\.\s/.test(line)) count += 1;
  }
  return count;
}

const MATH_SIGNAL_RE =
  /\$[^$\n]+\$|\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\frac|\\sqrt|\\sum|\\int|\\lim|[A-Za-z0-9]\^\d|[a-zA-Z]_\d|=\s*-?\d|\\cdot/;

/** True iff the text shows at least one math-coded segment. */
export function hasMathSignal(rawText: string): boolean {
  if (!rawText) return false;
  return MATH_SIGNAL_RE.test(rawText);
}

/** Localized step prefix. Pinned to RU/KZ — the assistant doesn't
 *  emit English answers in production. */
export function stepPrefix(lang: "ru" | "kz"): string {
  return lang === "kz" ? "Қадам" : "Шаг";
}

/** Compose the full label, e.g. "Шаг 1:". */
export function stepLabel(idx: number, lang: "ru" | "kz"): string {
  // Defensive: a non-positive / non-finite idx falls back to an
  // empty string so the consumer can decide what to render.
  if (!Number.isFinite(idx) || idx < 1) return "";
  return `${stepPrefix(lang)} ${Math.floor(idx)}:`;
}
