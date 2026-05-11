/**
 * s33 (D6, 2026-04-28) — backpressure indicator helpers.
 *
 * Boss brief from roadmap row D6: "Backpressure indicator when SSE
 * buffer behind (rare but real on 4G)". When the network is jittery
 * the assistant keeps generating tokens server-side, but client
 * deltas land in stutters of 200-2000ms. The user sees a frozen
 * text chunk and assumes the request is hung.
 *
 * Pattern: track `lastDeltaAt` (wall-clock ms of the most recent
 * text growth on the streaming message) and the `isSending` flag.
 * If isSending && (now - lastDeltaAt) > LAG_THRESHOLD_MS, render a
 * subtle "догоняем…" / "жалғасуда…" pill so the user knows we
 * haven't given up.
 *
 * Pure classifier here; the component (BackpressureIndicator.tsx)
 * polls the value at a regular cadence and renders accordingly.
 */

/** Threshold for declaring a streaming session "lagging". 3500 ms
 *  is a sweet spot from observed 4G traces — long enough to filter
 *  ordinary inter-token gaps (300-1500 ms), short enough to feel
 *  responsive when the network actually stalls. */
export const BACKPRESSURE_LAG_THRESHOLD_MS = 3500;

/** How often to re-classify, ms. The component drives a setInterval
 *  at this cadence so the pill flips without waiting for the next
 *  delta. */
export const BACKPRESSURE_POLL_MS = 500;

/** Localized label for the "we're still here, network is slow" pill. */
export function backpressureLabel(lang: "ru" | "kz"): string {
  return lang === "kz"
    ? "Желі баяу — жалғастырып жатырмыз…"
    : "Сеть медленная — догоняем…";
}

/** Pure classifier: given a snapshot of the streaming state, decide
 *  whether the backpressure pill should render. */
export function shouldShowBackpressure(args: {
  isSending: boolean;
  lastDeltaAt: number | null;
  now: number;
  thresholdMs?: number;
}): boolean {
  const { isSending, lastDeltaAt, now, thresholdMs } = args;
  if (!isSending) return false;
  if (lastDeltaAt == null || !Number.isFinite(lastDeltaAt)) return false;
  if (!Number.isFinite(now)) return false;
  const threshold = thresholdMs ?? BACKPRESSURE_LAG_THRESHOLD_MS;
  return now - lastDeltaAt >= threshold;
}

/** Pure helper — given the previous and current streaming-message
 *  text, decide whether a "real" delta landed.
 *
 *  We only count growth (text length increases). Resets to ""
 *  happen when the user starts a new turn AND when the streaming
 *  message remounts; neither should be treated as a backpressure-
 *  resetting event. Defensive on null/undefined inputs.
 */
export function isRealDelta(
  prevText: string | null | undefined,
  nextText: string | null | undefined,
): boolean {
  const prev = typeof prevText === "string" ? prevText : "";
  const next = typeof nextText === "string" ? nextText : "";
  if (next.length <= prev.length) return false;
  return next.startsWith(prev) || prev.length === 0;
}
