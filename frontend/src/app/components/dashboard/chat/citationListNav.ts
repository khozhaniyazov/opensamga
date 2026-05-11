/**
 * s33 (H3, 2026-04-28) — keyboard navigation helpers for the
 * SourcesDrawer citation list (the canonical "list of citations"
 * surface in the chat UI).
 *
 * Boss brief: the SourcesDrawer is where students audit the receipts
 * for an answer — the chip-per-source layout means a keyboard user
 * has to Tab through every row to reach the last one. With 8-12
 * citations per turn (common for compare-textbooks queries), that's
 * a lot of Tabs.
 *
 * Standard a11y pattern: roving tabindex. The list owns ONE tab stop
 * (Tab from outside lands on the active row); ArrowUp / ArrowDown
 * step within the list; Home / End jump to first / last; Enter or
 * Space activates the row's anchor. Tab from the list moves to the
 * next focusable on the page (the next row is NOT a tab stop —
 * that's the whole point).
 *
 * Pure helpers below own the math; the React side wires them in
 * SourcesDrawer.tsx.
 */

/** Compute the next focused index given a key and the current index.
 *  Returns the index that should receive focus next, or `current` if
 *  the key isn't relevant. */
export function nextCitationIndex(
  key: string,
  current: number,
  length: number,
): number {
  if (length <= 0) return -1;
  // Defensive: if `current` is out of range (caller hydrated with a
  // stale value), normalise to 0 so behavior is sane regardless.
  const safeCurrent = current < 0 || current >= length ? 0 : current;
  switch (key) {
    case "ArrowDown":
      return safeCurrent + 1 >= length ? 0 : safeCurrent + 1;
    case "ArrowUp":
      return safeCurrent - 1 < 0 ? length - 1 : safeCurrent - 1;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return safeCurrent;
  }
}

/** True iff the key would change focus within the citation list. */
export function isCitationNavKey(key: string): boolean {
  return (
    key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End"
  );
}

/** True iff the key should activate the current row (Enter or Space). */
export function isCitationActivateKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/** Compute the tabindex for the row at `idx` given the active index.
 *  The active row is `0` (in the natural Tab order); all others are
 *  `-1` (programmatic-only focus targets). */
export function rowTabIndex(idx: number, activeIdx: number): 0 | -1 {
  return idx === activeIdx ? 0 : -1;
}
