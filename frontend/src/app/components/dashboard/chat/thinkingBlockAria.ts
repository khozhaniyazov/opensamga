/**
 * s35 wave 30b (2026-04-28) — pure helper for the
 * ThinkingBlock disclosure-button accessible name.
 *
 * Pre-wave the violet "Процесс размышлений · N знаков"
 * disclosure had `aria-expanded={open}` but no aria-label;
 * SR users heard only the visible header text. New helper
 * synthesises a state-aware verb + the existing header
 * text:
 *   "Развернуть внутренние мысли модели: Процесс
 *    размышлений · 3694 знаков."
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

export function thinkingBlockToggleAriaLabel({
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
    const verb = isOpen
      ? "Ішкі ойларды жасыру"
      : streaming
        ? "Ағымдағы ішкі ойларды ашу"
        : "Ішкі ойларды ашу";
    if (head.length === 0) return verb;
    return `${verb}: ${head}`;
  }

  // ru
  const verb = isOpen
    ? "Свернуть внутренние мысли модели"
    : streaming
      ? "Развернуть текущие внутренние мысли модели"
      : "Развернуть внутренние мысли модели";
  if (head.length === 0) return verb;
  return `${verb}: ${head}`;
}
