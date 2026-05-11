/**
 * s33 wave 3 (C3, 2026-04-28) — collapsible long code blocks.
 *
 * Boss brief from roadmap row C3: "Collapsible long code blocks
 * (>30 lines) so a Java program dump doesn't blow out the
 * transcript". When the assistant emits a 200-line solution, today
 * the entire block renders inline and the user has to scroll past
 * a wall of monospace to find the next paragraph.
 *
 * Pattern: count newlines in the code block's text content. If
 * count >= COLLAPSE_LINE_THRESHOLD, render with a fold-down toggle:
 * collapsed shows the first N lines + a fade gradient + "Show full
 * (X lines)" affordance. Always-on copy button stays visible
 * regardless of fold state (the prior pre handler already gives
 * users copy via browser select-all + Cmd+C, but a click affordance
 * is the polish row C3 asks for).
 *
 * Pure helpers below own the line counting + threshold gating; the
 * React side is a small CodeBlock component the markdown override
 * mounts in place of the bare <pre>.
 */

/** Threshold for declaring a code block "long". 30 lines is the
 *  boss-stated value in the roadmap row. We treat >= as the trip
 *  point (so a code block sitting exactly at the threshold also
 *  collapses — better to err on the side of folding). */
export const COLLAPSE_LINE_THRESHOLD = 30;

/** When collapsed, this many lines remain visible at the top with
 *  a fade gradient under them. 12 is enough to see the function
 *  signature + first few branches before the fold. */
export const COLLAPSE_PREVIEW_LINES = 12;

/** Pure helper — count lines in a code blob. Defends against
 *  null/undefined/non-string. Treats trailing newline as part of
 *  the prior line (so "a\n" is 1 line, not 2). */
export function countCodeLines(code: string | null | undefined): number {
  if (typeof code !== "string") return 0;
  if (code.length === 0) return 0;
  // Strip a single trailing newline so "foo\nbar\n" counts as 2,
  // not 3. Multi-trailing newlines DO count (rare but real).
  const stripped = code.endsWith("\n") ? code.slice(0, -1) : code;
  if (stripped.length === 0) return 1; // a single newline → 1 line
  let count = 1;
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped.charCodeAt(i) === 10 /* \n */) count += 1;
  }
  return count;
}

/** Pure helper — should this block render the collapse affordance? */
export function shouldCollapseCode(code: string | null | undefined): boolean {
  return countCodeLines(code) >= COLLAPSE_LINE_THRESHOLD;
}

/** Pure helper — given a long code blob, return the preview slice
 *  that should be shown while collapsed. Drops the rest. Always
 *  returns the full blob if collapse isn't warranted. */
export function previewLines(
  code: string | null | undefined,
  previewCount: number = COLLAPSE_PREVIEW_LINES,
): string {
  if (typeof code !== "string") return "";
  if (!shouldCollapseCode(code)) return code;
  const stripped = code.endsWith("\n") ? code.slice(0, -1) : code;
  const lines = stripped.split("\n");
  return lines.slice(0, Math.max(0, previewCount)).join("\n");
}

/** Pure helper — RU/KZ label for the toggle. */
export function collapseToggleLabel(args: {
  expanded: boolean;
  totalLines: number;
  lang: "ru" | "kz";
}): string {
  const { expanded, totalLines, lang } = args;
  if (lang === "kz") {
    return expanded ? "Жасыру" : `Толық көрсету (${totalLines} жол)`;
  }
  return expanded ? "Свернуть" : `Показать полностью (${totalLines} строк)`;
}

/** Pure helper — RU/KZ label for the copy button (live-region
 *  feedback on click). */
export function copyButtonLabel(args: {
  copied: boolean;
  lang: "ru" | "kz";
}): string {
  const { copied, lang } = args;
  if (lang === "kz") return copied ? "Көшірілді" : "Көшіру";
  return copied ? "Скопировано" : "Копировать";
}
