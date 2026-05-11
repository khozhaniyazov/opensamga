/**
 * s35 wave 41 (E3 close-out, 2026-04-28) — pure helper for the
 * "Move to folder…" submenu rows in ThreadRail's kebab.
 *
 * E3 PARTIAL (s33 caf6b87) shipped the folders state foundation
 * (`samga.chat.threadFolders` envelope, MAX=24, palette, dangler
 * defense) and s34 wave 1 (E3 wave 2) shipped the visible folder
 * strip above the thread list. The remaining gap was the
 * row-level "move this thread to a folder" affordance — without
 * it, the only way for a user to populate folders was via the
 * `localStorage` JSON.
 *
 * This helper owns the per-row aria-label so SR users hear which
 * thread moves where, including a special case for "remove from
 * folder" (assignment ⇒ null). The visible chrome stays the bare
 * folder name.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  /** Thread title (resolved label) — wraps in «…» when present.
   *  Falsy / whitespace falls back to "беседа" / "сұхбат". */
  threadTitle: unknown;
  /** Destination folder name when moving INTO a folder; null when
   *  the action is "unfile" (remove from any folder). */
  folderName: unknown;
  /** Whether this row is the destination the thread is currently
   *  filed in. When true, the helper emits a "уже в папке X" /
   *  "X папкасында тұр" cue so the user knows the click is a no-op. */
  isCurrent: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

function safeBool(v: unknown): boolean {
  return v === true;
}

function fallbackThreadTitle(lang: Lang): string {
  return lang === "kz" ? "сұхбат" : "беседа";
}

function threadRef(title: unknown, lang: Lang): string {
  const t = safeStr(title);
  return t.length > 0 ? `«${t}»` : fallbackThreadTitle(lang);
}

/** Pure helper — single-row aria-label for a "Move to folder X" /
 *  "Remove from folder" menu item. */
export function threadFolderMoveAriaLabel({
  threadTitle,
  folderName,
  isCurrent,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const ref = threadRef(threadTitle, safeL);
  const folder = safeStr(folderName);
  const current = safeBool(isCurrent);

  if (safeL === "kz") {
    if (folder.length === 0) {
      // Unfile (folder=null).
      return current
        ? `${ref} сұхбаты қазір ешқандай папкада емес`
        : `${ref} сұхбатын папкадан шығару`;
    }
    return current
      ? `${ref} сұхбаты «${folder}» папкасында тұр`
      : `${ref} сұхбатын «${folder}» папкасына жылжыту`;
  }

  // ru
  if (folder.length === 0) {
    return current ? `${ref} уже не в папке` : `Убрать ${ref} из папки`;
  }
  return current
    ? `${ref} уже в папке «${folder}»`
    : `Переместить ${ref} в папку «${folder}»`;
}

/** Pure helper — section heading aria-label for the submenu
 *  group. Emitted on the wrapping `<div role="group">` so SR
 *  users hear "Move to folder" once before the folder rows. */
export function threadFolderMoveGroupAriaLabel(lang: unknown): string {
  return safeLang(lang) === "kz" ? "Папкаға жылжыту" : "Переместить в папку";
}

/** Pure helper — visible row text for a folder-move row.
 *  Empty folderName ⇒ "Without folder" / "Папкасыз".  */
export function threadFolderMoveRowText(
  folderName: unknown,
  lang: unknown,
): string {
  const safeL = safeLang(lang);
  const folder = safeStr(folderName);
  if (folder.length === 0) {
    return safeL === "kz" ? "Папкасыз" : "Без папки";
  }
  return folder;
}
