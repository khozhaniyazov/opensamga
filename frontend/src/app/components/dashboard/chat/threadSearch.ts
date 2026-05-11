/**
 * s31 wave 2 (E1, 2026-04-27) — pure helpers for the ThreadRail
 * search box.
 *
 * Client-side substring filter on thread titles. Lives in its own
 * module so vitest can pin the contract without rendering the rail
 * (matches the s29/s30 pure-helper testing convention).
 *
 * Behaviour:
 *   - Empty / whitespace-only query ⇒ return the input list
 *     unchanged (preserve sort order).
 *   - Non-empty query ⇒ case-insensitive AND diacritic-insensitive
 *     substring match on the title. The legacy "untitled" bucket
 *     (`thread.title === null`) is skipped iff the query is
 *     non-empty (a user searching for something specific isn't
 *     looking for the orphan bucket).
 *   - The fallback "Без названия" / "Атаусыз" labels rendered for
 *     null titles are NOT searched — keeps the filter predictable
 *     across languages.
 *   - Diacritic-insensitive: "электр" matches "Электростатика" and
 *     "ёлка" matches "елка" via NFD normalization. Cyrillic users
 *     don't have to remember to type ё vs е.
 */

import type { ChatThread } from "./MessagesContext";

/** Strip combining marks so "Ё" → "Е" / "ё" → "е" / "š" → "s" etc.
 *  We Unicode-normalize to NFD and drop the U+0300..U+036F range. */
function deburr(s: string): string {
  if (typeof s !== "string") return "";
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // Older runtimes that lack `String.prototype.normalize` — fall
    // back to the raw string. The filter still works, just without
    // diacritic folding.
    return s;
  }
}

/** Canonical query normaliser. Trims, lowercases, deburrs. Empty
 *  string for null/undefined input. */
export function normalizeThreadSearchQuery(q: unknown): string {
  if (typeof q !== "string") return "";
  const trimmed = q.trim();
  if (!trimmed) return "";
  return deburr(trimmed.toLowerCase());
}

/** Filter rule: empty query ⇒ pass-through (mutation-safe copy);
 *  non-empty ⇒ keep threads whose normalised title contains the
 *  normalised query. Threads with null titles are excluded on a
 *  non-empty query. */
export function filterThreadsBySearch(
  threads: readonly ChatThread[],
  query: string,
): ChatThread[] {
  if (!Array.isArray(threads)) return [];
  const q = normalizeThreadSearchQuery(query);
  if (!q) return threads.slice();
  return threads.filter((thread) => {
    if (!thread || typeof thread !== "object") return false;
    const title = thread.title;
    if (typeof title !== "string" || title.trim().length === 0) return false;
    return deburr(title.toLowerCase()).includes(q);
  });
}
