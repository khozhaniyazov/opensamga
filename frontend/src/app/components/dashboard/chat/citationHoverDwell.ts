/**
 * s35 wave 61 (2026-04-28) — pure dwell helper for citation chips.
 *
 * Mirrors the templateDwell helper from w54 but for a different
 * timing semantic: this measures hover-START → click, not
 * mount → click.
 *
 * The funnel question we're answering: when a user clicks a
 * citation, did they skim it (<200 ms) or did they actually read
 * the popover thumbnail before clicking? The split is interesting
 * for trust signals — a user clicking after a 2 s dwell is far
 * more likely to actually open and read the source than one who
 * fires through it in 80 ms.
 *
 * Defensive surface (mirrors computeDwellMs):
 *   - null / undefined hover-start → null (chip clicked without
 *     hovering first; e.g. keyboard activation that didn't trigger
 *     onFocus, or a touch-tap on mobile that emits click without
 *     mouseenter).
 *   - non-finite (NaN/Infinity) hover-start → null.
 *   - negative diff (clock drift / out-of-order events) → 0.
 *   - same-tick click (zero diff) → 0.
 */

export type HoverDwellBucket =
  | "0-200"
  | "200-500"
  | "500-1000"
  | "1000-3000"
  | "3000+"
  | "unknown";

export function computeHoverDwellMs(
  hoverStartedAt: number | null | undefined,
  clickedAt: number,
): number | null {
  if (hoverStartedAt == null) return null;
  if (typeof hoverStartedAt !== "number") return null;
  if (!Number.isFinite(hoverStartedAt)) return null;
  if (typeof clickedAt !== "number" || !Number.isFinite(clickedAt)) return null;
  const diff = clickedAt - hoverStartedAt;
  if (diff < 0) return 0;
  return diff;
}

export function hoverDwellBucket(
  ms: number | null | undefined,
): HoverDwellBucket {
  if (ms == null || typeof ms !== "number" || !Number.isFinite(ms))
    return "unknown";
  if (ms < 0) return "unknown";
  if (ms < 200) return "0-200";
  if (ms < 500) return "200-500";
  if (ms < 1000) return "500-1000";
  if (ms < 3000) return "1000-3000";
  return "3000+";
}
