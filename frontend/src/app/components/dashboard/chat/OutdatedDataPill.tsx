/**
 * s32 (A5, 2026-04-27) — OutdatedDataPill.
 *
 * Renders a small amber "⚠ Данные могут устареть" chip below the
 * SourcesDrawer when at least one consulted source is older than
 * the staleness threshold. Mirrors the s28-s30 trust-pill pattern:
 * pure helpers in this same file (predicate + label + classifier),
 * the component is the thin shell.
 *
 * Source of truth for the staleness threshold:
 *   STALENESS_THRESHOLD_DAYS = 540   (~18 months)
 *
 * Why 18 months: ENT/UNT prep textbooks get re-snapshotted
 * approximately yearly; an 18-month-old chunk is one major
 * curriculum update behind. The threshold is intentionally
 * conservative to avoid false positives on freshly re-OCRed
 * textbooks that retain pre-A5 timestamps.
 *
 * The pill is rendered ONCE per assistant turn (next to the
 * SourcesDrawer affordance), not once per source. The label format
 * is "⚠ Данные могут устареть (N ИЗ M)" so the user can gauge how
 * much of the answer is potentially behind.
 */

import { AlertTriangle } from "lucide-react";
import { useLang } from "../../LanguageContext";
import type { ConsultedSource } from "./types";

/** ~18 months in days. Any consulted source whose updated_at is
 *  older than this threshold is counted toward the pill's denominator. */
export const STALENESS_THRESHOLD_DAYS = 540;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns true iff the source's `updated_at` is a valid ISO date
 *  AND is older than the staleness threshold relative to `now`.
 *  Defensive on missing/non-string/unparseable values — those are
 *  treated as "unknown freshness", NOT as "stale" (avoids false
 *  positives on legacy snapshots). */
export function isSourceStale(
  source: Pick<ConsultedSource, "updated_at"> | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!source) return false;
  const raw = source.updated_at;
  if (typeof raw !== "string" || raw.trim().length === 0) return false;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return false;
  if (parsed > now) {
    // A future timestamp is malformed/clock-skew, NOT stale.
    return false;
  }
  const ageDays = (now - parsed) / MS_PER_DAY;
  return ageDays > STALENESS_THRESHOLD_DAYS;
}

/** How many of the supplied sources are stale. Returns 0 on a
 *  non-array input — defensive; the parent normally feeds the
 *  AssistantMetadata.consulted_sources array. */
export function countStaleSources(
  sources: readonly ConsultedSource[] | null | undefined,
  now: number = Date.now(),
): number {
  if (!Array.isArray(sources) || sources.length === 0) return 0;
  let n = 0;
  for (const s of sources) {
    if (isSourceStale(s, now)) n += 1;
  }
  return n;
}

/** Pill visibility predicate. Show iff at least ONE consulted
 *  source is stale. The denominator (`sources.length`) is rendered
 *  on the chip but is NOT a gate — even a 1/8 stale ratio is worth
 *  flagging. */
export function shouldShowOutdatedDataPill(
  sources: readonly ConsultedSource[] | null | undefined,
  now: number = Date.now(),
): boolean {
  return countStaleSources(sources, now) > 0;
}

/** Build the human-readable chip label. Defensive on impossible
 *  ratios (stale > total). Language-resolved by the consumer via
 *  the i18n key `chat.outdatedData.label` so the layout stays
 *  consistent across RU/KZ. */
export function outdatedDataPillLabel(
  staleCount: number,
  totalCount: number,
  baseLabel: string,
): string {
  const safeTotal = Math.max(totalCount, staleCount);
  if (safeTotal <= 0 || staleCount <= 0) return baseLabel;
  return `${baseLabel} (${staleCount}/${safeTotal})`;
}

interface Props {
  sources: readonly ConsultedSource[] | null | undefined;
  /** Optional clock injection — defaults to `Date.now()`. The
   *  parent never passes this in production; vitest does. */
  now?: number;
}

export function OutdatedDataPill({ sources, now = Date.now() }: Props) {
  const { t } = useLang();
  const stale = countStaleSources(sources, now);
  if (stale <= 0) return null;
  const total = Array.isArray(sources) ? sources.length : 0;
  const base = t("chat.outdatedData.label") || "Данные могут устареть";
  const tooltip =
    t("chat.outdatedData.tooltip") ||
    "Один или несколько источников старше 18 месяцев. Сверьтесь со свежим учебником.";
  return (
    <span
      role="status"
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 samga-anim-pill"
    >
      <AlertTriangle size={11} aria-hidden className="text-amber-600" />
      <span>{outdatedDataPillLabel(stale, total, base)}</span>
    </span>
  );
}

export default OutdatedDataPill;
