/**
 * s35 wave 29c (2026-04-28) — pure helper for the
 * UniComparisonTable's table-level accessible name.
 *
 * The card itself now claims a labelled `role="group"`
 * landmark via ToolCardShell (wave 28a), so card-level
 * navigation is fine. But once an SR descends into the
 * table itself it gets "table" with no identity. We add
 * a screen-reader-only `<caption>` synthesized from this
 * helper so SR users hear:
 *   "Сравнение университетов: КазНУ, ЕНУ, КБТУ. 7
 *    параметров."
 *
 *   - Lists up to the first 3 university names (the
 *     component already caps to 3).
 *   - Adds a row-count phrase with full RU paucal
 *     ("1 параметр / 2-4 параметра / 5+ параметров"). The
 *     "row count" here means the *comparison rows*, not
 *     the header row.
 *   - KZ uninflected mirror.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  uniNames: unknown;
  rowCount: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeCount(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

function safeNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .slice(0, 3);
}

function ruRowForm(n: number): string {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return "параметров";
  if (m10 === 1) return "параметр";
  if (m10 >= 2 && m10 <= 4) return "параметра";
  return "параметров";
}

export function uniComparisonTableCaption({
  uniNames,
  rowCount,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const names = safeNames(uniNames);
  const rows = safeCount(rowCount);

  if (safeL === "kz") {
    const head = "Университеттерді салыстыру";
    const namePart = names.length > 0 ? `: ${names.join(", ")}` : "";
    const rowPart = rows > 0 ? `. ${rows} параметр.` : "";
    return `${head}${namePart}${rowPart}`.trim();
  }

  // ru
  const head = "Сравнение университетов";
  const namePart = names.length > 0 ? `: ${names.join(", ")}` : "";
  const rowPart = rows > 0 ? `. ${rows} ${ruRowForm(rows)}.` : "";
  return `${head}${namePart}${rowPart}`.trim();
}
