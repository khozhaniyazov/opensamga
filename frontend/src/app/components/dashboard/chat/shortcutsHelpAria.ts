/**
 * s35 wave 25b (2026-04-28) — pure helpers for the
 * ShortcutsHelp modal labelling.
 *
 * Two papercuts closed in this wave:
 *
 *  1. Dialog had `role="dialog"` + `aria-modal="true"` + an
 *     `aria-labelledby` (the title), but no description. SR users
 *     opened the modal and heard "Горячие клавиши" with no cue
 *     about its purpose / how to dismiss it. We now bind a
 *     `aria-describedby` to a sr-only paragraph that says how
 *     many shortcuts are listed and that Esc / the close button
 *     dismisses.
 *
 *  2. Trigger button title had a literal double space between
 *     verb and "(?)" hint (closed inline in ChatHeader.tsx).
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * NaN / negative / float counts and unknown lang.
 */

export type ShortcutsHelpLang = "ru" | "kz";

export const SHORTCUTS_HELP_DESCRIPTION_ID = "shortcuts-help-description";

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

function ruShortcutNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "сочетание клавиш";
  if (idx === 1) return "сочетания клавиш";
  return "сочетаний клавиш";
}

/** Pure helper — full descriptive sentence rendered into the
 *  `aria-describedby` sr-only paragraph. */
export function shortcutsHelpDescription(args: {
  shortcutCount: number | null | undefined;
  lang: ShortcutsHelpLang;
}): string {
  const langSafe: ShortcutsHelpLang = args.lang === "kz" ? "kz" : "ru";
  const count = safeCount(args.shortcutCount);

  if (langSafe === "kz") {
    if (count === 0) {
      return "Жабу үшін Esc немесе «Жабу» батырмасын басыңыз.";
    }
    return `${count} пернетақта қысқартуы көрсетілген. Жабу үшін Esc немесе «Жабу» батырмасын басыңыз.`;
  }

  if (count === 0) {
    return "Нажмите Esc или «Закрыть», чтобы выйти.";
  }
  return `Показано ${count} ${ruShortcutNoun(count)}. Нажмите Esc или «Закрыть», чтобы выйти.`;
}
