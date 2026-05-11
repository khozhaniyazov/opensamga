/**
 * v3.10 (F2, 2026-04-30) — attach a textbook page citation as
 * follow-up context.
 *
 * Roadmap row F2: "Attach textbook PDF page as context (deep-link
 * a citation chip back into a turn)". The user is reading an
 * assistant answer with citation chips, sees one they want to dig
 * deeper into, and wants the next message to be GROUNDED in that
 * exact (book, page). Pre-wave they had to type "/cite" + open the
 * picker + find the same book again — clunky. F2 lets them tap
 * "Attach to next question" right inside the chip's hover popover,
 * which seeds the composer with the canonical `samga.cite` fenced
 * envelope (the F6 contract) plus a short prompt prefix.
 *
 * Why no new BE wiring: the agent loop already knows how to read
 * the `samga.cite` fence — F6's contract is the single source of
 * truth. F2 is a UX shortcut that builds the same envelope from a
 * different starting point.
 *
 * Pure: no DOM, no React, no Intl beyond string ops.
 */

import { formatCiteHint, normalizeCitePageHint } from "./citeAPage";

/** Default prompt prefix that seeds the composer below the cite
 *  envelope. The user is expected to edit before sending — this is
 *  a starting point, not an auto-send. RU + KZ. */
export function attachCitationPromptPrefix(lang: unknown): string {
  return lang === "kz"
    ? "Осы беттегі мәтінге сүйеніп жауап беріңіз: "
    : "Опираясь на текст этой страницы, ответь: ";
}

interface BuildArgs {
  bookId: number | null | undefined;
  pageNumber: number | null | undefined;
  bookName?: string | null | undefined;
  /** UI lang. Anything not "kz" treated as "ru". */
  lang?: unknown;
}

/** Build the full seed text (cite envelope + RU/KZ prompt prefix).
 *  Returns null when the citation is unusable (no resolved bookId
 *  or no positive page number). */
export function buildCitationSeed(args: BuildArgs): string | null {
  const safe = normalizeCitePageHint({
    bookId: typeof args.bookId === "number" ? args.bookId : 0,
    pageNumber: typeof args.pageNumber === "number" ? args.pageNumber : 0,
    bookName:
      typeof args.bookName === "string" && args.bookName.trim().length > 0
        ? args.bookName.trim()
        : undefined,
  });
  if (!safe) return null;
  const fenced = formatCiteHint(safe);
  if (!fenced) return null;
  const prefix = attachCitationPromptPrefix(args.lang);
  return fenced + "\n\n" + prefix;
}

/** Aria-label for the "Attach to next question" button inside the
 *  citation chip popover. State-aware — when the citation can't be
 *  resolved we surface that in the label so SR users don't tap a
 *  no-op. */
export function attachButtonAriaLabel({
  bookName,
  pageNumber,
  resolved,
  lang,
}: {
  bookName: unknown;
  pageNumber: unknown;
  /** Whether bookId resolved against the catalogue. False → button
   *  is disabled and the label explains why. */
  resolved: boolean;
  lang: unknown;
}): string {
  const ru = lang !== "kz";
  const safeBook =
    typeof bookName === "string" && bookName.trim().length > 0
      ? bookName.trim()
      : ru
        ? "(без названия)"
        : "(атаусыз)";
  const safePage =
    typeof pageNumber === "number" && Number.isFinite(pageNumber)
      ? Math.max(1, Math.floor(pageNumber))
      : null;
  if (!resolved) {
    return ru
      ? `Невозможно прикрепить — книга «${safeBook}» не найдена в библиотеке`
      : `Тіркеу мүмкін емес — «${safeBook}» кітабы кітапханада табылмады`;
  }
  if (safePage == null) {
    return ru
      ? `Прикрепить страницу из «${safeBook}» как контекст к следующему сообщению`
      : `«${safeBook}» кітабының бетін келесі хабарламаға контекст ретінде тіркеу`;
  }
  return ru
    ? `Прикрепить «${safeBook}», страница ${safePage}, как контекст к следующему сообщению`
    : `«${safeBook}», ${safePage}-бетті келесі хабарламаға контекст ретінде тіркеу`;
}

/** Visible button label (kept short — chrome lives inside the
 *  citation popover footer, not enough room for the full aria
 *  consequence-aware sentence). */
export function attachButtonLabel(lang: unknown): string {
  return lang === "kz" ? "Контекстке тіркеу" : "Прикрепить как контекст";
}
