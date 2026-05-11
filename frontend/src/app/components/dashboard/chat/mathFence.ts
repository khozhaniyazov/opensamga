/**
 * s34 wave 4 (C6 golden, 2026-04-28) — math-fence balancer.
 *
 * C6 brief from the roadmap: "Math fence finalization audit —
 * confirm `\frac` / `\sqrt` render in every model path. Likely
 * closed already, needs golden." During streaming, a chunk can
 * arrive that contains an opener (`$$`, `$`, `\[`, `\(`) without
 * its matching closer — until the next delta arrives, the
 * remark-math tokenizer sees the half-fence and renders the LaTeX
 * source as raw text. This module pins the math-fence detection
 * and balancing logic so we have a deterministic, testable
 * contract that the streaming layer can opt into.
 *
 * Design notes:
 *   - We do not silently rewrite the user's prose — `balanceMathFences`
 *     is opt-in, and the only mutation it makes is to *append* the
 *     missing closer at the end of the string. The original chars
 *     are never reordered or deleted.
 *   - `$` and `$$` are tokenised together: any pair of `$$` is
 *     consumed first, and the remaining single `$` count drives the
 *     inline-math balance. This matches the way remark-math
 *     tokenises so our balance survives the actual renderer.
 *   - `\(` / `\)` and `\[` / `\]` are distinct fence pairs and are
 *     balanced independently (LaTeX never nests them with itself in
 *     practice, but interleaving with `$...$` is allowed).
 *   - LaTeX escape backslashes (`\\frac`, `\\sqrt`) are NOT fences
 *     and must not be confused with `\(`/`\[`. We only count those
 *     two specific 2-char openers/closers.
 */

/** Count of `$$` pairs and remaining single-`$` markers in `text`. */
export interface DollarFenceCounts {
  /** Number of `$$` substrings encountered (display math fence count). */
  dollarPairs: number;
  /** Number of remaining `$` chars after `$$` are consumed (inline math). */
  dollarSingles: number;
}

/** Pure helper — split the dollar-sign budget into `$$` pairs vs.
 *  single `$` markers. Walks the string left-to-right consuming
 *  `$$` greedily so a `$$$$` round-trip reports `pairs=2,
 *  singles=0` (two display fences) rather than `pairs=0, singles=4`. */
export function countDollarFences(
  text: string | null | undefined,
): DollarFenceCounts {
  if (typeof text !== "string" || text.length === 0) {
    return { dollarPairs: 0, dollarSingles: 0 };
  }
  let pairs = 0;
  let singles = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch !== 36 /* $ */) {
      i += 1;
      continue;
    }
    if (i + 1 < text.length && text.charCodeAt(i + 1) === 36) {
      pairs += 1;
      i += 2;
      continue;
    }
    singles += 1;
    i += 1;
  }
  return { dollarPairs: pairs, dollarSingles: singles };
}

/** Pure helper — count occurrences of a specific 2-char LaTeX
 *  opener / closer in the text (`\(`, `\)`, `\[`, `\]`).
 *  Implementation is a literal substring count; `text` is required
 *  but defensive on null. */
function countSubstring(text: string, marker: string): number {
  if (!text || !marker) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = text.indexOf(marker, from);
    if (idx < 0) return count;
    count += 1;
    from = idx + marker.length;
  }
}

/** Tally of opener/closer counts per fence kind. */
export interface FenceTally {
  /** Pairs of `$$` (always even when balanced — odd ⇒ one open). */
  dollarPairs: number;
  /** Single `$` markers (always even when balanced — odd ⇒ one open). */
  dollarSingles: number;
  /** `\(` count. */
  parenOpen: number;
  /** `\)` count. */
  parenClose: number;
  /** `\[` count. */
  bracketOpen: number;
  /** `\]` count. */
  bracketClose: number;
}

/** Pure helper — full per-kind fence tally for the input. */
export function tallyMathFences(text: string | null | undefined): FenceTally {
  const safe = typeof text === "string" ? text : "";
  const dollars = countDollarFences(safe);
  return {
    dollarPairs: dollars.dollarPairs,
    dollarSingles: dollars.dollarSingles,
    parenOpen: countSubstring(safe, "\\("),
    parenClose: countSubstring(safe, "\\)"),
    bracketOpen: countSubstring(safe, "\\["),
    bracketClose: countSubstring(safe, "\\]"),
  };
}

/** Pure helper — true iff the input has any open math fence that
 *  hasn't been closed yet. Safe to call on streaming chunks. */
export function hasUnclosedMathFence(text: string | null | undefined): boolean {
  const t = tallyMathFences(text);
  if (t.dollarPairs % 2 !== 0) return true;
  if (t.dollarSingles % 2 !== 0) return true;
  if (t.parenOpen !== t.parenClose) return true;
  if (t.bracketOpen !== t.bracketClose) return true;
  return false;
}

/** Pure helper — append closers to balance any open math fences,
 *  in the order: `$$`, `$`, `\)`, `\]`. Does NOT modify chars
 *  already present; only appends. Idempotent for already-balanced
 *  inputs (returns the original string). */
export function balanceMathFences(text: string | null | undefined): string {
  if (typeof text !== "string" || text.length === 0) {
    return typeof text === "string" ? text : "";
  }
  const t = tallyMathFences(text);
  let out = text;
  if (t.dollarPairs % 2 !== 0) out += "$$";
  if (t.dollarSingles % 2 !== 0) out += "$";
  if (t.parenOpen > t.parenClose) {
    out += "\\)".repeat(t.parenOpen - t.parenClose);
  }
  if (t.bracketOpen > t.bracketClose) {
    out += "\\]".repeat(t.bracketOpen - t.bracketClose);
  }
  return out;
}
