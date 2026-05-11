/**
 * RecommendationList — premium redesign for s26 phase 3.
 *
 * Before: rows with the *threshold* in the right chip and the cushion
 * buried in the title attribute. Headline value was "порог 130" — the
 * less interesting number.
 * After: rank circle on the left for top-3, two-line uni/major label
 * in the center, and a stacked right chip showing **+12** as the
 * primary metric over a small `порог 130` underneath. Color band
 * matches cushion bracket.
 */

import { GraduationCap, Star } from "lucide-react";
import { ToolCardShell } from "./CardShell";
import type { RecommendationListData } from "./types";
import { useLang } from "../../../LanguageContext";
import { recommendationRowAriaLabel } from "./recommendationListAria";

interface Props {
  data: RecommendationListData;
}

function rankColor(margin: number) {
  if (margin >= 15)
    return {
      chip: "text-emerald-700 bg-emerald-50/80 ring-emerald-200/70",
      tone: "emerald" as const,
    };
  if (margin >= 5)
    return {
      chip: "text-amber-700 bg-amber-50/80 ring-amber-200/70",
      tone: "amber" as const,
    };
  return {
    chip: "text-zinc-700 bg-zinc-50/80 ring-zinc-200/70",
    tone: "zinc" as const,
  };
}

export function RecommendationList({ data }: Props) {
  // s35 wave 28d (2026-04-28): per-row SR labels via helper.
  // Hooks must run before any early-return — react-hooks/rules-of-hooks.
  const { lang } = useLang();
  const items = (data.items || []).slice(0, 5);
  if (items.length === 0) return null;
  const langSafe = lang === "kz" ? "kz" : "ru";

  return (
    <ToolCardShell
      title="Подходящие университеты"
      meta={`найдено: ${items.length}`}
      icon={<GraduationCap size={14} />}
      tone="emerald"
    >
      <div className="-mx-1 mb-1.5 flex items-baseline gap-2 px-1 text-[12px]">
        <span className="text-zinc-500">Ваш балл</span>
        <span className="text-[14px] font-semibold tabular-nums text-zinc-900">
          {data.score}
        </span>
        <span className="text-zinc-400">проходит в:</span>
      </div>
      <ul className="-mx-1 divide-y divide-zinc-100/80">
        {items.map((r, i) => {
          const margin = data.score - r.threshold;
          const sign = margin > 0 ? "+" : "";
          const { chip } = rankColor(margin);
          const isTop = i === 0;
          return (
            <li
              key={`${r.university}-${r.major_code ?? i}`}
              className="flex items-center gap-3 px-1 py-2.5"
              aria-label={recommendationRowAriaLabel({
                rank: i + 1,
                university: r.university,
                major: r.major ?? r.major_code ?? "",
                city: r.city ?? "",
                threshold: r.threshold,
                margin,
                lang: langSafe,
              })}
            >
              {/* Rank glyph for top-3, hollow circle for the rest */}
              <span
                className={
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums " +
                  (i === 0
                    ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
                    : i < 3
                      ? "bg-zinc-100 text-zinc-700"
                      : "border border-zinc-200 bg-white text-zinc-400")
                }
              >
                {isTop ? <Star size={11} fill="currentColor" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-zinc-900">
                  {r.university}
                </div>
                <div className="truncate text-[11.5px] text-zinc-500">
                  {r.major ? r.major : r.major_code || "—"}
                  {r.city ? <> · {r.city}</> : null}
                </div>
              </div>
              <div
                className={
                  "shrink-0 rounded-lg px-2.5 py-1 text-right ring-1 " + chip
                }
                title={`Порог ${r.threshold} · запас ${margin}`}
              >
                <div className="text-[14px] font-bold leading-tight tabular-nums">
                  {sign}
                  {margin}
                </div>
                <div className="text-[10px] tabular-nums opacity-70">
                  порог {r.threshold}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </ToolCardShell>
  );
}

export default RecommendationList;
