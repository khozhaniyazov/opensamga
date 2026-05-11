/**
 * s35 wave 31c (2026-04-28) — pure helper for the
 * `FeedbackButtons` reason-popover dialog accessible name.
 *
 * Pre-wave the popover was `<div role="dialog">` with NO
 * aria-label / aria-labelledby; the visible header "Что было
 * не так?" lived in a plain `<div className="font-semibold">`.
 * SR users opening the dialog heard only "dialog" with no
 * name. We synthesise an accessible name + a state hint:
 *   - direction-aware: "Форма обратной связи: что было не так
 *     с положительной оценкой?" / "...с отрицательной оценкой?"
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";
type Direction = "up" | "down";

interface Args {
  direction: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeDir(d: unknown): Direction | null {
  if (d === "up" || d === "down") return d;
  return null;
}

export function feedbackPopoverDialogAriaLabel({
  direction,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const dir = safeDir(direction);

  if (safeL === "kz") {
    if (dir === "up") {
      return "Кері байланыс формасы: оң бағаға не қосар едіңіз?";
    }
    if (dir === "down") {
      return "Кері байланыс формасы: не дұрыс емес?";
    }
    return "Кері байланыс формасы";
  }

  // ru
  if (dir === "up") {
    return "Форма обратной связи: что было удачным?";
  }
  if (dir === "down") {
    return "Форма обратной связи: что было не так?";
  }
  return "Форма обратной связи";
}
