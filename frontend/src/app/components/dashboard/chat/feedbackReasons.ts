/**
 * s34 wave 7 (I3 closeout, 2026-04-28): pure helpers for the
 * thumbs-down reason popover.
 *
 * The 👎 follow-up popover lives in FeedbackButtons.tsx. It offers
 * four canned reasons + an optional free-text textarea, then packs
 * both into the single `comment` column the backend exposes on
 * /feedback/chat (the `reason` column was scoped out — backend
 * deliberately keeps just one free-form text field, see
 * routers/feedback.py:55 last-write-wins UPSERT).
 *
 * Extracting the reason list + the packing format into a pure
 * module so:
 *   - the analytics roll-up (I2 next session) can reuse the same
 *     parser to recover the structured reason out of the packed
 *     blob without copy-pasting the regex,
 *   - vitest can pin the format as a contract (we've changed it
 *     once already in s26 phase 7 when the dead /chat/comment
 *     endpoint got killed; another silent change would re-break
 *     analytics).
 *
 * Format: `reason=<id>; <free text>` — but each piece is optional:
 *   - reason only         → `reason=off_topic`
 *   - free text only      → `<text>`
 *   - both                → `reason=off_topic; <text>`
 *   - neither             → null  (caller must guard before submit)
 *
 * The parser MUST round-trip every shape the packer produces, plus
 * tolerate legacy comments from before the canned-reason feature
 * (those are pure free-text, no `reason=` prefix).
 */

/** Stable ID enum. New ids appended at the end so analytics can
 *  bucket old data without a backfill. */
export type FeedbackReasonId =
  | "off_topic"
  | "inaccurate"
  | "incomplete"
  | "rude";

export interface FeedbackReason {
  id: FeedbackReasonId;
  /** Display label. Set per-language at the call site. */
  label: string;
}

export const FEEDBACK_REASONS_RU: readonly FeedbackReason[] = [
  { id: "off_topic", label: "Не по теме" },
  { id: "inaccurate", label: "Неточно" },
  { id: "incomplete", label: "Неполно" },
  { id: "rude", label: "Грубо" },
] as const;

export const FEEDBACK_REASONS_KZ: readonly FeedbackReason[] = [
  { id: "off_topic", label: "Тақырыпқа сай емес" },
  { id: "inaccurate", label: "Дәл емес" },
  { id: "incomplete", label: "Толық емес" },
  { id: "rude", label: "Дөрекі" },
] as const;

/** Maximum length boss policy lets through to the textarea. Mirrors
 *  the `maxLength={400}` on the textarea element so a future bump
 *  in one place flags the other in code review. */
export const FEEDBACK_COMMENT_MAX_LEN = 400 as const;

/** Pack a (reason, freeText) pair into the single backend column.
 *
 *  Returns `null` when both are empty so the caller can short-circuit
 *  the submit (the textarea+chip pair is the only UX where this
 *  function is invoked and an "empty submit" is a no-op there). */
export function packFeedbackComment(
  reason: FeedbackReasonId | null,
  freeText: string,
): string | null {
  const trimmed = (freeText || "").trim();
  if (!reason && !trimmed) return null;
  if (reason && trimmed) return `reason=${reason}; ${trimmed}`;
  if (reason) return `reason=${reason}`;
  return trimmed;
}

/** Inverse of packFeedbackComment. Returns the structured reason
 *  (if present at the start of the string) and the remaining
 *  free-text body. Tolerates legacy free-text-only rows from before
 *  the canned-reason feature shipped (s26 phase 2). */
export function parseFeedbackComment(packed: string | null | undefined): {
  reason: FeedbackReasonId | null;
  freeText: string;
} {
  if (!packed) return { reason: null, freeText: "" };
  const m = /^reason=([a-z_]+)(?:;\s*(.*))?$/s.exec(packed.trim());
  if (!m) return { reason: null, freeText: packed.trim() };
  const id = m[1] ?? "";
  const rest = (m[2] || "").trim();
  if (!isFeedbackReasonId(id)) {
    // Unknown reason id — preserve the original for analytics.
    return { reason: null, freeText: packed.trim() };
  }
  return { reason: id, freeText: rest };
}

/** Type guard: only ids in the canonical list count as structured. */
export function isFeedbackReasonId(id: string): id is FeedbackReasonId {
  return (
    id === "off_topic" ||
    id === "inaccurate" ||
    id === "incomplete" ||
    id === "rude"
  );
}
