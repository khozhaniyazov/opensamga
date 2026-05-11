/**
 * s35 wave 14a (2026-04-28) — slash menu active-row preview pane.
 *
 * The slash menu lists 7 commands by short title only. Selecting a
 * row instantly seeds the composer with the FULL prompt body, which
 * means students discover the actual prompt text only by selecting
 * (and then either committing or backspacing it out). Power users
 * cope; novice users second-guess each row before clicking.
 *
 * Wave 14a adds a thin preview pane to the popover: the active row's
 * full prompt body, truncated to a manageable single paragraph, is
 * rendered next to or below the list. The user can read the prompt
 * before committing — same affordance Codex / Cursor / Slack use on
 * their command palettes.
 *
 * This module owns the truncation logic so vitest can pin the
 * boundary cases (empty / whitespace / very long / contains newlines /
 * unicode-aware). The component (SlashMenuPopover) reads the active
 * row's promptKey, resolves it through `t()`, hands the resulting
 * string to `slashCommandPreviewText` and renders the result.
 */

/** Default cap for the visible preview. Chosen empirically: prompts in
 *  ChatTemplates run ~60–140 characters; 180 lets every current row
 *  show whole, while a 280+ char row gets the ellipsis. */
export const SLASH_PREVIEW_MAX_LENGTH = 180;

/** Pure helper — collapse multi-line prompt bodies into a single line
 *  + truncate to `maxLength` codepoints with a trailing ellipsis. */
export function slashCommandPreviewText(
  prompt: string | null | undefined,
  maxLength: number = SLASH_PREVIEW_MAX_LENGTH,
): string {
  if (typeof prompt !== "string") return "";
  // Collapse any whitespace run (incl. newlines + tabs) to a single
  // space. The popover renders the preview in one wrapped paragraph,
  // so retaining literal newlines would either widen the popover or
  // produce ragged-right cliff edges.
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  const cap =
    typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0
      ? Math.floor(maxLength)
      : SLASH_PREVIEW_MAX_LENGTH;
  if (collapsed.length <= cap) return collapsed;
  // Use Array.from so we count by codepoints, not UTF-16 code units —
  // a Cyrillic prompt that ends mid-surrogate would render a tofu box.
  const codepoints = Array.from(collapsed);
  if (codepoints.length <= cap) return collapsed;
  // Trim to (cap - 1) codepoints, drop trailing whitespace produced
  // by the truncation, then append a single Unicode ellipsis. Net
  // visible length is exactly `cap` codepoints.
  const head = codepoints
    .slice(0, cap - 1)
    .join("")
    .replace(/\s+$/u, "");
  return head + "…";
}

/** Pure helper — true iff the resolved prompt is non-empty. The
 *  popover uses this to decide whether to render the preview pane at
 *  all (an empty string would otherwise produce an empty bordered
 *  band that looks like a bug). */
export function shouldShowSlashCommandPreview(
  prompt: string | null | undefined,
): boolean {
  if (typeof prompt !== "string") return false;
  return prompt.trim().length > 0;
}
