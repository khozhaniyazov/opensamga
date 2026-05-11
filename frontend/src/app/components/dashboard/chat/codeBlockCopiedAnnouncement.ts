/**
 * s35 wave 22a (2026-04-28) — pure helper for the SR-only
 * "code copied to clipboard" live-region announcement on
 * `CodeBlock`.
 *
 * Today the Copy button on a code block visually morphs from
 * `<Copy>` → `<Check>` for ~1.8 s and the `aria-label` text
 * flips from "Скопировать" → "Скопировано" via copyButtonLabel.
 * Same problem as the wave-19a MessageActions copy: SR users
 * who fire the action and tab away never re-read the toggled
 * label, so the confirmation is silent. A polite live-region
 * announcement closes the gap and (when known) names the line
 * count so the user knows how much they just lifted — useful
 * for long blocks that were collapsed before they hit Copy.
 *
 *   1 line  RU  → "Скопирован 1 фрагмент кода"
 *   N lines RU  → "Скопировано N строк кода" (paucal-aware)
 *   1 line  KZ  → "1 жол код көшірілді"
 *   N lines KZ  → "N жол код көшірілді" (uninflected)
 *   line count missing/0 → bare "Код скопирован" / "Код көшірілді"
 *
 * RU pluralisation rule mirrors threadRowAriaLabel /
 * threadSearchAnnouncement / etc.: 1 → singular, 2-4 → paucal,
 * 5-20 + teens 11-14 → genitive plural, 21 → singular. KZ
 * uninflected.
 *
 * The component owns the (separate) `<div role="status"
 * aria-live="polite" class="sr-only">` sibling and the
 * pulse-then-clear timing — same pattern as wave-13b composer
 * counter live cell + wave-19a message-copied announce.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against
 * null/NaN/negative/float line counts and unknown lang.
 */

export type CodeBlockCopiedLang = "ru" | "kz";

export interface CodeBlockCopiedAnnouncementArgs {
  /** Total line count of the copied block (countCodeLines).
   *  Null/undefined/0/negative → falls back to bare confirmation. */
  lines: number | null | undefined;
  lang: CodeBlockCopiedLang;
}

function safeIntLines(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

function ruPluralIndex(n: number): 0 | 1 | 2 {
  // 1 → singular, 2-4 → paucal, 5-20 + teens 11-14 → genitive
  // plural, 21 → singular again. Locked-in across s35 helpers.
  const tens = Math.abs(n) % 100;
  const units = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return 2;
  if (units === 1) return 0;
  if (units >= 2 && units <= 4) return 1;
  return 2;
}

/** Pure helper — full live-region announcement string. */
export function codeBlockCopiedAnnouncement(
  args: CodeBlockCopiedAnnouncementArgs,
): string {
  const langSafe: CodeBlockCopiedLang = args.lang === "kz" ? "kz" : "ru";
  const lines = safeIntLines(args.lines);
  if (lines === 0) {
    return langSafe === "kz" ? "Код көшірілді" : "Код скопирован";
  }
  if (langSafe === "kz") {
    return `${lines} жол код көшірілді`;
  }
  // RU branch — pluralise the noun + verb.
  const idx = ruPluralIndex(lines);
  if (idx === 0) {
    // 1, 21, 31, ... — singular "строка" → "Скопирована 1 строка кода"
    // (keeping the verb-first cadence that screen readers handle
    // gracefully and that mirrors wave-19a's "Скопировано как ...")
    return `Скопирована ${lines} строка кода`;
  }
  if (idx === 1) {
    // 2-4, 22-24, ... — paucal "строки"
    return `Скопировано ${lines} строки кода`;
  }
  // 5+, teens 11-14 — genitive plural "строк"
  return `Скопировано ${lines} строк кода`;
}
