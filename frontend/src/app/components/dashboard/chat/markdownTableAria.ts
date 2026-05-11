/**
 * s35 wave 29a (2026-04-28) — pure helper for markdown
 * `<table>` accessible-name synthesis inside assistant
 * bubbles.
 *
 * Pre-wave the assistant's `markdownComponents.table`
 * renderer emitted an unlabeled `<table>` (and an outer
 * `<div>` with overflow chrome). SR users got "table" /
 * "tablo with N columns and M rows" with no identity. The
 * GFM specification gives us no native caption for these
 * tables.
 *
 * Fix: synthesize a count-aware aria-label from the table's
 * shape: "Таблица: N столбцов, M строк." / KZ "Кесте: N
 * баған, M жол." When either dimension is unknown (helper
 * receives 0/NaN), the missing half is silently dropped —
 * no nonsense numbers, no fragments. When both are
 * unknown, returns the bare noun "Таблица" / "Кесте".
 *
 * Counts use full RU paucal (1 столбец / 2-4 столбца /
 * 5-20+teens столбцов; 1 строка / 2-4 строки / 5+ строк).
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  columnCount: unknown;
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

/** RU paucal noun selection. */
function ruColumnForm(c: number): string {
  const m100 = c % 100;
  const m10 = c % 10;
  if (m100 >= 11 && m100 <= 14) return "столбцов";
  if (m10 === 1) return "столбец";
  if (m10 >= 2 && m10 <= 4) return "столбца";
  return "столбцов";
}

function ruRowForm(c: number): string {
  const m100 = c % 100;
  const m10 = c % 10;
  if (m100 >= 11 && m100 <= 14) return "строк";
  if (m10 === 1) return "строка";
  if (m10 >= 2 && m10 <= 4) return "строки";
  return "строк";
}

export function markdownTableAriaLabel({
  columnCount,
  rowCount,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const c = safeCount(columnCount);
  const r = safeCount(rowCount);

  if (safeL === "kz") {
    const head = "Кесте";
    if (c === 0 && r === 0) return head;
    const tail: string[] = [];
    if (c > 0) tail.push(`${c} баған`);
    if (r > 0) tail.push(`${r} жол`);
    return `${head}: ${tail.join(", ")}.`;
  }

  // ru
  const head = "Таблица";
  if (c === 0 && r === 0) return head;
  const tail: string[] = [];
  if (c > 0) tail.push(`${c} ${ruColumnForm(c)}`);
  if (r > 0) tail.push(`${r} ${ruRowForm(r)}`);
  return `${head}: ${tail.join(", ")}.`;
}
