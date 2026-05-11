/**
 * s33 (F6, 2026-04-28) — "Cite a specific page" composer hint.
 *
 * Boss brief from roadmap row F6: "Cite a specific page picker that
 * injects a structured `consult_library` hint". The student
 * sometimes already KNOWS the textbook + page they want grounded —
 * "explain page 47 of Algebra-9 Tierney". Today they have to type
 * out the request as natural language and hope the agent picks the
 * right book. F6 lets them inject a structured hint via a slash
 * command (`/cite`) that the agent loop reads as an authoritative
 * pointer to a specific (book_id, page_number) pair.
 *
 * Implementation: ZERO new BE wiring. The hint is just a special
 * markdown line at the top of the user message that the agent
 * loop's existing prompt parser can pattern-match and treat as a
 * `consult_library` seed. We use a triple-backtick fenced block
 * with language=samga.cite so it's:
 *   - visible in the transcript (transparency)
 *   - filterable in BE prompt logic via a regex
 *   - distinguishable from prose text the user typed
 *
 * Pure helpers below own the parsing + formatting; the React side
 * is a popover invoked from the slash menu (F6 already shipped
 * the menu in s31 / F1).
 */

import type { BookRef } from "./citations";

/** Hint envelope written into the user message. The agent loop's
 *  prompt parser can match `^\`\`\`samga.cite\n` on each user turn
 *  to pull the structured pointer out. */
export const CITE_HINT_FENCE = "samga.cite";

export interface CitePageHint {
  /** Library book id (numeric, must be > 0). */
  bookId: number;
  /** Page number (1-based, must be > 0). */
  pageNumber: number;
  /** Optional book name — purely informational, the agent uses
   *  bookId for routing. */
  bookName?: string;
}

/** Pure helper — format a hint as a fenced code block ready to
 *  prepend to the user's message. */
export function formatCiteHint(hint: CitePageHint): string {
  const safe = normalizeCitePageHint(hint);
  if (!safe) return "";
  const payload = JSON.stringify({
    book_id: safe.bookId,
    page_number: safe.pageNumber,
    ...(safe.bookName ? { book_name: safe.bookName } : {}),
  });
  return "```" + CITE_HINT_FENCE + "\n" + payload + "\n```";
}

/** Pure helper — strip / coerce a hint into a valid shape, or
 *  return null if the inputs aren't usable. */
export function normalizeCitePageHint(
  hint: Partial<CitePageHint> | null | undefined,
): CitePageHint | null {
  if (!hint || typeof hint !== "object") return null;
  const bookId =
    typeof hint.bookId === "number" &&
    Number.isInteger(hint.bookId) &&
    hint.bookId > 0
      ? hint.bookId
      : null;
  const pageNumber =
    typeof hint.pageNumber === "number" &&
    Number.isInteger(hint.pageNumber) &&
    hint.pageNumber > 0
      ? hint.pageNumber
      : null;
  if (bookId == null || pageNumber == null) return null;
  const bookName =
    typeof hint.bookName === "string" && hint.bookName.trim().length > 0
      ? hint.bookName.trim()
      : undefined;
  return { bookId, pageNumber, bookName };
}

/** Pure helper — detect whether a user message already contains a
 *  cite-page hint. Used by the BE prompt parser AND by the
 *  composer to avoid double-injection. */
export function hasCiteHint(message: string | null | undefined): boolean {
  if (typeof message !== "string") return false;
  return message.includes("```" + CITE_HINT_FENCE + "\n");
}

/** Pure helper — given a freshly composed message + the chosen
 *  hint, return the text that should be sent. If a hint is already
 *  present, return the message unchanged (idempotent). */
export function injectCiteHint(message: string, hint: CitePageHint): string {
  if (hasCiteHint(message)) return message;
  const fenced = formatCiteHint(hint);
  if (!fenced) return message;
  // Place the hint as the first lines so the BE prompt parser
  // doesn't have to walk the whole message to find it.
  if (!message || !message.trim()) {
    return fenced;
  }
  return fenced + "\n\n" + message;
}

/** Pure helper — match against the catalog. Mirrors the resolver
 *  used by `CitationChip` so we can validate the picker's input
 *  resolves to a real book before injecting. */
export function findBookByName(
  books: readonly BookRef[],
  name: string,
): BookRef | null {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed) return null;
  for (const b of books) {
    const candidate = (b.title || "").trim().toLowerCase();
    if (candidate === trimmed) return b;
  }
  // Loose substring match — common case where user types
  // "Algebra-9" but the canonical title is "Algebra 9 (Tierney)".
  for (const b of books) {
    const candidate = (b.title || "").trim().toLowerCase();
    if (candidate.includes(trimmed)) return b;
  }
  return null;
}
