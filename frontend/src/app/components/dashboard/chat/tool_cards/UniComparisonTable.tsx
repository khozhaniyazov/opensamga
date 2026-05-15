/**
 * UniComparisonTable — premium redesign for s26 phase 3.
 *
 * Before: phpMyAdmin-style table with 12px font, header same color as
 * body, "да/нет" text, no winner highlighting.
 * After:
 *   - Sticky uni header band with city subtitle.
 *   - Left rail with row labels + tonal icons (Users, Home, Shield, Globe).
 *   - Booleans render as Check / Minus icons in tonal pills.
 *   - Numeric "Студентов" cell shows a thin inline bar vs the row max
 *     plus a tabular-nums value.
 *   - Per-row winner cell gets a soft emerald wash + "лучше" tag.
 */

import {
  Globe,
  Home,
  Scale,
  ShieldCheck,
  Users,
  Check,
  Minus,
  MapPin,
} from "lucide-react";
import { ToolCardShell } from "./CardShell";
import type { UniComparisonData, UniComparisonRow } from "./types";
import { useLang } from "../../../LanguageContext";
import { safeHttpHref } from "../../../../lib/safeHref";
import { uniComparisonTableCaption } from "./uniComparisonTableAria";

interface Props {
  data: UniComparisonData;
}

function fmtBool(v: unknown) {
  if (v === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
        <Check size={11} />
        да
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100/80 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
        <Minus size={11} />
        нет
      </span>
    );
  }
  return <span className="text-zinc-300">—</span>;
}

interface RowDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  numeric?: boolean;
  read: (u: UniComparisonRow) => unknown;
  format?: (v: unknown, max?: number) => React.ReactNode;
}

export function UniComparisonTable({ data }: Props) {
  // s35 wave 29c (2026-04-28): synthesize an SR-only <caption>
  // so the inner <table> is not anonymous to AT users.
  // Hooks must run before any early-return — react-hooks/rules-of-hooks.
  const { lang } = useLang();
  const unis = (data.unis || []).slice(0, 3);
  if (unis.length === 0) return null;
  const langSafe = lang === "kz" ? "kz" : "ru";

  const studentMax = Math.max(1, ...unis.map((u) => u.total_students || 0));

  const rows: RowDef[] = [
    {
      key: "city",
      label: "Город",
      icon: <MapPin size={13} className="text-sky-500" />,
      read: (u) => u.city,
    },
    {
      key: "students",
      label: "Студентов",
      icon: <Users size={13} className="text-violet-500" />,
      numeric: true,
      read: (u) => u.total_students,
      format: (v) => {
        if (v == null || v === "")
          return <span className="text-zinc-300">—</span>;
        const n = Number(v);
        const pct = Math.min(100, Math.round((n / studentMax) * 100));
        return (
          <div className="flex items-center gap-2">
            <div className="h-1 w-12 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-violet-400/80"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[12px] tabular-nums text-zinc-700">
              {n.toLocaleString("ru-RU")}
            </span>
          </div>
        );
      },
    },
    {
      key: "dorm",
      label: "Общежитие",
      icon: <Home size={13} className="text-amber-500" />,
      read: (u) => u.has_dorm,
      format: fmtBool,
    },
    {
      key: "military",
      label: "Военная кафедра",
      icon: <ShieldCheck size={13} className="text-emerald-500" />,
      read: (u) => u.military_chair,
      format: fmtBool,
    },
    {
      key: "site",
      label: "Сайт",
      icon: <Globe size={13} className="text-indigo-500" />,
      read: (u) => u.website,
      format: (v) => {
        const safe = typeof v === "string" ? safeHttpHref(v) : undefined;
        return safe ? (
          <a
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-800"
          >
            {String(v).replace(/^https?:\/\//, "").replace(/\/$/, "")}
            <span className="opacity-70">↗</span>
          </a>
        ) : (
          <span className="text-zinc-300">—</span>
        );
      },
    },
  ];

  return (
    <ToolCardShell
      title="Сравнение университетов"
      meta={`${unis.length} вуза`}
      icon={<Scale size={14} />}
      tone="sky"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <caption className="sr-only">
            {uniComparisonTableCaption({
              uniNames: unis.map((u) => u.name),
              rowCount: rows.length,
              lang: langSafe,
            })}
          </caption>
          <thead>
            <tr>
              <th className="border-b border-zinc-100 px-2 py-1.5 text-left font-medium text-zinc-400">
                {/* row label column */}
              </th>
              {unis.map((u) => (
                <th
                  key={u.name}
                  className="border-b border-zinc-100 px-2 py-1.5 text-left align-bottom"
                >
                  <div className="text-[12.5px] font-semibold text-zinc-900 leading-tight">
                    {u.name}
                  </div>
                  {u.city ? (
                    <div className="text-[10.5px] font-normal text-zinc-500">
                      {u.city}
                    </div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = unis.map((u) => row.read(u));
              const numericVals = row.numeric
                ? values
                    .map((v) => (typeof v === "number" ? v : Number(v) || null))
                    .filter((v): v is number => v != null)
                : [];
              const winnerValue =
                row.numeric && numericVals.length > 1
                  ? Math.max(...numericVals)
                  : null;
              return (
                <tr key={row.key}>
                  <td className="border-t border-zinc-100 px-2 py-2 align-middle text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      {row.icon}
                      <span className="font-medium">{row.label}</span>
                    </span>
                  </td>
                  {unis.map((u, i) => {
                    const v = values[i];
                    const isWinner =
                      winnerValue != null &&
                      typeof v === "number" &&
                      v === winnerValue &&
                      numericVals.length > 1 &&
                      new Set(numericVals).size > 1;
                    return (
                      <td
                        key={u.name}
                        className={
                          "border-t border-zinc-100 px-2 py-2 align-middle " +
                          (isWinner ? "bg-emerald-50/60" : "")
                        }
                      >
                        <div className="flex items-center gap-1.5">
                          {row.format ? (
                            row.format(v, winnerValue ?? undefined)
                          ) : v == null || v === "" ? (
                            <span className="text-zinc-300">—</span>
                          ) : (
                            <>{String(v)}</>
                          )}
                          {isWinner ? (
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700">
                              лучше
                            </span>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ToolCardShell>
  );
}

export default UniComparisonTable;
