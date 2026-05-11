/**
 * s26 phase 3 (2026-04-26): shared chrome for every tool-result card.
 *
 * Before this file existed every card hand-rolled its own
 * `border border-zinc-200 bg-zinc-50 rounded-lg p-3` recipe — that's
 * why the whole tool-result region read as "internal admin tool":
 * flat 1px borders, near-zero radius, no gradient, no header band.
 *
 * `ToolCardShell` wraps:
 *   - rounded-2xl outer (12 → 16px radius)
 *   - layered shadow (1px contour + 8px ambient)
 *   - optional accent header band with a soft gradient + icon tile
 *   - tonal palette token (`tone`) so cards self-coordinate
 *
 * Tones map to a 4-stop semantic palette: amber (default / scholar),
 * emerald (success / cushion), sky (info / profile), violet (history /
 * attempts), rose (alert / mistakes), indigo (memory / chats).
 */

import type { ReactNode } from "react";
import { toolCardHeadingId } from "./toolCardShellAria";

export type CardTone =
  | "amber"
  | "emerald"
  | "sky"
  | "violet"
  | "rose"
  | "indigo"
  | "zinc";

const TONE_HEADER: Record<CardTone, string> = {
  amber:
    "bg-gradient-to-br from-amber-50/90 via-white to-amber-50/30 border-b border-amber-100/80",
  emerald:
    "bg-gradient-to-br from-emerald-50/90 via-white to-emerald-50/30 border-b border-emerald-100/80",
  sky: "bg-gradient-to-br from-sky-50/90 via-white to-sky-50/30 border-b border-sky-100/80",
  violet:
    "bg-gradient-to-br from-violet-50/90 via-white to-violet-50/30 border-b border-violet-100/80",
  rose: "bg-gradient-to-br from-rose-50/90 via-white to-rose-50/30 border-b border-rose-100/80",
  indigo:
    "bg-gradient-to-br from-indigo-50/90 via-white to-indigo-50/30 border-b border-indigo-100/80",
  zinc: "bg-gradient-to-br from-zinc-50/90 via-white to-zinc-50/30 border-b border-zinc-200/60",
};

const TONE_ICON: Record<CardTone, string> = {
  amber: "bg-amber-100/80 text-amber-700 ring-1 ring-amber-200/60",
  emerald: "bg-emerald-100/80 text-emerald-700 ring-1 ring-emerald-200/60",
  sky: "bg-sky-100/80 text-sky-700 ring-1 ring-sky-200/60",
  violet: "bg-violet-100/80 text-violet-700 ring-1 ring-violet-200/60",
  rose: "bg-rose-100/80 text-rose-700 ring-1 ring-rose-200/60",
  indigo: "bg-indigo-100/80 text-indigo-700 ring-1 ring-indigo-200/60",
  zinc: "bg-zinc-100/80 text-zinc-700 ring-1 ring-zinc-200/60",
};

interface Props {
  /** Header title, ~13–14px semibold. */
  title: ReactNode;
  /** Optional 11px right-aligned subtitle in the header band. */
  meta?: ReactNode;
  /** Lucide icon at 14px. */
  icon: ReactNode;
  /** Color family for header band + icon tile. */
  tone?: CardTone;
  /** Card body. */
  children: ReactNode;
  /** s35 wave 28a (2026-04-28): Optional explicit string title
   *  used for deriving a stable heading id when the visible
   *  `title` prop is JSX. Falls back to the JSX path → empty
   *  string → `tool-card` slug. */
  titleText?: string;
}

export function ToolCardShell({
  title,
  meta,
  icon,
  tone = "zinc",
  children,
  titleText,
}: Props) {
  // s35 wave 28a (2026-04-28): the previously-anonymous header
  // <span> is now an actual <h3> with a stable id. Body region
  // claims `aria-labelledby` against that id so SR users get a
  // labelled landmark per card.
  const headingId = toolCardHeadingId(
    typeof titleText === "string" && titleText.length > 0
      ? titleText
      : typeof title === "string"
        ? title
        : "",
  );
  return (
    <div
      className="my-3 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_4px_12px_-6px_rgba(24,24,27,0.05)] samga-anim-tool-card"
      role="group"
      aria-labelledby={headingId}
    >
      <div
        className={
          "flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold text-zinc-900 " +
          TONE_HEADER[tone]
        }
      >
        <span
          className={
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg " +
            TONE_ICON[tone]
          }
          aria-hidden="true"
        >
          {icon}
        </span>
        <h3
          id={headingId}
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900"
          style={{ marginBlock: 0 }}
        >
          {title}
        </h3>
        {meta ? (
          <span className="shrink-0 text-[11px] font-medium text-zinc-500 tabular-nums">
            {meta}
          </span>
        ) : null}
      </div>
      <div className="px-4 py-3 text-[13px] text-zinc-700">{children}</div>
    </div>
  );
}

/** Horizontal accuracy/progress bar, used by PracticeSummary and
 *  GrantChanceGauge. tone drives the fill color. */
export function ProgressBar({
  pct,
  tone,
  height = 6,
}: {
  pct: number;
  tone: "emerald" | "amber" | "rose" | "sky" | "violet";
  height?: number;
}) {
  const fillTone =
    tone === "emerald"
      ? "from-emerald-400 to-emerald-500"
      : tone === "amber"
        ? "from-amber-400 to-amber-500"
        : tone === "rose"
          ? "from-rose-400 to-rose-500"
          : tone === "violet"
            ? "from-violet-400 to-violet-500"
            : "from-sky-400 to-sky-500";
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="overflow-hidden rounded-full bg-zinc-100"
      style={{ height }}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r ${fillTone}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export default ToolCardShell;
