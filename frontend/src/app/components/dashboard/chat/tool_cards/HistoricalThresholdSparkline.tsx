/**
 * Multi-year threshold sparkline — premium redesign for s26 phase 3.
 *
 * Before: 2px amber polyline + 3px circles in a near-empty 280×80 box,
 * dashed user-score line with a 9px overlapping label, only x-min/x-max
 * year ticks. Read as "1990s sparkline."
 * After:
 *   - Soft gradient area fill from amber-500/30 → amber-500/0 under the
 *     line, line bumped to 1.75px amber-700 with a 4px white halo for
 *     legibility.
 *   - Every year gets an x-axis tick + label.
 *   - 2 horizontal gridlines at quantiles, drawn at 0.4 opacity.
 *   - User score becomes a right-side callout chip outside the chart
 *     area ("Ваш балл 130 ✓ выше 2/3"), with a clean dashed reference
 *     line inside the chart.
 *   - Each data point is a 4px filled circle with a 1.5px white inner
 *     ring so it pops against the area fill.
 */

import { TrendingUp } from "lucide-react";
import { ToolCardShell } from "./CardShell";
import type { HistoricalThresholdData } from "./types";
import { useLang } from "../../../LanguageContext";
import { historicalThresholdFigureAriaLabel } from "./historicalThresholdSparklineAria";

interface Props {
  data: HistoricalThresholdData;
}

export function HistoricalThresholdSparkline({ data }: Props) {
  // s35 wave 28e (2026-04-28): figure-level SR label via helper.
  // Hooks must run before any early-return — react-hooks/rules-of-hooks.
  const { lang } = useLang();
  const pts = (data.points || []).slice().sort((a, b) => a.year - b.year);
  if (pts.length === 0) return null;
  const langSafe = lang === "kz" ? "kz" : "ru";
  const figureLabel = historicalThresholdFigureAriaLabel({
    points: pts,
    userScore: data.user_score ?? null,
    lang: langSafe,
  });

  const W = 320;
  const H = 100;
  const PAD_X = 28;
  const PAD_TOP = 10;
  const PAD_BOTTOM = 22;
  const PAD_RIGHT = 24;

  const xs = pts.map((p) => p.year);
  const ys = pts.map((p) => p.threshold);
  const userY = data.user_score;

  const yMinRaw = Math.min(...ys, userY ?? Number.POSITIVE_INFINITY);
  const yMaxRaw = Math.max(...ys, userY ?? Number.NEGATIVE_INFINITY);
  const yMin = yMinRaw - 5;
  const yMax = yMaxRaw + 5;
  const yRange = Math.max(1, yMax - yMin);

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = Math.max(1, xMax - xMin);

  const innerLeft = PAD_X;
  const innerRight = W - PAD_RIGHT;
  const innerTop = PAD_TOP;
  const innerBottom = H - PAD_BOTTOM;

  const scaleX = (x: number) =>
    pts.length === 1
      ? (innerLeft + innerRight) / 2
      : innerLeft + ((x - xMin) / xRange) * (innerRight - innerLeft);
  const scaleY = (y: number) =>
    innerBottom - ((y - yMin) / yRange) * (innerBottom - innerTop);

  const linePath = pts
    .map((p, i) => {
      const x = scaleX(p.year);
      const y = scaleY(p.threshold);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Closed area path for the gradient fill.
  // Caller (component body) ensures pts.length >= 1 before invoking
  // this helper; the non-null asserts satisfy noUncheckedIndexedAccess.
  const firstX = scaleX(pts[0]!.year);
  const lastX = scaleX(pts[pts.length - 1]!.year);
  const areaPath =
    linePath +
    ` L${lastX.toFixed(1)},${innerBottom.toFixed(1)}` +
    ` L${firstX.toFixed(1)},${innerBottom.toFixed(1)} Z`;

  // 2 gridlines at quantiles
  const gridYs = [
    innerTop + (innerBottom - innerTop) * (1 / 3),
    innerTop + (innerBottom - innerTop) * (2 / 3),
  ];

  // User-score verdict
  const aboveCount = userY != null ? ys.filter((t) => t <= userY).length : 0;
  const verdictLabel =
    userY != null
      ? `${aboveCount}/${ys.length} ${
          aboveCount === ys.length ? "✓" : aboveCount === 0 ? "✗" : ""
        }`
      : "";

  return (
    <ToolCardShell
      title={
        <span>
          {data.university}
          {data.major ? (
            <span className="text-zinc-500"> · {data.major}</span>
          ) : null}
        </span>
      }
      titleText={
        data.major ? `${data.university} · ${data.major}` : data.university
      }
      meta={`${Math.min(...ys)}…${Math.max(...ys)}`}
      icon={<TrendingUp size={14} />}
      tone="amber"
    >
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block"
        role="img"
        aria-label={figureLabel}
      >
        <defs>
          <linearGradient id="ht-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines */}
        {gridYs.map((y, i) => (
          <line
            key={`g-${i}`}
            x1={innerLeft}
            x2={innerRight}
            y1={y}
            y2={y}
            stroke="#e4e4e7"
            strokeWidth={1}
            opacity={0.6}
            strokeDasharray="2,3"
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#ht-area)" />

        {/* Halo behind line for legibility */}
        <path
          d={linePath}
          fill="none"
          stroke="#fff"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#b45309"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points: 4px filled + 1.5px white inner ring */}
        {pts.map((p) => (
          <g key={p.year}>
            <circle
              cx={scaleX(p.year)}
              cy={scaleY(p.threshold)}
              r={4}
              fill="#b45309"
            />
            <circle
              cx={scaleX(p.year)}
              cy={scaleY(p.threshold)}
              r={1.5}
              fill="#fff"
            />
          </g>
        ))}

        {/* User score reference line (no inline label) */}
        {userY != null && (
          <line
            x1={innerLeft}
            x2={innerRight}
            y1={scaleY(userY)}
            y2={scaleY(userY)}
            stroke="#10b981"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {/* X-axis ticks: every year */}
        {pts.map((p, i) => {
          // Skip duplicate labels when single-pt
          const x = scaleX(p.year);
          return (
            <g key={`x-${p.year}-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={innerBottom}
                y2={innerBottom + 3}
                stroke="#a1a1aa"
                strokeWidth={1}
              />
              <text
                x={x}
                y={innerBottom + 14}
                fontSize={10}
                fill="#71717a"
                textAnchor="middle"
              >
                {p.year}
              </text>
            </g>
          );
        })}

        {/* Y-axis min/max labels */}
        <text
          x={innerLeft - 4}
          y={scaleY(yMin) + 3}
          fontSize={9}
          fill="#a1a1aa"
          textAnchor="end"
        >
          {Math.round(yMin)}
        </text>
        <text
          x={innerLeft - 4}
          y={scaleY(yMax) + 3}
          fontSize={9}
          fill="#a1a1aa"
          textAnchor="end"
        >
          {Math.round(yMax)}
        </text>
      </svg>

      {userY != null ? (
        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span className="text-zinc-500">
            Ваш балл{" "}
            <span className="font-semibold tabular-nums text-zinc-800">
              {userY}
            </span>
          </span>
          <span
            className={
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium " +
              (aboveCount === ys.length
                ? "bg-emerald-50 text-emerald-700"
                : aboveCount === 0
                  ? "bg-rose-50 text-rose-700"
                  : "bg-amber-50 text-amber-700")
            }
          >
            проходит {verdictLabel}
          </span>
        </div>
      ) : null}
    </ToolCardShell>
  );
}

export default HistoricalThresholdSparkline;
