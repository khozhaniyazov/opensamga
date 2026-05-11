/**
 * s35 wave 27c (2026-04-28) — pure helper for SourcesDrawer
 * expand/collapse button aria-label.
 *
 * Pre-wave the button bound a bare verb:
 *   open  → "Скрыть список источников"
 *   closed → "Раскрыть список источников"
 *
 * The visible chrome inside the same button shows the count
 * (e.g. "3 источника"), but the count is only inside an inner
 * <span> that's not part of the accessible name on `aria-label`
 * binding. SR users hear "Раскрыть список источников" and don't
 * know whether 1 or 12 entries lurk behind it. Boss's wave-21+
 * pattern was to bake the count into the SR label too.
 *
 * Fix: full RU paucal table (1→источник, 2-4→источника, 5-20+
 * teens→источников, 21→источник units rule), KZ uninflected
 * "N дереккөз". Falls back to bare verb when count <= 0 (drawer
 * is hidden entirely in that case anyway, but the helper stays
 * defensive).
 */

export type SourcesDrawerLang = "ru" | "kz";

function safeCount(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

function ruSourceNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "источник";
  if (idx === 1) return "источника";
  return "источников";
}

/** Pure helper — full aria-label for the SourcesDrawer toggle. */
export function sourcesDrawerToggleAria(args: {
  count: number | null | undefined;
  open: boolean;
  lang: SourcesDrawerLang;
}): string {
  const langSafe: SourcesDrawerLang = args.lang === "kz" ? "kz" : "ru";
  const n = safeCount(args.count);

  if (langSafe === "kz") {
    const head = args.open
      ? "Дереккөздер тізімін жасыру"
      : "Дереккөздер тізімін ашу";
    if (n <= 0) return head;
    return `${head}, ${n} дереккөз`;
  }

  const head = args.open
    ? "Скрыть список источников"
    : "Раскрыть список источников";
  if (n <= 0) return head;
  return `${head}, ${n} ${ruSourceNoun(n)}`;
}
