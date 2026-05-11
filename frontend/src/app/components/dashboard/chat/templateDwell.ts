/**
 * s35 wave 54 (2026-04-28) — ChatTemplates dwell-before-click helper.
 *
 * The B1 template tiles already record a `chat_template_clicked`
 * event with template_id / locale / rank_position /
 * was_personalized. What's been missing all along is a "was the
 * user actually deciding, or did they stab the first tile reflexively
 * after mount" signal. This helper computes the `dwell_ms_since_mount`
 * field that w54 adds to the click event:
 *
 *   - mountedAt is set in `useEffect(() => …, [])` of ChatTemplates,
 *     i.e. AFTER the first paint.
 *   - clickedAt is `Date.now()` in the onClick handler.
 *   - The diff is clamped to a non-negative finite integer.
 *
 * Why a separate module: the timing math has three edge cases the
 * inline call site would have to repeat — clock drift, mountedAt
 * still being null on the very first frame (race-condition tile
 * focus), and a hostile NaN/Infinity value. Pure helper + vitest
 * keeps that contract honest.
 *
 * Why not Performance.now(): we already use Date.now() in
 * `BackpressureIndicator` for the same wall-clock-coarse purpose.
 * Sub-ms precision is unobservable for a click funnel.
 */

/** Compute the dwell time (ms) between mount and a click.
 *  Returns 0 on:
 *   - mountedAt being null/undefined (component clicked before
 *     mount effect ran — extremely rare but theoretically possible
 *     in a future Suspense world).
 *   - clickedAt being null/undefined.
 *   - either value being non-finite (NaN/Infinity).
 *   - clickedAt < mountedAt (clock drift / debugger pause).
 *  Otherwise returns the floored positive integer ms diff. */
export function computeDwellMs(
  mountedAt: number | null | undefined,
  clickedAt: number | null | undefined,
): number {
  if (mountedAt == null || clickedAt == null) return 0;
  if (typeof mountedAt !== "number" || typeof clickedAt !== "number") {
    return 0;
  }
  if (!Number.isFinite(mountedAt) || !Number.isFinite(clickedAt)) return 0;
  const diff = clickedAt - mountedAt;
  if (diff <= 0) return 0;
  return Math.floor(diff);
}

/** Bucket a dwell-ms value into a low-cardinality string for
 *  dashboards. Buckets: <500ms (reflexive), 500-2000ms (skim),
 *  2-10s (read), 10-60s (deliberate), >=60s (idle then click).
 *  Pure helper — exported for vitest pinning + reused by the
 *  optional dashboard-side preprocessor.
 */
export function dwellBucket(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 500) return "reflexive_lt_500ms";
  if (ms < 2000) return "skim_500_2000ms";
  if (ms < 10_000) return "read_2_10s";
  if (ms < 60_000) return "deliberate_10_60s";
  return "idle_gte_60s";
}
