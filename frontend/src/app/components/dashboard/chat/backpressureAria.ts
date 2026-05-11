/**
 * s35 wave 25e (2026-04-28) — pure helper for the
 * BackpressureIndicator's consequence-aware aria-label.
 *
 * Today the pill renders with `role="status"` + `aria-live="polite"`
 * and a visible body of "Сеть медленная — догоняем…". When SR
 * picks it up, all the user hears is the bare label. They get no
 * hint about WHY the pill appeared, what's happening behind the
 * scenes, or whether they need to do anything.
 *
 * This helper folds the visible label + a short, calming
 * consequence sentence into one aria-label so SR users get parity
 * with sighted users plus an extra hint that the request is still
 * alive (and that pressing Esc stops it).
 *
 * Output (RU):
 *   "Сеть медленная — догоняем… Запрос продолжается, ничего делать не нужно. Нажмите Esc, чтобы остановить."
 *
 * Output (KZ):
 *   "Желі баяу — жалғастырып жатырмыз… Сұраныс жалғасуда, ештеңе істеудің қажеті жоқ. Тоқтату үшін Esc басыңыз."
 *
 * Pure: no DOM, no React, no Intl*. Defensive against unknown
 * lang.
 */

export type BackpressureLang = "ru" | "kz";

const VISIBLE_LABEL: Record<BackpressureLang, string> = {
  ru: "Сеть медленная — догоняем…",
  kz: "Желі баяу — жалғастырып жатырмыз…",
};

const CONSEQUENCE: Record<BackpressureLang, string> = {
  ru: "Запрос продолжается, ничего делать не нужно. Нажмите Esc, чтобы остановить.",
  kz: "Сұраныс жалғасуда, ештеңе істеудің қажеті жоқ. Тоқтату үшін Esc басыңыз.",
};

/** Pure helper — visible label only (re-exports the localised
 *  string for callers that want to render the visible chrome
 *  without going through `backpressureLabel`). Kept so the new
 *  helper module is self-contained. */
export function backpressureVisibleLabel(lang: BackpressureLang): string {
  const langSafe: BackpressureLang = lang === "kz" ? "kz" : "ru";
  return VISIBLE_LABEL[langSafe];
}

/** Pure helper — full aria-label. */
export function backpressureAriaLabel(lang: BackpressureLang): string {
  const langSafe: BackpressureLang = lang === "kz" ? "kz" : "ru";
  return `${VISIBLE_LABEL[langSafe]} ${CONSEQUENCE[langSafe]}`;
}
