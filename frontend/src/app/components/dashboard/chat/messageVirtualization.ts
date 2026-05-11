/**
 * s35 wave 47 (2026-04-28) — CSS-driven message-bubble
 * virtualization helpers.
 *
 * Boss context: long threads (96+ messages) ship a transcript
 * that's ~47k px tall. Every bubble carries ReactMarkdown +
 * KaTeX + lucide icons + per-bubble aria computation. On a fresh
 * mount the browser pays full layout + paint for every single
 * one even though only ~3-4 are visible. Scrolling stutters,
 * memory grows, and `aria-live="polite"` updates cost more than
 * they should.
 *
 * Why we're NOT shipping react-window / react-virtuoso:
 *   - Bubbles have wildly variable heights (one-line answer vs.
 *     50-line code block vs. KaTeX block of unknown width).
 *     Windowed rendering would need per-bubble measurement, a
 *     measurer cache invalidation strategy, and special cases
 *     for streaming bubbles whose height grows token-by-token.
 *     That's a multi-thousand-line refactor.
 *   - The chat surface relies on `aria-live="polite"` on the
 *     scroll container with `aria-relevant="additions text"`.
 *     Windowed rendering removes off-screen DOM nodes, so SR
 *     users would lose the "scroll back to read context"
 *     affordance. We'd need a parallel DOM mirror just for the
 *     a11y tree.
 *   - The per-bubble auto-scroll heuristic
 *     (`userDetachedRef`/`distance < 200`) reads `scrollHeight`
 *     directly. Windowing changes `scrollHeight` to a virtual
 *     stand-in, breaking the heuristic.
 *
 * What we ARE shipping: CSS `content-visibility: auto` +
 * `contain-intrinsic-size`. The browser keeps the DOM nodes in
 * the tree (a11y tree intact, scroll height accurate) but skips
 * style + layout + paint for off-screen subtrees. Modern Chrome
 * / Safari / Firefox all support it. Re-renders during scroll
 * become near-free. Per-bubble cost goes from ~2-5ms to ~0.1ms
 * for off-screen items.
 *
 * Contract:
 *
 *   shouldOptimizeMessage(args): boolean
 *     true → apply `content-visibility: auto`. We skip the
 *     last N messages (`tailKeepCount`, default 5) so streaming
 *     and the visible scroll viewport never wake up the
 *     optimization mid-paint. We also skip very short threads
 *     (≤ tailKeepCount) where there's nothing to gain.
 *
 *   messageVirtualizationStyle(args): React.CSSProperties
 *     The inline style object to spread onto a message bubble's
 *     outer wrapper. Returns `{}` when optimization is off so
 *     callers don't pay the spread cost.
 *
 * Tunables:
 *
 *   - `intrinsicHeightPx` — placeholder height the browser
 *     reserves for off-screen bubbles. The tighter this is to
 *     reality the smoother the scrollbar. Default 240px is the
 *     median assistant-bubble height observed in s30+ traces.
 *     Browsers re-flow once the bubble enters viewport, so an
 *     incorrect estimate only costs a one-time micro-jump, not
 *     ongoing distortion.
 *   - `tailKeepCount` — last N messages stay un-optimized so
 *     the streaming bubble never gets `content-visibility:
 *     auto` mid-token (would flicker height as tokens land).
 *     Default 5 ≈ the last full-screen of viewport.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against
 * null/NaN/Infinity counts; falls back to safe no-op.
 */

export interface MessageVirtualizationArgs {
  /** Zero-based position of this message in the messages array. */
  index: number;
  /** Total messages in the thread (i.e. messages.length). */
  total: number;
  /** Number of trailing messages to leave unoptimized.
   *  Defaults to 5. */
  tailKeepCount?: number;
}

export const DEFAULT_INTRINSIC_HEIGHT_PX = 240;
export const DEFAULT_TAIL_KEEP_COUNT = 5;
/** Below this thread length we don't optimize at all — the
 *  layout cost of `content-visibility: auto` on a thread that
 *  fits on screen is a slight pessimization. */
export const MIN_THREAD_LENGTH_FOR_OPTIMIZATION = 12;

/** Coerce to a finite integer (preserving sign), or return
 *  `fallback` for non-finite / non-numeric inputs. */
function safeFiniteInt(n: unknown, fallback: number): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.floor(n);
  }
  return fallback;
}

function safeNonNegativeInt(n: unknown, fallback: number): number {
  const i = safeFiniteInt(n, fallback);
  return Math.max(0, i);
}

/** Pure predicate — should this specific message bubble carry
 *  the `content-visibility: auto` optimization? */
export function shouldOptimizeMessage(
  args: MessageVirtualizationArgs,
): boolean {
  // Index is allowed to be negative (signals "invalid" via -1
  // sentinel). Other fields must be non-negative.
  const index = safeFiniteInt(args.index, -1);
  const total = safeNonNegativeInt(args.total, 0);
  const tail = safeNonNegativeInt(args.tailKeepCount, DEFAULT_TAIL_KEEP_COUNT);

  if (index < 0) return false;
  if (total < MIN_THREAD_LENGTH_FOR_OPTIMIZATION) return false;
  if (index >= total) return false;

  // Last `tail` messages are NEVER optimized — they're the
  // streaming surface and the always-visible viewport.
  const cutoff = total - tail;
  return index < cutoff;
}

/** Pure helper — inline style for a message bubble wrapper. */
export function messageVirtualizationStyle(
  args: MessageVirtualizationArgs & { intrinsicHeightPx?: number },
): React.CSSProperties {
  if (!shouldOptimizeMessage(args)) return {};
  const h = safeNonNegativeInt(
    args.intrinsicHeightPx,
    DEFAULT_INTRINSIC_HEIGHT_PX,
  );
  return {
    contentVisibility: "auto",
    // The CSS contract is `contain-intrinsic-size: <width> <height>`.
    // We only constrain height — width follows the flex parent so
    // the bubble's max-w-* tailwind class stays authoritative. The
    // `auto` keyword tells the browser to remember the last
    // measured height once the bubble has rendered once, so a
    // user scrolling back up doesn't see a height jump.
    containIntrinsicSize: `auto ${h}px`,
  } as React.CSSProperties;
}
