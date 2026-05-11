/**
 * s35 wave 30a (2026-04-28) — pure helper for the
 * ReasoningPanel disclosure-button accessible name.
 *
 * Pre-wave the ReasoningPanel's main toggle was an
 * unlabelled `<button aria-expanded={open}>` whose only
 * accessible name was the visible header text — which
 * itself comes from `buildReasoningHeader` and reads things
 * like "Готово · 3 шага · 7 инструментов · 4.1s" or
 * "Размышляю · 2.4s". SR users got the metric but no verb;
 * the action ("expand the panel to see the agent's
 * reasoning trail") was invisible.
 *
 * Fix: synthesize an aria-label that COMBINES the action
 * verb (state-aware: "Развернуть процесс рассуждений" vs
 * "Свернуть процесс рассуждений") with the existing header
 * text, plus a streaming hint when applicable. SR users
 * hear "Свернуть процесс рассуждений: Готово · 3 шага · 7
 * инструментов · 4.1s" — full action + identity in one
 * utterance.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  open: unknown;
  isStreaming: unknown;
  headerText: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

export function reasoningPanelToggleAriaLabel({
  open,
  isStreaming,
  headerText,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const isOpen = open === true;
  const streaming = isStreaming === true;
  const head = safeStr(headerText);

  if (safeL === "kz") {
    const verb = isOpen ? "Ой процесін жасыру" : "Ой процесін ашу";
    if (head.length === 0) return verb;
    return `${verb}: ${head}`;
  }

  // ru
  const verb = isOpen
    ? "Свернуть процесс рассуждений"
    : streaming
      ? "Развернуть текущий процесс рассуждений"
      : "Развернуть процесс рассуждений";
  if (head.length === 0) return verb;
  return `${verb}: ${head}`;
}
