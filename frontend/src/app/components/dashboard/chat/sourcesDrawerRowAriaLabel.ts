/**
 * s35 wave 16a (2026-04-28) — pure aria-label builder for the
 * SourcesDrawer row anchors.
 *
 * Today the consulted-source rows render
 *   "<book title>"
 *   "стр. 47 — <snippet>"
 * but the anchor itself has no `aria-label`, so SR users hear the
 * raw concatenated text including the icon name from the
 * `<ExternalLink>` glyph (when the AT decides to surface it). The
 * snippet is also italics-rendered inline, which some screen readers
 * speak as a "tag-soup" run.
 *
 * This helper composes a clean per-row label:
 *   "Algebra 9 (Tierney), стр. 47 — Открыть в библиотеке"
 *   "Algebra 9 (Tierney), бет 47 — Кітапханада ашу"
 * with optional snippet preview folded into a parenthetical
 * suffix when present, and with a localised "open in library"
 * affordance trailer so SR users know the row is actionable
 * (today they only learn that by tabbing onto it and listening
 * to the AT verbalise "link").
 *
 * Pure: no DOM, no React. The `slashCommandPreview` helper from
 * wave 14a is intentionally NOT reused here — that one is built
 * for prompt-body truncation (180 cp default) and folds whitespace
 * into a single space, which is the wrong shape for snippet
 * previews where punctuation runs and code spans matter.
 */

export type SourcesDrawerRowLang = "ru" | "kz";

export interface SourcesDrawerRowAriaArgs {
  /** Resolved book title. Falls back to "Источник №N" / "Дереккөз
   *  №N" when null/empty/whitespace, with N being a 1-based row
   *  index. The legacy persisted snapshots from before s29 only
   *  carry book_id + page_number — this is the path that handles
   *  them. */
  title: string | null | undefined;
  /** 0-based row index, used only for the fallback title. */
  index: number;
  /** Page number from `consulted_sources[k].page_number`. Coerced to
   *  positive integer; non-finite / <=0 inputs render an aria
   *  without the page clause (still actionable). */
  pageNumber: number | null | undefined;
  /** Optional retrieval snippet from
   *  `consulted_sources[k].snippet`. Hard-cap at 80 codepoints to
   *  keep the SR phrase short. */
  snippet?: string | null;
  lang: SourcesDrawerRowLang;
}

const SNIPPET_MAX_LENGTH = 80;

/** Internal — codepoint-truncate a snippet for the aria. Mirrors the
 *  shape of `slashCommandPreviewText` (single ellipsis,
 *  surrogate-safe) but with a different cap and without the
 *  whitespace-collapse pass — snippets often carry meaningful
 *  whitespace (code blocks, math). */
function truncateSnippetForAria(snippet: string): string {
  const trimmed = snippet.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "";
  const codepoints = Array.from(trimmed);
  if (codepoints.length <= SNIPPET_MAX_LENGTH) return trimmed;
  const head = codepoints
    .slice(0, SNIPPET_MAX_LENGTH - 1)
    .join("")
    .replace(/\s+$/u, "");
  return head + "…";
}

/** Pure helper — fallback row title when the backend didn't send a
 *  book_name. Mirrors the existing `sourceRowTitle` shape but
 *  exported separately so we can pin both paths from vitest. */
export function sourcesDrawerFallbackTitle(
  index: number,
  lang: SourcesDrawerRowLang,
): string {
  const n = (Number.isFinite(index) ? Math.floor(index) : 0) + 1;
  const safe = Math.max(1, n);
  return lang === "kz" ? `Дереккөз №${safe}` : `Источник №${safe}`;
}

/** Pure helper — full aria-label for the row anchor. */
export function sourcesDrawerRowAriaLabel(
  args: SourcesDrawerRowAriaArgs,
): string {
  const langSafe: SourcesDrawerRowLang = args.lang === "kz" ? "kz" : "ru";
  const titleRaw =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.trim()
      : sourcesDrawerFallbackTitle(args.index, langSafe);
  const parts: string[] = [titleRaw];
  if (
    typeof args.pageNumber === "number" &&
    Number.isFinite(args.pageNumber) &&
    args.pageNumber >= 1
  ) {
    const pageWord = langSafe === "kz" ? "бет" : "стр.";
    parts.push(`${pageWord} ${Math.floor(args.pageNumber)}`);
  }
  const snippetSafe =
    typeof args.snippet === "string"
      ? truncateSnippetForAria(args.snippet)
      : "";
  if (snippetSafe.length > 0) {
    parts.push(`«${snippetSafe}»`);
  }
  // Trailing actionable affordance — tells the SR user this is a
  // link without depending on the AT to verbalise the role.
  const action = langSafe === "kz" ? "Кітапханада ашу" : "Открыть в библиотеке";
  return `${parts.join(", ")} — ${action}`;
}
