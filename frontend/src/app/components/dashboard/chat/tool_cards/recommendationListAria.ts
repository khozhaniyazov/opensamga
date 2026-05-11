/**
 * s35 wave 28d (2026-04-28) — pure helpers for the
 * RecommendationList row semantics.
 *
 * Pre-wave each row was four flex children: a numeric/star
 * rank glyph, a 2-line uni/major/city label, and a stacked
 * "+12 / порог 130" chip. SR navigation read those out as
 * fragments — "1, КазНУ Юриспруденция Алматы +12 порог
 * 130" — losing the relationship between margin, threshold,
 * and rank.
 *
 * Fix: each `<li>` claims `aria-label` from this helper,
 * which composes a single-utterance sentence:
 *   "1 место: КазНУ, Юриспруденция, Алматы. Порог 130,
 *    запас баллов +12."
 *
 *  - lang ∈ "ru" | "kz". Defaults to "ru".
 *  - margin sign: positive → "+N", negative → "−N" (uses
 *    the proper minus, not hyphen-minus, since SR voices
 *    say "minus" for both but punctuation is cleaner).
 *  - margin === 0 → "запас баллов 0" (still informative).
 *  - missing major / city gracefully omitted.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  rank: unknown;
  university: unknown;
  major: unknown;
  city: unknown;
  threshold: unknown;
  margin: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

function safeInt(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function formatSigned(margin: number): string {
  if (margin > 0) return `+${margin}`;
  if (margin < 0) return `−${Math.abs(margin)}`;
  return "0";
}

export function recommendationRowAriaLabel({
  rank,
  university,
  major,
  city,
  threshold,
  margin,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const r = safeInt(rank, 0);
  const u = safeStr(university);
  const m = safeStr(major);
  const c = safeStr(city);
  const t = safeInt(threshold, 0);
  const mg = safeInt(margin, 0);

  // Compose place phrase
  const placePart =
    r > 0 ? (safeL === "kz" ? `${r}-орын: ` : `${r} место: `) : "";

  // Compose uni-major-city section
  const idParts: string[] = [];
  if (u.length > 0) idParts.push(u);
  if (m.length > 0) idParts.push(m);
  if (c.length > 0) idParts.push(c);
  const idJoined =
    idParts.length > 0
      ? idParts.join(", ")
      : safeL === "kz"
        ? "белгісіз университет"
        : "университет не указан";

  // Compose threshold + margin tail
  const signed = formatSigned(mg);
  const tail =
    safeL === "kz"
      ? `Шекті балл ${t}, баллдар қоры ${signed}.`
      : `Порог ${t}, запас баллов ${signed}.`;

  return `${placePart}${idJoined}. ${tail}`;
}
