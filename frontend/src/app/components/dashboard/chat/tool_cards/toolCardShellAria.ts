/**
 * s35 wave 28a (2026-04-28) — pure helpers for ToolCardShell
 * heading semantics.
 *
 * Pre-wave the ToolCardShell rendered the title as a styled
 * `<span>` inside an unlabeled `<div>`. The body lived in a
 * separate `<div>`. SR users got no programmatic relationship
 * between the title and the body content, so card landmarks
 * were invisible to heading-by-heading navigation.
 *
 * Fix:
 *   (1) Promote the title to an actual heading element. Keeps
 *       the visual styling but adds outline contribution.
 *   (2) Generate a stable id so the body region can claim
 *       `aria-labelledby` against the title id, giving SR
 *       users a real labelled landmark per card.
 *
 * `toolCardHeadingId` derives a stable, slug-like id from the
 * card's title text. We avoid per-mount uuid because two cards
 * with identical titles is rare in practice, and a slug-based
 * id keeps Playwright recon trivial. The function is fully
 * defensive against null/undefined/non-string inputs.
 *
 * Pure: no DOM, no React, no Intl.
 */

const FALLBACK_ID = "tool-card";

/** Pure helper — derive a stable id from an arbitrary title
 *  string. Strips non-word chars, lowercases, collapses dashes,
 *  and prefixes `tool-card-`. */
export function toolCardHeadingId(title: unknown): string {
  if (typeof title !== "string") return FALLBACK_ID;
  const trimmed = title.trim();
  if (trimmed.length === 0) return FALLBACK_ID;
  const slug = trimmed
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (slug.length === 0) return FALLBACK_ID;
  return `tool-card-${slug}`;
}
