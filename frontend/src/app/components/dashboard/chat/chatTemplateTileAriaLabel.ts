/**
 * s35 wave 16b (2026-04-28) — pure aria-label builder for the
 * empty-state ChatTemplates tiles.
 *
 * Today the tile button uses `aria-label={label}` where `label` is
 * just the short i18n title ("Сравнить мин. баллы", "Объясни
 * ошибку", ...). SR users hear the title but get no preview of the
 * actual personalised prompt that will be inserted into the
 * composer when the tile is activated. The visible `title=` carries
 * the full prompt, but `title` is mouse-hover only, not announced
 * by AT.
 *
 * This helper composes a richer label:
 *   "Сравнить мин. баллы. Подсказка: <prompt preview>"
 * where the preview is codepoint-truncated at 140 cp (single
 * ellipsis, surrogate-safe). KZ uses "Кеңес: " for the prompt
 * suffix.
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * whitespace / NaN. The slashCommandPreview helper from wave 14a is
 * intentionally NOT reused — that one uses 180 cp + collapses
 * whitespace runs to single spaces, which is correct for slash
 * prompts (always single-line snippets) but the tile prompts are
 * multi-line bodies where the first sentence is the load-bearing
 * preview.
 */

export type ChatTemplateTileLang = "ru" | "kz";

export interface ChatTemplateTileAriaArgs {
  /** Short tile title (already localised). Required — falls back
   *  to a generic "Шаблон" / "Үлгі" if null/empty. */
  title: string | null | undefined;
  /** Personalised prompt body that will be injected into the
   *  composer on click. Optional — if absent / whitespace, the
   *  helper returns just the title (no "Подсказка:" suffix). */
  prompt?: string | null;
  lang: ChatTemplateTileLang;
}

const PROMPT_PREVIEW_MAX_LENGTH = 140;

/** Internal — codepoint-truncate a tile prompt for the aria.
 *  Surrogate-safe via Array.from. Collapses any internal whitespace
 *  runs (incl. newlines) to a single space so the SR reads it as
 *  one continuous phrase. */
function tilePromptPreview(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "";
  const codepoints = Array.from(trimmed);
  if (codepoints.length <= PROMPT_PREVIEW_MAX_LENGTH) return trimmed;
  const head = codepoints
    .slice(0, PROMPT_PREVIEW_MAX_LENGTH - 1)
    .join("")
    .replace(/\s+$/u, "");
  return head + "…";
}

/** Pure helper — full aria-label for the tile button. */
export function chatTemplateTileAriaLabel(
  args: ChatTemplateTileAriaArgs,
): string {
  const langSafe: ChatTemplateTileLang = args.lang === "kz" ? "kz" : "ru";
  const fallback = langSafe === "kz" ? "Үлгі" : "Шаблон";
  const titleSafe =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.trim()
      : fallback;
  const promptSafe =
    typeof args.prompt === "string" ? tilePromptPreview(args.prompt) : "";
  if (promptSafe.length === 0) return titleSafe;
  const hint = langSafe === "kz" ? "Кеңес" : "Подсказка";
  // Title gets a closing period only if it doesn't already end in
  // punctuation — keeps SR cadence natural.
  const punct = /[.!?…]$/u.test(titleSafe) ? "" : ".";
  return `${titleSafe}${punct} ${hint}: ${promptSafe}`;
}

export const CHAT_TEMPLATE_TILE_PREVIEW_MAX_LENGTH = PROMPT_PREVIEW_MAX_LENGTH;
