/**
 * Phase B (s21, 2026-04-22): confirmation modal for "Clear chat".
 * Trivial component — extracted so it can be tested in isolation and
 * so the orchestrator is not carrying the RU/KZ copy.
 *
 * Phase C (s22): keyboard + backdrop dismissal.
 *   - Escape cancels the destructive action (parity with native
 *     confirm() and every other modal in the product).
 *   - Clicking the dimmed backdrop cancels too; clicking inside the
 *     dialog does NOT propagate to the backdrop handler.
 *   - Focus is moved to the non-destructive "Cancel" button on open
 *     so accidental Enter-key presses on a focused send button don't
 *     nuke the thread (destructive-safe default).
 *   - role="dialog" + aria-modal + aria-labelledby so assistive tech
 *     announces the dialog correctly and ChatComposer's autofocus
 *     guard doesn't steal focus while this is open.
 */

import { useEffect, useRef } from "react";
import { useLang } from "../../LanguageContext";
import { useFocusTrap } from "./focusTrap";
import {
  CLEAR_CONFIRM_DESCRIPTION_ID,
  clearConfirmCancelAriaLabel,
  clearConfirmDestructiveAriaLabel,
} from "./clearConfirmDialogAria";

interface ClearConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ClearConfirmModal({
  open,
  onCancel,
  onConfirm,
}: ClearConfirmModalProps) {
  const { lang } = useLang();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // s32 (H2, 2026-04-27): proper focus trap. Tab/Shift+Tab cycle
  // within the dialog so a keyboard user can't accidentally tab
  // through to the Send button while "Clear chat?" is open and
  // commit a destructive action. Escape still cancels (handled by
  // the trap's onEscape so we don't double-listen).
  useFocusTrap(dialogRef, open, { onEscape: onCancel });

  // Initial-focus on Cancel — destructive-safe default. The trap
  // doesn't auto-focus on open by design (consumer's choice), so
  // this stays here.
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const titleId = "clear-confirm-title";
  // s35 wave 22b (2026-04-28): aria wiring. SR users tabbing
  // straight from the dialog opener to the destructive button used
  // to fire it without ever hearing the consequence sentence —
  // describedby binds the body `<p>` to the dialog so the warning
  // is announced on open, and consequence-aware aria-labels on
  // both buttons spell out what each action actually does.
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const destructiveAria = clearConfirmDestructiveAriaLabel(langSafe);
  const cancelAria = clearConfirmCancelAriaLabel(langSafe);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 samga-anim-modal-scrim samga-anim-scrim-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={CLEAR_CONFIRM_DESCRIPTION_ID}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 samga-anim-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id={titleId}
          className="text-zinc-900 mb-2"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          {lang === "kz" ? "Чатты тазалау?" : "Очистить чат?"}
        </h3>
        <p
          id={CLEAR_CONFIRM_DESCRIPTION_ID}
          className="text-zinc-500 mb-4"
          style={{ fontSize: 13 }}
        >
          {lang === "kz"
            ? "Барлық хабарламалар жойылады. Бұл әрекетті қайтару мүмкін емес."
            : "Все сообщения будут удалены. Это действие нельзя отменить."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            aria-label={cancelAria}
            className="px-3 py-1.5 rounded-md text-zinc-600 hover:bg-zinc-50"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {lang === "kz" ? "Болдырмау" : "Отмена"}
          </button>
          <button
            onClick={() => void onConfirm()}
            aria-label={destructiveAria}
            className="px-3 py-1.5 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {lang === "kz" ? "Тазалау" : "Очистить"}
          </button>
        </div>
      </div>
    </div>
  );
}
