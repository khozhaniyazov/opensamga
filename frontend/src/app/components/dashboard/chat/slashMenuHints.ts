/**
 * s35 wave 13 (2026-04-28) — slash menu keyboard hints footer.
 *
 * The slash menu (s31 / F1) supports keyboard nav (Up/Down/Home/End,
 * Enter/Tab to select, Esc to dismiss) but has never advertised it.
 * Power users find this by trial; novice users miss it entirely and
 * either click each row with the mouse OR abandon the menu and type
 * the prompt by hand. A small fixed footer at the bottom of the
 * popover that lists the active key bindings turns the menu into a
 * self-documenting affordance — the same pattern Claude / VS Code /
 * Slack use on their own command palettes.
 *
 * This module owns the pure formatting so vitest can pin the bindings
 * + bilingual copy without a renderer. The component (SlashMenuPopover)
 * imports `slashMenuHintItems` and renders them as <kbd>+text rows in
 * a non-interactive footer.
 *
 * Contract:
 *   - `slashMenuHintItems(lang)` returns the canonical 3-item list.
 *   - Each item has `keys: string[]` (rendered as <kbd> chips with the
 *     literal characters) plus `label: string` (the action description
 *     in the active language).
 *   - The list reads as "navigate", "select", "dismiss", "recall"
 *     in fixed order so SR users hear the same reading order across
 *     locales. Originally 3 rows; s35 wave 20a added the Cmd/Ctrl+/
 *     recall row (wired to `slashShortcutMatch.ts`'s shortcut from
 *     wave 17a). The footer container already uses `flex-wrap`, so
 *     the 4th chip wraps to a second line on narrow viewports
 *     instead of pushing the popover off-screen — vetted on the
 *     iOS Safari composer width baseline (320px).
 */

export interface SlashMenuHint {
  /** Display strings for the key chip(s). Empty array forbidden;
   *  multi-key combos use one entry per key (rendered with " / " or
   *  "·" separators by the component, not here). */
  keys: string[];
  /** Localised description of what the keys do. */
  label: string;
}

/** Pure helper — returns the canonical hint list. The order is fixed
 *  (navigate → select → dismiss → recall) so screen-reader users hear
 *  the same reading order regardless of language. The recall row uses
 *  the platform-aware "Ctrl / ⌘" two-chip format so the same hint
 *  serves both Windows/Linux and macOS without a runtime UA sniff. */
export function slashMenuHintItems(lang: "ru" | "kz"): SlashMenuHint[] {
  if (lang === "kz") {
    return [
      { keys: ["↑", "↓"], label: "тізім бойынша жылжу" },
      { keys: ["Enter"], label: "таңдау" },
      { keys: ["Esc"], label: "жабу" },
      { keys: ["Ctrl / ⌘", "/"], label: "пәрмендер мәзірін шақыру" },
    ];
  }
  return [
    { keys: ["↑", "↓"], label: "перейти по списку" },
    { keys: ["Enter"], label: "выбрать" },
    { keys: ["Esc"], label: "закрыть" },
    { keys: ["Ctrl / ⌘", "/"], label: "вызвать меню команд" },
  ];
}

/** Pure helper — flatten one hint row into the screen-reader text the
 *  component sets on aria-label for the chip group. We do this here
 *  (not inline) so vitest can pin the format ("↑ ↓: перейти по списку")
 *  and changes to the visual separator can't drift the SR copy. */
export function slashMenuHintAriaLabel(hint: SlashMenuHint): string {
  return `${hint.keys.join(" ")}: ${hint.label}`;
}
