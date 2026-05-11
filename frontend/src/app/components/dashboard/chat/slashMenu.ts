/**
 * s31 (F1, 2026-04-27) — slash-command menu pure helpers.
 *
 * The composer surfaces a popover when the user starts typing `/`
 * at the beginning of the textarea (no leading whitespace, no
 * other text). The popover shows the ChatTemplates entries (B1)
 * filtered by the substring after `/`; selecting one replaces the
 * textarea content with the corresponding prompt via
 * `MessagesContext.seedComposer`.
 *
 * This module owns the data + math (predicates, query extraction,
 * filter, command list) so vitest can pin the contract without a
 * renderer. The component (SlashMenu.tsx) is a thin shell that
 * reads them and renders a positioned <ul role="menu">.
 *
 * The command set DELIBERATELY mirrors ChatTemplates (B1) so we
 * have one source of truth for "click-and-prefill" prompts. New
 * templates that ship for B1 should be appended here as well — the
 * vitest pin on `SLASH_COMMANDS.length` will fail loudly if the two
 * lists drift.
 */

import {
  AlertTriangle,
  BookmarkPlus,
  CalendarClock,
  ClipboardList,
  Crosshair,
  FileText,
  GitCompare,
  Scale,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Slash-command kinds.
 *  - `prompt` (default): selecting the row seeds the composer with
 *    the resolved `promptKey` text.
 *  - `picker`: selecting the row opens a downstream picker modal
 *    instead. The composer keeps its current draft prose; the picker
 *    will inject a structured envelope on confirm.
 */
export type SlashCommandKind = "prompt" | "picker";

export interface SlashCommand {
  /** Stable id — matches ChatTemplates ids so analytics line up. */
  id: string;
  icon: LucideIcon;
  /** i18n key for the short label (reuses ChatTemplates copy). */
  titleKey: string;
  /** i18n key for the prompt body (reuses ChatTemplates copy). */
  promptKey: string;
  /** Optional. When `kind: "picker"` the consumer should open a
   *  picker modal on selection rather than seed the composer. */
  kind?: SlashCommandKind;
}

/** Canonical command list.
 *
 *  The first seven rows mirror ChatTemplates' TEMPLATES array so the
 *  empty-state tiles and the slash menu surface the same set. Newer
 *  commands beyond row 7 are slash-only (no tile) when they only make
 *  sense mid-conversation — see the s35 wave C1 `/eli11` row below.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "compare_scores",
    icon: Scale,
    titleKey: "chat.templates.compare_scores.title",
    promptKey: "chat.templates.compare_scores.prompt",
  },
  {
    id: "explain_mistake",
    icon: AlertTriangle,
    titleKey: "chat.templates.explain_mistake.title",
    promptKey: "chat.templates.explain_mistake.prompt",
  },
  {
    id: "plan_week",
    icon: CalendarClock,
    titleKey: "chat.templates.plan_week.title",
    promptKey: "chat.templates.plan_week.prompt",
  },
  {
    id: "prep_plan",
    icon: ClipboardList,
    titleKey: "chat.templates.prep_plan.title",
    promptKey: "chat.templates.prep_plan.prompt",
  },
  {
    id: "compare_unis",
    icon: GitCompare,
    titleKey: "chat.templates.compare_unis.title",
    promptKey: "chat.templates.compare_unis.prompt",
  },
  {
    id: "drill_weak",
    icon: Crosshair,
    titleKey: "chat.templates.drill_weak.title",
    promptKey: "chat.templates.drill_weak.prompt",
  },
  {
    id: "summarize_pdf",
    icon: FileText,
    titleKey: "chat.templates.summarize_pdf.title",
    promptKey: "chat.templates.summarize_pdf.prompt",
  },
  // s35 wave C1 (2026-04-28): UNT-specific "explain like I'm 11" /
  // simplify-the-previous-answer command. Slash-only — no tile, since
  // it depends on a prior assistant turn to act on. The id deliberately
  // mirrors `/eli11` so substring matching against the slash query
  // ("eli", "11", "11кл") all hit it.
  {
    id: "eli11",
    icon: Sparkles,
    titleKey: "chat.templates.eli11.title",
    promptKey: "chat.templates.eli11.prompt",
  },
  // s35 wave 40 (F6 picker, 2026-04-28): /cite opens the
  // CitePagePicker modal instead of seeding the composer with prompt
  // copy. The picker emits a `samga.cite` fenced JSON envelope (see
  // citeAPage.ts) that the agent loop's prompt parser treats as an
  // authoritative consult_library hint. Slash-only — no empty-state
  // tile, since the action only makes sense after the user already
  // knows the textbook + page they want grounded.
  {
    id: "cite",
    icon: BookmarkPlus,
    titleKey: "chat.templates.cite.title",
    promptKey: "chat.templates.cite.prompt",
    kind: "picker",
  },
];

/** True iff `input` is a slash-command query. We intentionally keep
 *  the rule strict: must start with literal `/`, must NOT contain a
 *  space before the next character (so a normal "/usr/bin/..." prose
 *  reference doesn't pop the menu), and must not be a stand-alone
 *  `//` (looks like a comment marker, not a command). */
export function shouldShowSlashMenu(input: string): boolean {
  if (typeof input !== "string") return false;
  if (input.length === 0) return false;
  if (input[0] !== "/") return false;
  // After-slash content cannot start with whitespace; also block the
  // double-slash sequence to keep "//" as escape-the-menu UX.
  const after = input.slice(1);
  if (
    after.startsWith(" ") ||
    after.startsWith("\t") ||
    after.startsWith("/")
  ) {
    return false;
  }
  return true;
}

/** Returns the text after the leading `/` so the filter helper can
 *  match against it. Returns "" if `shouldShowSlashMenu` is false. */
export function slashMenuQuery(input: string): string {
  if (!shouldShowSlashMenu(input)) return "";
  return input.slice(1);
}

/** Filter command list by query — case-insensitive substring match
 *  on either the id or the title (the consumer passes a translated
 *  title via the `titleResolver` callback so the filter respects the
 *  active language). Empty query returns the full list. */
export function filterSlashCommands(
  query: string,
  commands: SlashCommand[],
  titleResolver: (cmd: SlashCommand) => string,
): SlashCommand[] {
  if (!query) return commands.slice();
  const q = query.toLowerCase();
  return commands.filter((cmd) => {
    if (cmd.id.toLowerCase().includes(q)) return true;
    const title = titleResolver(cmd);
    return typeof title === "string" && title.toLowerCase().includes(q);
  });
}

/** Wrap an active index inside the visible filter result. Used by
 *  the keyboard arrow navigation. Returns 0 when the list is empty
 *  so the consumer never has to defend against a stray -1. */
export function clampMenuIndex(idx: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  if (!Number.isFinite(idx)) return 0;
  return ((idx % length) + length) % length;
}
