/**
 * s31 (F1, 2026-04-27) — SlashMenuPopover.
 *
 * Filename intentionally distinct from `slashMenu.ts` so
 * case-insensitive filesystems (Windows / macOS default) don't
 * collapse the two modules into the same path.
 *
 * Anchored above the composer textarea when the user types `/` as
 * the first character. Pure helpers live in `./slashMenu.ts`; this
 * component is the thin renderer.
 *
 * Behaviour:
 *   - Open when `shouldShowSlashMenu(input)` returns true; the
 *     parent component (ChatComposer) controls visibility by passing
 *     `isOpen`.
 *   - Filtered by the substring after `/`; empty query ⇒ full list.
 *   - Arrow Up/Down/Home/End rotate the active row, Enter / Tab
 *     selects, Escape dismisses (handled by ChatComposer keyboard
 *     handler so we don't fight for the same keydown).
 *   - Click also selects.
 *   - Selecting a row calls `onSelect(cmd)` with the SlashCommand —
 *     the parent then resolves the prompt via i18n + seeds the
 *     composer.
 */

import { useEffect, useRef } from "react";
import { useLang } from "../../LanguageContext";
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  type SlashCommand,
} from "./slashMenu";
import { TAP_TARGET_ROW_CLASS } from "./tapTarget";
import { slashMenuHintItems, slashMenuHintAriaLabel } from "./slashMenuHints";
import {
  slashCommandPreviewText,
  shouldShowSlashCommandPreview,
} from "./slashCommandPreview";

interface Props {
  isOpen: boolean;
  query: string;
  activeIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (idx: number) => void;
}

export function SlashMenuPopover({
  isOpen,
  query,
  activeIndex,
  onSelect,
  onHover,
}: Props) {
  const { t, lang } = useLang();
  const listRef = useRef<HTMLUListElement>(null);
  const hintLang: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  const hints = slashMenuHintItems(hintLang);

  const filtered = filterSlashCommands(query, SLASH_COMMANDS, (cmd) =>
    t(cmd.titleKey),
  );

  // Scroll the active row into view when the active index changes —
  // important for long lists if the filter pushes the row off the
  // visible part of the popover. No-op when the list is short.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelectorAll('[role="menuitem"]')[activeIndex];
    if (node && "scrollIntoView" in node) {
      (node as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, filtered.length]);

  if (!isOpen) return null;
  if (filtered.length === 0) {
    // Show a dim "no matches" row instead of dismissing — keeps the
    // popover position stable while the user backspaces.
    return (
      <div
        // v3.69 (B11, 2026-05-02): stable test hook so E2E tests can
        // query the slash menu without chasing Radix portal selectors
        // (the menu does NOT use Radix, but other chat popovers do —
        // selecting `[data-radix-popper-content-wrapper]` was finding
        // those instead, returning the slash-menu DOM-shaped wrapper
        // with 0 items).
        data-testid="chat-slash-menu"
        data-state="empty"
        className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[13px] text-zinc-500 shadow-lg samga-anim-popover"
        role="status"
      >
        {t("chat.slashMenu.noMatches") || "Нет совпадений"}
      </div>
    );
  }

  return (
    <div
      // v3.69 (B11, 2026-05-02): stable test hook — see above.
      data-testid="chat-slash-menu"
      data-state="open"
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-zinc-200 bg-white shadow-lg samga-anim-popover"
    >
      <ul
        ref={listRef}
        role="menu"
        aria-label={t("chat.slashMenu.label") || "Команды"}
        className="max-h-72 overflow-auto p-1"
        data-testid="chat-slash-menu-list"
      >
        {filtered.map((cmd, idx) => {
          const Icon = cmd.icon;
          const isActive = idx === activeIndex;
          return (
            <li key={cmd.id}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                // v3.69 (B11): per-row test hook. `data-slash-cmd`
                // mirrors the SlashCommand id (e.g. "compare_scores")
                // so E2E tests can scope queries to the slash menu's
                // own DOM tree and skip the Radix portal entirely.
                data-testid="chat-slash-menu-item"
                data-slash-cmd={cmd.id}
                onMouseDown={(e) => {
                  // Use mousedown so the click resolves before the
                  // textarea blurs (a normal click would lose focus
                  // and dismiss the menu before onSelect runs).
                  e.preventDefault();
                  onSelect(cmd);
                }}
                onMouseEnter={() => onHover(idx)}
                // s34 wave 3 (G5 wave 2): row gets the 44px-min-height
                // floor so touch users on the slash menu have an AAA
                // hit area. Visual padding stays at py-2 — the floor
                // only kicks in if the icon+title height drops below
                // 44px (icon-only locales, very short i18n strings).
                className={`flex w-full items-start gap-2 rounded-lg samga-anim-tap-ripple ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-[13px] ${
                  isActive
                    ? "bg-amber-50 text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
                  aria-hidden
                />
                <span className="flex flex-col min-w-0">
                  <span className="font-medium">{t(cmd.titleKey)}</span>
                  <span className="truncate text-[11px] text-zinc-500">
                    /{cmd.id}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(() => {
        // s35 wave 14a: active-row preview pane. Renders the full
        // resolved prompt body (truncated via `slashCommandPreviewText`)
        // for the currently-active row so the user can read what the
        // command will seed BEFORE clicking. Hidden when the prompt
        // resolves to an empty string (defensive — current i18n always
        // has copy, but a missing key would otherwise render an empty
        // bordered band).
        const activeCmd = filtered[activeIndex];
        const promptRaw = activeCmd ? t(activeCmd.promptKey) : "";
        if (!shouldShowSlashCommandPreview(promptRaw)) return null;
        const preview = slashCommandPreviewText(promptRaw);
        return (
          <div
            className="border-t border-zinc-100 bg-zinc-50/60 px-3 py-2 text-[12px] leading-snug text-zinc-600"
            role="note"
            aria-live="polite"
            aria-label={
              hintLang === "kz"
                ? "Команданың алдын-ала қарауы"
                : "Предпросмотр команды"
            }
          >
            {preview}
          </div>
        );
      })()}
      {/* s35 wave 13: keyboard-hints footer. Static, non-interactive,
        sits below the scrollable list. Keeps the popover self-
        documenting for novice users without pushing the menu off-
        screen on mobile (3 short rows, monospace key chips). */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500"
        role="note"
        aria-label={
          hintLang === "kz" ? "Клавиатура көмекшілері" : "Подсказки клавиатуры"
        }
      >
        {hints.map((hint, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1"
            aria-label={slashMenuHintAriaLabel(hint)}
          >
            {hint.keys.map((k, kidx) => (
              <kbd
                key={kidx}
                className="inline-flex h-4 min-w-[18px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[10px] text-zinc-600"
              >
                {k}
              </kbd>
            ))}
            <span className="ml-0.5">{hint.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default SlashMenuPopover;
