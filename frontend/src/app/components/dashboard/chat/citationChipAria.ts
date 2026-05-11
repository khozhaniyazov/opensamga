/**
 * s35 wave 31b (2026-04-28) — pure helpers for `CitationChip`
 * accessible names.
 *
 * Pre-wave both render paths of the chip carried only a `title`
 * attribute and the visible "BookOpen icon + bookName · p. N"
 * text — no canonical aria-label. SR users heard the visible
 * text, but lost the "external link, opens in new tab" cue
 * (the visible ExternalLink icon is decorative-only) and lost
 * the "source not found in library" cue on the non-link
 * fallback path.
 *
 * We synthesise two helpers:
 *   - `citationChipLinkAriaLabel({bookName, pageNumber, lang})`
 *     for the live anchor path: "Открыть «BookName», страница
 *     12, в новой вкладке".
 *   - `citationChipMissingAriaLabel({bookName, pageNumber, lang})`
 *     for the non-link span path: "Источник «BookName»,
 *     страница 12, недоступен в библиотеке".
 *   - `citationChipPopoverDialogAriaLabel({bookName,
 *     pageNumber, lang})` — wave 32a addition: replaces the
 *     baked-in English "Preview of BookName, page N" on the
 *     hover popover dialog wrapper with a bilingual cue
 *     ("Превью источника «BookName», страница N").
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  bookName: unknown;
  pageNumber: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeStr(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim();
}

function safePage(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) {
    const v = Math.floor(n);
    if (v >= 1) return v;
  }
  if (typeof n === "string") {
    const p = Number(n);
    if (Number.isFinite(p) && p >= 1) return Math.floor(p);
  }
  return null;
}

export function citationChipLinkAriaLabel({
  bookName,
  pageNumber,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const name = safeStr(bookName);
  const page = safePage(pageNumber);

  if (safeL === "kz") {
    if (name.length === 0 && page == null) {
      return "Дереккөзді жаңа қойындыда ашу";
    }
    if (name.length === 0) {
      return `Дереккөздің ${page}-бетін жаңа қойындыда ашу`;
    }
    if (page == null) {
      return `«${name}» дереккөзін жаңа қойындыда ашу`;
    }
    return `«${name}» дереккөзінің ${page}-бетін жаңа қойындыда ашу`;
  }

  // ru
  if (name.length === 0 && page == null) {
    return "Открыть источник в новой вкладке";
  }
  if (name.length === 0) {
    return `Открыть страницу ${page} источника в новой вкладке`;
  }
  if (page == null) {
    return `Открыть «${name}» в новой вкладке`;
  }
  return `Открыть «${name}», страница ${page}, в новой вкладке`;
}

export function citationChipMissingAriaLabel({
  bookName,
  pageNumber,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const name = safeStr(bookName);
  const page = safePage(pageNumber);

  if (safeL === "kz") {
    if (name.length === 0 && page == null) {
      return "Дереккөз кітапханада жоқ";
    }
    if (name.length === 0) {
      return `Дереккөздің ${page}-беті кітапханада жоқ`;
    }
    if (page == null) {
      return `«${name}» дереккөзі кітапханада жоқ`;
    }
    return `«${name}» дереккөзінің ${page}-беті кітапханада жоқ`;
  }

  // ru
  if (name.length === 0 && page == null) {
    return "Источник недоступен в библиотеке";
  }
  if (name.length === 0) {
    return `Страница ${page} источника недоступна в библиотеке`;
  }
  if (page == null) {
    return `Источник «${name}» недоступен в библиотеке`;
  }
  return `Источник «${name}», страница ${page}, недоступен в библиотеке`;
}

export function citationChipPopoverDialogAriaLabel({
  bookName,
  pageNumber,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const name = safeStr(bookName);
  const page = safePage(pageNumber);

  if (safeL === "kz") {
    if (name.length === 0 && page == null) {
      return "Дереккөздің превьюі";
    }
    if (name.length === 0) {
      return `Дереккөздің ${page}-бетінің превьюі`;
    }
    if (page == null) {
      return `«${name}» дереккөзінің превьюі`;
    }
    return `«${name}» дереккөзінің ${page}-бетінің превьюі`;
  }

  // ru
  if (name.length === 0 && page == null) {
    return "Превью источника";
  }
  if (name.length === 0) {
    return `Превью страницы ${page} источника`;
  }
  if (page == null) {
    return `Превью источника «${name}»`;
  }
  return `Превью источника «${name}», страница ${page}`;
}
