/**
 * s35 wave 24a (2026-04-28) — pure helpers for the copy / regen
 * row labels in MessageActions.
 *
 * Two visible bugs at the time of recon:
 *
 *  1. The "more copy formats" chevron renders the literal i18n key
 *     `chat.action.copy_format` in the DOM (see live snapshot).
 *     The dictionary in LanguageContext has only the bare
 *     `chat.action.copy / copied / regenerate / regenerate_disabled`
 *     entries — `copy_format`, `copy_markdown`, `copy_plain` were
 *     referenced but never registered, so `t(key)` falls through
 *     to returning the key.
 *
 *  2. Every label is built inline with a 4-arg ternary
 *     (`t(key) || (lang==='kz' ? '…' : '…')`) duplicated 7 times
 *     in MessageActions.tsx, including a regenerate-disabled tooltip
 *     whose wording differs from the eventual aria-label. We fold
 *     them into one pure helper so the i18n + fallback contract
 *     is in a single, testable place.
 *
 * The helper takes the resolved RU/KZ pair (already chosen by
 * caller via the `lang` arg) and a tiny `getKey(key)=>string|null`
 * lookup. Caller passes `(k) => t(k) === k ? null : t(k)` when
 * dict is the source of truth, so we ALWAYS prefer registered
 * translations and only use the embedded fallback when the dict
 * row is missing. Returning the key (which is what `t` does on
 * miss) is treated as a miss.
 *
 * Pure: no DOM, no React, no Intl*.
 */

export type MessageActionsLang = "ru" | "kz";

export interface MessageActionsLabels {
  /** Visible label of the primary copy button (toggles to "copied"
   *  while the SR live-region announces). */
  copy: string;
  copied: string;
  /** Pop-up menu items for the copy split-control. */
  copyMarkdown: string;
  copyPlain: string;
  /** Aria-label of the chevron that opens the copy-format menu.
   *  This is the source of the visible-key bug closed in 24a. */
  copyFormat: string;
  /** Regenerate verb (enabled state). */
  regenerate: string;
  /** Title/tooltip used when regenerate is disabled (non-last
   *  bubble). Matches the consequence-aware aria pattern. */
  regenerateDisabled: string;
}

const BUILTIN: Record<MessageActionsLang, MessageActionsLabels> = {
  ru: {
    copy: "Копировать",
    copied: "Скопировано",
    copyMarkdown: "Копировать как Markdown",
    copyPlain: "Копировать как текст",
    copyFormat: "Формат копирования",
    regenerate: "Перегенерировать",
    regenerateDisabled: "Регенерация доступна только для последнего ответа",
  },
  kz: {
    copy: "Көшіру",
    copied: "Көшірілді",
    copyMarkdown: "Markdown ретінде көшіру",
    copyPlain: "Қарапайым мәтін ретінде көшіру",
    copyFormat: "Көшіру форматы",
    regenerate: "Қайталау",
    regenerateDisabled: "Қайта жасауды тек соңғы жауапта қолдануға болады",
  },
};

const KEY_MAP: Record<keyof MessageActionsLabels, string> = {
  copy: "chat.action.copy",
  copied: "chat.action.copied",
  copyMarkdown: "chat.action.copy_markdown",
  copyPlain: "chat.action.copy_plain",
  copyFormat: "chat.action.copy_format",
  regenerate: "chat.action.regenerate",
  regenerateDisabled: "chat.action.regenerate_disabled",
};

export type DictLookup = (key: string) => string | null | undefined;

/** Pure helper — resolves the full label set for `lang`, preferring
 *  dict-registered translations over the embedded fallback table.
 *  `getKey` may return null/undefined for "missing" or the key
 *  itself for "missing" (matches `useLang().t` semantics). */
export function messageActionsLabels(
  lang: MessageActionsLang,
  getKey?: DictLookup,
): MessageActionsLabels {
  const langSafe: MessageActionsLang = lang === "kz" ? "kz" : "ru";
  const fallback = BUILTIN[langSafe];
  if (!getKey) return { ...fallback };

  const out = { ...fallback };
  (Object.keys(KEY_MAP) as (keyof MessageActionsLabels)[]).forEach((field) => {
    const dictKey = KEY_MAP[field];
    let resolved: string | null | undefined;
    try {
      resolved = getKey(dictKey);
    } catch {
      resolved = null;
    }
    // `t` returns the key on miss — treat as miss too.
    if (
      typeof resolved === "string" &&
      resolved.length > 0 &&
      resolved !== dictKey
    ) {
      out[field] = resolved;
    }
  });
  return out;
}

/** Convenience for the copy-toggle UX: pick the right label given
 *  the ephemeral "copied" state. */
export function copyButtonLabel(
  copied: boolean,
  labels: Pick<MessageActionsLabels, "copy" | "copied">,
): string {
  return copied ? labels.copied : labels.copy;
}
