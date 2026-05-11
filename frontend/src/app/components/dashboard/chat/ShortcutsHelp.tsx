/**
 * Phase C (s22): keyboard-shortcuts help overlay.
 *
 * Surfaces the chat shortcuts we've shipped this session (Enter /
 * Shift+Enter / Escape) plus the "?" that opens this panel. Lives in
 * its own component so ChatPage can wire it without bloating the
 * orchestrator, and so we can ship it behind an optional prop in
 * tests/storybook without rendering the real overlay.
 *
 * UX choices:
 *   - Same modal shell as ClearConfirmModal: role="dialog", aria-modal,
 *     Escape cancels, backdrop click cancels, inner clicks don't
 *     propagate. This keeps ChatComposer's autofocus guard happy.
 *   - Keyboard chips use monospace font + subtle border so the binding
 *     reads as a key label, not as prose.
 *   - Localized via `LanguageContext` under the `chat.shortcuts.*`
 *     namespace.
 *
 * Parent contract: render at the page level, pass `open` +
 * `onClose`. The "?" global listener lives in ChatPage (uses
 * `shouldOpenShortcutsHelp` from `./shortcutGate.ts`).
 */

import { useRef } from "react";
import { Keyboard } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useFocusTrap } from "./focusTrap";
import { HighContrastToggle } from "./HighContrastToggle";
import { ReducedMotionToggle } from "./ReducedMotionToggle";
import { TAP_TARGET_ROW_CLASS } from "./tapTarget";
import {
  SHORTCUTS_HELP_DESCRIPTION_ID,
  shortcutsHelpDescription,
} from "./shortcutsHelpAria";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Row {
  keys: string[];
  label: string;
}

export function ShortcutsHelp({ open, onClose }: Props) {
  const { t, lang } = useLang();
  const dialogRef = useRef<HTMLDivElement>(null);

  // s32 (H2): focus trap + Escape handler. The "Close" button's
  // existing autoFocus stays in place for initial focus.
  useFocusTrap(dialogRef, open, { onEscape: onClose });

  if (!open) return null;

  const rows: Row[] = [
    {
      keys: ["Enter"],
      label:
        t("chat.shortcuts.send") ||
        (lang === "kz" ? "Хабарламаны жіберу" : "Отправить сообщение"),
    },
    {
      keys: ["Shift", "Enter"],
      label:
        t("chat.shortcuts.newline") ||
        (lang === "kz" ? "Жаңа жол" : "Перенос строки"),
    },
    {
      keys: ["Esc"],
      label:
        t("chat.shortcuts.escape") ||
        (lang === "kz"
          ? "Жауапты тоқтату / модалды жабу"
          : "Остановить ответ / закрыть окно"),
    },
    {
      keys: ["?"],
      label:
        t("chat.shortcuts.help") ||
        (lang === "kz"
          ? "Пернетақта қысқартуларын көрсету"
          : "Показать горячие клавиши"),
    },
  ];

  const titleId = "shortcuts-help-title";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // s35 wave 25b (2026-04-28): bind a sr-only description so SR
      // users hear the shortcut count and how to dismiss the modal,
      // not just the bare title.
      aria-describedby={SHORTCUTS_HELP_DESCRIPTION_ID}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Keyboard size={16} className="text-amber-600" aria-hidden="true" />
          <h3
            id={titleId}
            className="text-zinc-900"
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            {t("chat.shortcuts.title") ||
              (lang === "kz" ? "Пернетақта қысқартулары" : "Горячие клавиши")}
          </h3>
        </div>
        {/* s35 wave 25b: sr-only description, count-aware. Visible
            chrome unchanged. */}
        <p id={SHORTCUTS_HELP_DESCRIPTION_ID} className="sr-only">
          {shortcutsHelpDescription({
            shortcutCount: rows.length,
            lang: lang === "kz" ? "kz" : "ru",
          })}
        </p>
        <ul className="space-y-2" style={{ fontSize: 13 }}>
          {rows.map((row) => (
            <li
              key={row.label}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-zinc-700 truncate">{row.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {row.keys.map((k, i) => (
                  <span
                    key={`${row.label}-${k}-${i}`}
                    className="flex items-center gap-1"
                  >
                    <kbd
                      className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-zinc-200 bg-zinc-50 text-zinc-700 font-mono"
                      style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}
                    >
                      {k}
                    </kbd>
                    {i < row.keys.length - 1 && (
                      <span className="text-zinc-500" style={{ fontSize: 11 }}>
                        +
                      </span>
                    )}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-3 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* s33 (H4, 2026-04-28): high-contrast toggle lives in
                the shortcuts overlay so users discover it from the
                same Q&A surface where they look for keyboard help. */}
            <HighContrastToggle />
            {/* s34 wave 11 (G6, 2026-04-28): reduced-motion toggle
                lives next to the contrast control — same a11y bucket,
                same surface, same cycle pattern. */}
            <ReducedMotionToggle />
          </div>
          {/* s34 wave 3 (G5 wave 2): footer Close gets the row-min
              floor so touch users have an AAA hit area. */}
          <button
            onClick={onClose}
            autoFocus
            className={`inline-flex items-center justify-center ${TAP_TARGET_ROW_CLASS} px-4 py-2 rounded-md text-zinc-600 hover:bg-zinc-50`}
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {t("chat.shortcuts.close") || (lang === "kz" ? "Жабу" : "Закрыть")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsHelp;
