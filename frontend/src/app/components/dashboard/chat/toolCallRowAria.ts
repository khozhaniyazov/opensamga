/**
 * s35 wave 31a (2026-04-28) — pure helpers for the
 * `ToolCallTimeline` per-call disclosure row + iteration
 * header accessible names.
 *
 * Pre-wave the per-call `<button aria-expanded>` had `title`
 * + `aria-expanded` only; SR fall-through reads the
 * concatenated visible spans (status icon decorative-only,
 * tool friendlyLabel, argSummary, duration) with no
 * semantic glue and no verb. We synthesise a single
 * accessible name that combines the action verb
 * (state-aware: "Развернуть инструмент" / "Свернуть
 * инструмент") with the friendly tool label, status,
 * optional duration, and optional arg-summary, so SR users
 * hear:
 *   "Развернуть инструмент: Поиск в библиотеке, готово, 412
 *    мс — query=электролиз".
 *
 * Iteration headers ("Шаг 2 · 3 инструментов") are
 * decorative spans pre-wave; we add an aria-label-friendly
 * helper that reads the count with proper RU pluralisation
 * ("Шаг 2, 3 инструмента, выполняются параллельно").
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

type ToolStatus = "running" | "done" | "error";

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

function safeStatus(s: unknown): ToolStatus {
  if (s === "running" || s === "error") return s;
  return "done";
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

function ruInstrumentNoun(n: number): string {
  const idx = ruPluralIndex(n);
  if (idx === 0) return "инструмент";
  if (idx === 1) return "инструмента";
  return "инструментов";
}

function statusPhrase(status: ToolStatus, lang: Lang): string {
  if (lang === "kz") {
    if (status === "running") return "орындалуда";
    if (status === "error") return "қате";
    return "дайын";
  }
  if (status === "running") return "выполняется";
  if (status === "error") return "ошибка";
  return "готово";
}

interface RowArgs {
  open: unknown;
  toolLabel: unknown;
  status: unknown;
  durationLabel: unknown;
  argSummary: unknown;
  lang: unknown;
}

export function toolCallRowAriaLabel({
  open,
  toolLabel,
  status,
  durationLabel,
  argSummary,
  lang,
}: RowArgs): string {
  const safeL = safeLang(lang);
  const isOpen = open === true;
  const label = safeStr(toolLabel);
  const dur = safeStr(durationLabel);
  const args = safeStr(argSummary);
  const st = safeStatus(status);

  if (safeL === "kz") {
    const verb = isOpen ? "Құралды жасыру" : "Құралды ашу";
    const head = label.length > 0 ? `${verb}: ${label}` : verb;
    const parts: string[] = [head, statusPhrase(st, "kz")];
    if (dur.length > 0) parts.push(dur);
    const base = parts.join(", ");
    if (args.length > 0) return `${base} — ${args}`;
    return base;
  }

  const verb = isOpen ? "Свернуть инструмент" : "Развернуть инструмент";
  const head = label.length > 0 ? `${verb}: ${label}` : verb;
  const parts: string[] = [head, statusPhrase(st, "ru")];
  if (dur.length > 0) parts.push(dur);
  const base = parts.join(", ");
  if (args.length > 0) return `${base} — ${args}`;
  return base;
}

interface IterationArgs {
  iteration: unknown;
  toolCount: unknown;
  lang: unknown;
}

export function toolCallIterationHeaderAriaLabel({
  iteration,
  toolCount,
  lang,
}: IterationArgs): string {
  const safeL = safeLang(lang);
  const iter = safeCount(iteration);
  const n = safeCount(toolCount);

  if (safeL === "kz") {
    const head = iter > 0 ? `${iter}-қадам` : "Қадам";
    if (n <= 0) return head;
    if (n === 1) return `${head}, 1 құрал`;
    return `${head}, ${n} құрал, қатар орындалуда`;
  }

  const head = iter > 0 ? `Шаг ${iter}` : "Шаг";
  if (n <= 0) return head;
  // RU "units rule": when the count grammatically takes the
  // singular noun (1, 21, 31, …) we also drop the
  // "выполняются параллельно" suffix because the verb would
  // need to switch to singular ("выполняется") and a single
  // tool isn't parallel anyway.
  if (ruPluralIndex(n) === 0) {
    return `${head}, ${n} ${ruInstrumentNoun(n)}`;
  }
  return `${head}, ${n} ${ruInstrumentNoun(n)}, выполняются параллельно`;
}
