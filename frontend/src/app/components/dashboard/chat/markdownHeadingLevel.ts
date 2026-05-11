/**
 * s35 wave 26c (2026-04-28) — pure helper for chat-message
 * markdown heading level mapping.
 *
 * Boss bug: ChatPage already has a top-level `<h1>"Samga Chat"`,
 * but assistant turns rendered via ReactMarkdown can produce
 * their own `<h1>` from the literal `#` markdown syntax. Result:
 * the document outline ends up with multiple H1s, and SR users
 * can't navigate the page by heading-level because every assistant
 * turn re-resets the level. Same papercut on the other end: `####`,
 * `#####`, `######` markdown headings have no override and ship
 * un-styled into the bubble.
 *
 * Fix: demote every markdown heading level by one and clamp to a
 * max of 6 — so `# Title` → `<h2>`, `## Sub` → `<h3>`, …, `###### x`
 * → `<h6>`. The page's `<h1>` stays the only top-level H1, and
 * SR users get a coherent outline.
 *
 * This helper just returns the demoted numeric level — the
 * AssistantMessage markdown component table maps that into
 * `<h2…h6>` JSX with the existing visual classes.
 *
 * Pure: no DOM, no React. Defensive against unknown / fractional
 * inputs.
 */

export type MdHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type DomHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** Pure helper — given a markdown heading level (1-6), return
 *  the level we should actually render in the DOM. Caller is
 *  responsible for picking the right JSX tag based on the
 *  returned level. */
export function chatMarkdownHeadingLevel(
  mdLevel: number | null | undefined,
): DomHeadingLevel {
  if (typeof mdLevel !== "number" || !Number.isFinite(mdLevel)) {
    // Defensive: unknown input → render as deepest body heading.
    return 6;
  }
  const floored = Math.floor(mdLevel);
  // Clamp the input to [1, 6], then demote by 1, then re-clamp to
  // [2, 6] (the legal DOM range after demotion).
  const clamped = Math.min(6, Math.max(1, floored));
  const demoted = clamped + 1;
  return (demoted > 6 ? 6 : demoted) as DomHeadingLevel;
}

/** Pure helper — string version of `chatMarkdownHeadingLevel`,
 *  returns the actual tag name `h2`…`h6`. Convenient for
 *  React.createElement callers. */
export function chatMarkdownHeadingTag(
  mdLevel: number | null | undefined,
): "h2" | "h3" | "h4" | "h5" | "h6" {
  const level = chatMarkdownHeadingLevel(mdLevel);
  return ("h" + level) as "h2" | "h3" | "h4" | "h5" | "h6";
}
