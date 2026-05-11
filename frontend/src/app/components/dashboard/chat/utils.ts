/**
 * Phase B (s21, 2026-04-22): pure helpers for chat message normalization.
 *
 * Extracted from ChatPage.tsx so MessagesContext + the send hook can
 * reuse them. No React, no DOM — keep this importable from tests and
 * from the WebSocket path if we ever wire Phase C streaming.
 */

import type { AssistantMetadata } from "./types";

/**
 * Remove:
 *   - `<think>...</think>` reasoning blocks from provider-style streams.
 *   - Inline tool-call XML leaks:
 *         <provider:tool_call>...<invoke name="..."><parameter name="...">...
 *         </parameter></invoke></provider:tool_call>
 *     The backend already scrubs these in
 *     `message_formatter.strip_tool_call_leaks()` (session 21), but we
 *     strip defensively on the client so historical messages that predate
 *     the backend fix render cleanly on reload.
 *
 * Collapses 3+ newlines and trims.
 */
export function stripReasoningBlocks(text: string): string {
  let stripped = (text || "")
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(
      /<\s*[a-zA-Z][\w-]*:?tool_call\s*>[\s\S]*?<\s*\/\s*[a-zA-Z][\w-]*:?tool_call\s*>/gi,
      "",
    )
    // Session 22 (2026-04-22): some WS streams occasionally emit a
    // literal `<function_calls>...</function_calls>` or
    // `[TOOL_CALL]…[/TOOL_CALL]` block into the prose. Scrub them so
    // users don't see raw markup. Also handle orphan openers/closers
    // from truncated streams.
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
    .replace(/<\/?function_calls>/gi, "")
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, "")
    .replace(/\[\/?TOOL_CALL\]/gi, "")
    .replace(/<\s*invoke\b[^>]*>[\s\S]*?<\s*\/\s*invoke\s*>/gi, "")
    .replace(/<\s*parameter\b[^>]*>[\s\S]*?<\s*\/\s*parameter\s*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // s26 phase 5 (2026-04-27): some Qwen variants leak unwrapped English
  // chain-of-thought as the FIRST paragraph of an otherwise RU/KZ
  // answer. Observed shapes:
  //   "The user is asking about..."
  //   "Let me think about..."
  //   "I should call consult_library..."
  //   "Okay, the student wants ..."
  // Conservative strip: only when the leading paragraph
  //   (a) starts with one of a known set of CoT openers,
  //   (b) contains zero Cyrillic characters,
  //   (c) is followed by at least one paragraph that DOES contain
  //       Cyrillic. (b)+(c) prevent us from accidentally eating an
  //       English answer the user actually requested.
  stripped = stripLeadingEnglishCoT(stripped);

  return stripped;
}

/** RU+KZ Cyrillic block (incl. Kazakh-specific ӘҒҚҢӨҰҮҺІ). */
const CYRILLIC_RE = /[\u0400-\u04FF]/;

/**
 * Detect and remove an unwrapped English chain-of-thought paragraph at
 * the very top of an assistant message. Exported for tests.
 */
export function stripLeadingEnglishCoT(text: string): string {
  if (!text) return text;
  const COT_OPENERS = [
    /^the user (?:is asking|wants|needs|asks)\b/i,
    /^let me (?:think|analyze|check|look|consider)\b/i,
    /^i (?:should|need to|will|'ll|'m going to|am going to|must)\b/i,
    /^(?:okay|ok|alright|so),?\s*(?:the (?:user|student)|let me|i\b|first\b)/i,
    /^(?:first|first,?)\s*(?:i|let me|the user)/i,
    /^thinking\b[^a-z]/i,
    /^reasoning\b[^a-z]/i,
  ];

  // Split off the first paragraph (single newline) — CoT leakage is
  // almost always one paragraph at the top, sometimes two short ones.
  // We only consider the very first one to keep the heuristic tight.
  const paras = text.split(/\n{2,}/);
  if (paras.length < 2) return text;
  const head = paras[0]?.trim() ?? "";
  if (!head) return text;

  // (a) starts with a known CoT opener
  const hasOpener = COT_OPENERS.some((re) => re.test(head));
  if (!hasOpener) return text;

  // (b) the leading paragraph contains zero Cyrillic
  if (CYRILLIC_RE.test(head)) return text;

  // (c) at least one of the remaining paragraphs has Cyrillic — i.e.
  //     the real RU/KZ answer is below.
  const tailHasCyrillic = paras.slice(1).some((p) => CYRILLIC_RE.test(p));
  if (!tailHasCyrillic) return text;

  return paras.slice(1).join("\n\n").trim();
}

