/**
 * s33 (C5, 2026-04-28) — "Explain this further" inline action.
 *
 * Boss brief: long answers often have one specific paragraph the
 * student wants drilled into ("explain step 3 again", "what's a
 * Lagrangian"). Without an inline action the student has to copy
 * the paragraph, paste it back as a quoted question, and ask
 * "explain this". C5 makes that a single click per paragraph.
 *
 * Design constraints:
 *   - "1 turn = 1 follow-up" — clicking the button sends a NEW
 *     user turn (not a streaming continuation of the current one).
 *     This keeps the conversation log linear and lets the user
 *     edit/regenerate the follow-up like any other turn.
 *   - Only meaningful paragraphs deserve the button. Short
 *     paragraphs (<= 12 words) are ineligible — they're usually
 *     introductions / transitions / one-line conclusions where
 *     "explain further" is meaningless.
 *   - Headings / list items / blockquotes are ineligible. The
 *     markdown override only applies to `<p>` elements emitted by
 *     react-markdown.
 *   - The follow-up prompt is bilingual (RU / KZ). The wording is
 *     pinned via vitest so future tweaks come through tests.
 */

/** Minimum word count for a paragraph to qualify for the
 *  "Explain further" affordance. Paragraphs with fewer words read
 *  as transitions / one-liners and the action is meaningless. */
export const EXPLAIN_FURTHER_MIN_WORDS = 12;

/** Pure helper — should the button render for this paragraph? */
export function isExplainFurtherEligible(
  text: string | null | undefined,
): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Quick word count — anything separated by whitespace is a "word"
  // for this purpose. We don't try to be clever with hyphens or
  // numbers; "12 words" is just a coarse threshold, not a linguistic
  // invariant.
  const wordCount = trimmed.split(/\s+/).length;
  return wordCount >= EXPLAIN_FURTHER_MIN_WORDS;
}

/** Pure helper — build the follow-up prompt that gets sent on click.
 *  RU and KZ phrasings are pinned. We quote the paragraph (clipped
 *  to ~280 chars to avoid mega-quote prompts that bloat the turn
 *  context) and ask the assistant to elaborate. */
export function buildExplainFurtherPrompt(
  paragraphText: string,
  lang: "ru" | "kz",
): string {
  const cleaned = (paragraphText || "").trim().replace(/\s+/g, " ");
  const clipped =
    cleaned.length > 280 ? cleaned.slice(0, 277).trimEnd() + "…" : cleaned;
  if (lang === "kz") {
    return `Осы абзацты толығырақ түсіндіріп беріңіз: «${clipped}»`;
  }
  return `Объясни этот абзац подробнее: «${clipped}»`;
}

/** Localized button label. Pinned so vitest can verify both
 *  surfaces (RU + KZ) without re-running snapshot rendering. */
export function explainFurtherLabel(lang: "ru" | "kz"): string {
  return lang === "kz" ? "Толығырақ түсіндіру" : "Объяснить подробнее";
}
