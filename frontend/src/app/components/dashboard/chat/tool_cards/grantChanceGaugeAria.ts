/**
 * s35 wave 28c (2026-04-28) — pure helpers for the
 * GrantChanceGauge progressbar semantics.
 *
 * Pre-wave the gauge was a pile of decorative <div>s with
 * a tiny floating chip showing percentage. SR users heard
 * "Подходящие университеты" (the previous card) but no
 * value for the gauge itself; the only inline aria-label
 * was on the threshold tick (`Порог: NNN`) which gave a
 * threshold but no probability.
 *
 * Fix: wrap the bar in a `role="progressbar"` element with
 * aria-valuenow / aria-valuemin / aria-valuemax + an
 * accessible aria-valuetext. The valuetext is verbose
 * enough that SR users get the headline number AND the
 * narrative ("ваш балл 130, порог 125, оценочная
 * вероятность 73%"), independent of whether they reach the
 * 32px headline number.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  /** 0..1 probability. */
  probability: unknown;
  /** Whether the probability is a logistic estimate (true)
   *  vs a real grant-history match (false). */
  isEstimate: unknown;
  score: unknown;
  threshold: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeNumber(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return n;
}

function clamp01(p: number): number {
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

/** 0..100 integer percent, clamped. */
export function gaugeProbabilityPercent(probability: unknown): number {
  const p = clamp01(safeNumber(probability, 0));
  return Math.round(p * 100);
}

/** Verbose, language-aware narration for the gauge. */
export function grantChanceGaugeValueText({
  probability,
  isEstimate,
  score,
  threshold,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const pct = gaugeProbabilityPercent(probability);
  const s = Math.round(safeNumber(score, 0));
  const th = Math.round(safeNumber(threshold, 0));
  const est = isEstimate === true;

  if (safeL === "kz") {
    const verdict = est ? "болжамды ықтималдық" : "грант алу ықтималдығы";
    return `Сіздің балл ${s}, шекті балл ${th}, ${verdict} ${pct}%`;
  }
  // ru
  const verdict = est ? "оценочная вероятность" : "вероятность поступления";
  return `Ваш балл ${s}, порог ${th}, ${verdict} ${pct}%`;
}
