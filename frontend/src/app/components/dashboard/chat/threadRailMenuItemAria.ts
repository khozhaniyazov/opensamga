/**
 * s35 wave 32a (2026-04-28) — pure helper for the
 * `ThreadRail` per-thread kebab-menu items' accessible
 * names.
 *
 * Pre-wave each `<button role="menuitem">` carried no
 * `aria-label` and the accessible name fell through to the
 * visible label text alone ("Закрепить" / "Переименовать" /
 * "Удалить" / …). Consequences were invisible:
 *   - "Закрепить" doesn't say WHICH thread.
 *   - "Удалить" doesn't say "necessitates confirmation,
 *     irreversible".
 *   - "Архивировать" doesn't say "hidden from active list".
 *
 * The kebab toggle itself has been carrying a
 * thread-context aria-label since wave 18b; this helper
 * pushes that pattern down into each menu row so SR users
 * who navigate the menu by arrow keys hear the same
 * thread title + the action's specific consequence on every
 * item, not just on the dropdown's parent.
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

export type ThreadMenuAction =
  | "pin"
  | "unpin"
  | "rename"
  | "archive"
  | "restore"
  | "export-markdown"
  | "export-json"
  | "delete";

interface Args {
  action: unknown;
  title: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

function safeAction(a: unknown): ThreadMenuAction | null {
  switch (a) {
    case "pin":
    case "unpin":
    case "rename":
    case "archive":
    case "restore":
    case "export-markdown":
    case "export-json":
    case "delete":
      return a;
    default:
      return null;
  }
}

function fallbackTitle(lang: Lang): string {
  return lang === "kz" ? "сұхбат" : "беседа";
}

export function threadRailMenuItemAriaLabel({
  action,
  title,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const act = safeAction(action);
  if (act === null) return "";
  const t = safeStr(title);
  const ref = t.length > 0 ? `«${t}»` : fallbackTitle(safeL);

  if (safeL === "kz") {
    switch (act) {
      case "pin":
        return `${ref} сұхбатын тізім басына бекіту`;
      case "unpin":
        return `${ref} сұхбатын бекітуден алу`;
      case "rename":
        return `${ref} сұхбатының атауын өзгерту`;
      case "archive":
        return `${ref} сұхбатын мұрағатқа жіберу, белсенді тізімнен жасырылады`;
      case "restore":
        return `${ref} сұхбатын мұрағаттан қалпына келтіру`;
      case "export-markdown":
        return `${ref} сұхбатын Markdown форматында экспорттау`;
      case "export-json":
        return `${ref} сұхбатын JSON форматында экспорттау`;
      case "delete":
        return `${ref} сұхбатын жою, әрекет қайтарылмайды`;
    }
  }

  // ru
  switch (act) {
    case "pin":
      return `Закрепить ${ref} в начале списка`;
    case "unpin":
      return `Открепить ${ref}`;
    case "rename":
      return `Переименовать ${ref}`;
    case "archive":
      return `Архивировать ${ref}, скрыть из активного списка`;
    case "restore":
      return `Восстановить ${ref} из архива`;
    case "export-markdown":
      return `Экспортировать ${ref} в Markdown`;
    case "export-json":
      return `Экспортировать ${ref} в JSON`;
    case "delete":
      return `Удалить ${ref}, действие необратимо`;
  }
}
