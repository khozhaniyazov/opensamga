/**
 * s35 wave 33a (2026-04-28) — pure helper for `ChatComposer`
 * keyboard-shortcut hint, surfaced via a sr-only sibling +
 * `aria-describedby` on the `<textarea>`.
 *
 * Pre-wave the composer's textarea exposed only its
 * `aria-label` ("Поле для сообщения чата Samga"); the visible
 * keyboard tip strip ("Enter — отправить · Shift+Enter — новая
 * строка · / — команды · ↑ — повторить") is rendered AS PART
 * OF the same component but lives in a sibling `<div>` with
 * its own visible chrome — nothing programmatically tied them
 * together, so SR users hit the textarea with only the bare
 * label and had to discover shortcuts by trial.
 *
 * The helper composes a single comma-separated sentence so an
 * AT user hears the textarea's purpose AND the available
 * shortcuts in one sweep on focus. State-aware:
 *   - `isSending` flips the "Enter — отправить" cue OFF (it's
 *     blocked) and the "Esc — остановить" cue ON (Esc stops
 *     the in-flight response).
 *   - `composing` (input-method-editor in progress) suppresses
 *     the Enter cue too because Enter commits the IME instead
 *     of sending.
 *   - `slashMenuOpen` mentions that ↑/↓/Enter navigate/select
 *     items rather than recalling history.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  isSending: unknown;
  composing: unknown;
  slashMenuOpen: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeBool(v: unknown): boolean {
  return v === true;
}

const COPY = {
  ru: {
    label: "Подсказка по горячим клавишам",
    enterSend: "Enter — отправить",
    shiftEnter: "Shift + Enter — новая строка",
    slash: "Слэш — открыть меню команд",
    arrowUp: "Стрелка вверх — повторить последнее сообщение",
    escStop: "Esc — остановить ответ",
    slashNav:
      "стрелки вверх и вниз — выбрать команду, Enter — подтвердить, Esc — закрыть меню",
  },
  kz: {
    label: "Жылдам пернелер бойынша көмек",
    enterSend: "Enter — жіберу",
    shiftEnter: "Shift + Enter — жаңа жол",
    slash: "Слэш — командалар мәзірін ашу",
    arrowUp: "Жоғарғы көрсеткі — соңғы хабарламаны қайталау",
    escStop: "Esc — жауапты тоқтату",
    slashNav:
      "жоғары және төмен көрсеткілер — команданы таңдау, Enter — растау, Esc — мәзірді жабу",
  },
} as const;

export function composerHintAriaText({
  isSending,
  composing,
  slashMenuOpen,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const sending = safeBool(isSending);
  const ime = safeBool(composing);
  const slash = safeBool(slashMenuOpen);
  const c = COPY[safeL];

  // Slash-menu mode is its own paragraph because the same keys
  // mean different things while the menu is open.
  if (slash) {
    return `${c.label}: ${c.slashNav}.`;
  }

  const parts: string[] = [];
  // Enter cue is suppressed while sending or while an IME
  // composition is mid-flight.
  if (!sending && !ime) {
    parts.push(c.enterSend);
  }
  parts.push(c.shiftEnter);
  parts.push(c.slash);
  if (!sending) {
    parts.push(c.arrowUp);
  }
  if (sending) {
    parts.push(c.escStop);
  }

  return `${c.label}: ${parts.join(", ")}.`;
}

/** Stable id used both for the sr-only span and the textarea's
 *  `aria-describedby`. Single source of truth so a future code
 *  rename touches only this file. */
export const COMPOSER_HINT_DESCRIPTION_ID = "samga-composer-hint";
