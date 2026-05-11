/**
 * s35 wave 28e (2026-04-28) — pure helper for the
 * HistoricalThresholdSparkline figure semantics.
 *
 * Pre-wave the sparkline `<svg>` was unlabeled and read out
 * as nothing (or a mountain of "graphics-symbol" fragments
 * if the SR walked the polylines). The visible chip with
 * "2/3 ✓" was meaningful only sighted.
 *
 * Fix: wrap the SVG in a `role="img"` with a single
 * synthesized `aria-label` like:
 *   "Динамика порогов за 2022–2024: 125, 128, 130. Ваш
 *    балл 130, выше 2 из 3 лет."
 *
 * Pure helper: takes ordered points + optional user score
 * + lang and returns the label string. No DOM, no React.
 */

type Lang = "ru" | "kz";

export interface ThresholdPoint {
  year: number;
  threshold: number;
}

interface Args {
  points: unknown;
  userScore: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safePoints(points: unknown): ThresholdPoint[] {
  if (!Array.isArray(points)) return [];
  const out: ThresholdPoint[] = [];
  for (const raw of points) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { year?: unknown; threshold?: unknown };
    if (
      typeof r.year !== "number" ||
      typeof r.threshold !== "number" ||
      !Number.isFinite(r.year) ||
      !Number.isFinite(r.threshold)
    ) {
      continue;
    }
    out.push({
      year: Math.round(r.year),
      threshold: Math.round(r.threshold),
    });
  }
  return out.slice().sort((a, b) => a.year - b.year);
}

export function historicalThresholdFigureAriaLabel({
  points,
  userScore,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const pts = safePoints(points);
  if (pts.length === 0) {
    return safeL === "kz"
      ? "Шекті балдар тарихы: дерек жоқ"
      : "История порогов: нет данных";
  }

  // pts.length === 0 guarded above; non-null asserts ok here.
  const yearMin = pts[0]!.year;
  const yearMax = pts[pts.length - 1]!.year;
  const valuesList = pts.map((p) => p.threshold).join(", ");
  const yearRange =
    yearMin === yearMax ? `${yearMin}` : `${yearMin}–${yearMax}`;

  const head =
    safeL === "kz"
      ? `${yearRange} жылдардағы шекті балдар динамикасы: ${valuesList}.`
      : `Динамика порогов за ${yearRange}: ${valuesList}.`;

  if (typeof userScore !== "number" || !Number.isFinite(userScore)) {
    return head;
  }

  const u = Math.round(userScore);
  const above = pts.filter((p) => p.threshold <= u).length;
  const total = pts.length;

  if (safeL === "kz") {
    return `${head} Сіздің балл ${u}, ${total} жылдың ${above}-нан жоғары.`;
  }
  return `${head} Ваш балл ${u}, выше ${above} из ${total} лет.`;
}