/**
 * s29 (C2, 2026-04-27): collapse markdown into a plain-text form
 * suitable for "Copy as plain text". The intent is "looks decent
 * pasted into Word or Telegram", NOT "round-trips through markdown".
 *
 *   - drops `<!-- samga-citation ... -->` bookkeeping (cleanForCopy
 *     already does this for the markdown path),
 *   - strips backticks / fences but keeps the code body,
 *   - strips bold/italic/strike markers,
 *   - rewrites `[text](url)` to `text (url)`,
 *   - removes leading list markers `- `, `* `, `1. ` so bullets
 *     read as paragraphs,
 *   - strips ATX heading markers (`## `) but keeps the text,
 *   - drops blockquote markers (`> `) and HTML tags,
 *   - collapses runs of blank lines.
 *
 * Pure + exported for vitest. The MessageActions copy split delegates
 * here so the predicate is testable independently of the React tree.
 */
export function markdownToPlainText(text: string): string {
  const out = (text || "")
    // Drop the citation hint comment (also done by cleanForCopy for
    // the markdown path; we duplicate here so this helper is usable
    // standalone, e.g. from MessagesContext if we ever pre-render).
    .replace(/<!--\s*samga-citation[^>]*-->/gi, "")
    // Fenced code blocks: drop the backticks but keep the body so
    // pasted code retains its line breaks.
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, body) => body)
    // Inline code: drop backticks.
    .replace(/`([^`]+)`/g, "$1")
    // Images `![alt](url)` → `alt (url)` so screen-readable text
    // survives.
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) =>
      alt ? `${alt} (${url})` : url,
    )
    // Links `[text](url)` → `text (url)`. Bare URLs left untouched.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
      label === url ? url : `${label} (${url})`,
    )
    // Bold / italic / strikethrough markers — strip but keep content.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    // Headings: drop `#`/`##`/`###` markers, keep the text.
    .replace(/^#{1,6}\s+/gm, "")
    // Blockquote markers.
    .replace(/^>\s?/gm, "")
    // List markers: `- foo`, `* foo`, `1. foo` → `foo`.
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // HR rules `---` / `***`.
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    // Stray inline HTML tags.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    // Collapse 3+ newlines to 2 so paragraphs survive but the visual
    // air doesn't balloon.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

/**
 * Ensure the backend's structured citation hint lives in the text so the
 * citation parser / deep-link chip work after a hard reload.
 *
 * The hint has the shape:
 *     `<!-- samga-citation book_id=21 page=142 -->`
 * and is emitted by `backend/app/routers/chat.py::_with_hint` when the
 * retrieval layer knows both `book_id` AND `page_number` of the top hit.
 *
 * We re-inject from persisted `message_metadata` when loading history
 * (the model's prose marker doesn't always echo the hint back).
 * Idempotent: if the hint is already in the content, returns unchanged.
 */
export function reinjectCitationHint(
  content: string,
  meta?: AssistantMetadata | null,
): string {
  if (!content) return content;
  if (!meta || meta.book_id == null || meta.page_number == null) return content;
  const pattern = new RegExp(
    `<!--\\s*samga-citation\\s+book_id=${meta.book_id}\\s+page=${meta.page_number}\\s*-->`,
  );
  if (pattern.test(content)) return content;
  return `<!-- samga-citation book_id=${meta.book_id} page=${meta.page_number} -->\n${content}`;
}
