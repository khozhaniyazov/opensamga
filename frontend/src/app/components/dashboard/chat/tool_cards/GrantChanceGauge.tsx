/**
 * Grant chance gauge — premium redesign for s26 phase 3.
 *
 * Before: tiny inline percentage + a 2px progress bar with a 12×12
 * marker, 100..140 fixed scale. Read as "progress widget."
 * After: 28px tabular percentage as the headline, 3-zone gauge
 * (rose → amber → emerald) with adaptive scale that pads ±15 around
 * (score, threshold), labeled threshold tick + score chip floating
 * above the bar, trust-signal row at the bottom (year + estimated vs
 * exact label).
 */

import { TrendingUp, Info } from "lucide-react";
import { ToolCardShell } from "./CardShell";
import type { GrantChanceData } from "./types";
import { useLang } from "../../../LanguageContext";
import {
  gaugeProbabilityPercent,
  grantChanceGaugeValueText,
} from "./grantChanceGaugeAria";

interface Props {
  data: GrantChanceData;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function estimateProbability(score: number, threshold: number): number {
  const margin = score - threshold;
  return clamp(1 / (1 + Math.exp(-margin / 5)), 0, 1);
}

function probTone(p: number): "emerald" | "amber" | "rose" {
  if (p >= 0.65) return "emerald";
  if (p >= 0.4) return "amber";
  return "rose";
}

export function GrantChanceGauge({ data }: Props) {
  const { score, threshold, university, major, quota_type } = data;
  const prob = data.probability ?? estimateProbability(score, threshold);
  const tone = probTone(prob);
  // s35 wave 28c (2026-04-28): centralised through helper so the
  // gauge body and the SR `aria-valuetext` agree on the rounded
  // percentage, instead of double-rounding two ways.
  const { lang } = useLang();
  const langSafe = lang === "kz" ? "kz" : "ru";
  const pct = gaugeProbabilityPercent(prob);
  const pctLabel = `${pct}%`;
  const isEstimate = data.probability == null;
  const gaugeValueText = grantChanceGaugeValueText({
    probability: prob,
    isEstimate,
    score,
    threshold,
    lang: langSafe,
  });

  // Adaptive scale: pad ±15 around the relevant range, snap to 5.
  const lo = Math.min(score, threshold) - 15;
  const hi = Math.max(score, threshold) + 15;
  const MIN = Math.floor(lo / 5) * 5;
  const MAX = Math.ceil(hi / 5) * 5;
  const span = (v: number) => clamp(((v - MIN) / (MAX - MIN)) * 100, 0, 100);
  const scorePct = span(score);
  const thresholdPct = span(threshold);

  const quotaLabel =
    quota_type && quota_type !== "GENERAL" ? quota_type : "общий конкурс";

  // Headline color matches probability tone.
  const headlineColor =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-rose-600";

  return (
    <ToolCardShell
      title={
        <span>
          {university}
          {major ? <span className="text-zinc-500"> · {major}</span> : null}
        </span>
      }
      titleText={major ? `${university} · ${major}` : university}
      meta={quotaLabel}
      icon={<TrendingUp size={14} />}
      tone={tone}
    >
      <div className="flex items-baseline gap-3">
        <div
          className={`text-[32px] font-bold leading-none tabular-nums tracking-tight ${headlineColor}`}
        >
          {pctLabel}
        </div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">
          {isEstimate ? "оценочная вероятность" : "вероятность поступления"}
        </div>
      </div>

      {/* Three-zone gauge with score marker + threshold tick.
       *  s35 wave 28c (2026-04-28): wrapper now exposes a real
       *  `role="progressbar"` with valuenow/min/max + verbose
       *  valuetext so SR users get the headline percentage and
       *  the score-vs-threshold narrative as a single utterance. */}
      <div
        className="relative mt-4 mb-6 h-2.5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={gaugeValueText}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full bg-gradient-to-r from-rose-200/70 via-amber-200/80 to-emerald-200/80" />
        {/* Threshold tick */}
        <div
          className="absolute -top-1 h-4.5 w-px bg-zinc-500"
          style={{ left: `${thresholdPct}%`, height: 18 }}
          aria-label={`Порог: ${threshold}`}
        />
        <div
          className="absolute mt-3 -translate-x-1/2 text-[10px] font-medium tabular-nums text-zinc-600"
          style={{ left: `${thresholdPct}%`, top: 8 }}
        >
          порог {threshold}
        </div>
        {/* Score chip floating above the bar */}
        <div
          className={
            "absolute -translate-x-1/2 -top-7 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums shadow-sm border " +
            (tone === "emerald"
              ? "bg-emerald-500 text-white border-emerald-600"
              : tone === "amber"
                ? "bg-amber-500 text-white border-amber-600"
                : "bg-rose-500 text-white border-rose-600")
          }
          style={{ left: `${scorePct}%` }}
        >
          ваш {score}
        </div>
        {/* Score marker */}
        <div
          className={
            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-[0_2px_4px_rgba(0,0,0,0.18)] " +
            (tone === "emerald"
              ? "bg-emerald-500"
              : tone === "amber"
                ? "bg-amber-500"
                : "bg-rose-500")
          }
          style={{ left: `${scorePct}%` }}
        />
      </div>

      {/* Min/Max axis labels + trust row */}
      <div className="flex items-center justify-between text-[10.5px] text-zinc-400 tabular-nums">
        <span>{MIN}</span>
        <span>{MAX}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Info size={11} className="text-zinc-400" />
        <span>
          {isEstimate
            ? "по логистической модели от запаса баллов"
            : "по данным грантов прошлых лет"}
          {data.year ? ` · ${data.year}` : ""}
        </span>
      </div>
    </ToolCardShell>
  );
}

export default GrantChanceGauge;
