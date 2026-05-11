/**
 * s35 wave 25a (2026-04-28) — pure helper for the
 * `Open/Close thread list` button on ChatPage.
 *
 * Before: aria-label was the bare `t("chat.threads.openRail")` /
 * `t("chat.threads.closeRail")` ("Открыть/Закрыть список чатов").
 * SR users got no signal of HOW MANY threads are sitting in the
 * collapsed rail, so a returning user with 1 thread heard the
 * same label as a power user with 50.
 *
 * After: when count > 0 we append "N бесед" with full RU paucal
 * (1 → "беседа", 2-4 → "беседы", 5-20+teens → "бесед", 21 →
 * "беседа") and KZ uninflected "N сұхбат". When closing, the
 * count is dropped — the user already knows how many threads are
 * visible, and adding a count there is just noise.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * NaN / Infinity / negative / float counts and unknown lang.
 */

export type ThreadRailToggleLang = "ru" | "kz";

export interface ThreadRailToggleAriaArgs {
  /** Total number of threads currently owned by the user. null /
   *  NaN / negative coerced to 0. */
  threadCount: number | null | undefined;
  /** Is the rail currently open? */
  open: boolean;
  lang: ThreadRailToggleLang;
}

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

function ruThreadNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "беседа";
  if (idx === 1) return "беседы";
  return "бесед";
}

/** Pure helper — full aria-label for the rail toggle. */
export function threadRailToggleAria(args: ThreadRailToggleAriaArgs): string {
  const langSafe: ThreadRailToggleLang = args.lang === "kz" ? "kz" : "ru";
  const count = safeCount(args.threadCount);

  if (args.open) {
    // When rail is OPEN, emit the close verb without count — the
    // count is already visible to the user via the rail itself.
    return langSafe === "kz" ? "Чаттар тізімін жабу" : "Закрыть список чатов";
  }

  if (langSafe === "kz") {
    if (count === 0) return "Чаттар тізімін ашу";
    return `Чаттар тізімін ашу, ${count} сұхбат`;
  }

  if (count === 0) return "Открыть список чатов";
  return `Открыть список чатов, ${count} ${ruThreadNoun(count)}`;
}
