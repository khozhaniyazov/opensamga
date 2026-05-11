/**
 * s35 wave 62 (2026-04-28) — first-send timing helpers.
 *
 * Funnel question we're answering: when a user lands on the chat
 * page, how long do they stare at the empty state before sending
 * their first message? The split tells us:
 *   - Sub-2 s        → user came in with intent (knew what to ask).
 *   - 2-10 s         → user read the placeholder rotation / templates.
 *   - 10-60 s        → user explored the empty-state cards / panels.
 *   - 60 s+          → user got distracted, came back, sent.
 *   - never          → user bounced (we don't emit anything in
 *                      that case — the ABSENCE of the event is
 *                      the bounce signal).
 *
 * Pure helpers so the timing math is pinnable without a renderer.
 * Mirrors the templateDwell + citationHoverDwell defensive
 * surface (null/non-finite/negative-diff handling).
 */

export type FirstSendBucket = "0-2s" | "2-10s" | "10-60s" | "60s+" | "unknown";

export function computeTimeToFirstSendMs(
  mountedAt: number | null | undefined,
  sentAt: number,
): number | null {
  if (mountedAt == null) return null;
  if (typeof mountedAt !== "number") return null;
  if (!Number.isFinite(mountedAt)) return null;
  if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  const diff = sentAt - mountedAt;
  if (diff < 0) return 0;
  return diff;
}

export function firstSendBucket(
  ms: number | null | undefined,
): FirstSendBucket {
  if (ms == null || typeof ms !== "number" || !Number.isFinite(ms))
    return "unknown";
  if (ms < 0) return "unknown";
  if (ms < 2_000) return "0-2s";
  if (ms < 10_000) return "2-10s";
  if (ms < 60_000) return "10-60s";
  return "60s+";
}
