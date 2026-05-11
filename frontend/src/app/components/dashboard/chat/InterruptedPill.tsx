/**
 * s30 (D4, 2026-04-27) — InterruptedPill.
 *
 * Slate pill below an assistant bubble whose stream was cut short by
 * the user pressing "Stop" in the composer. Sibling to RedactionPill,
 * SourcesDrawer, FailedToolPill, GeneralKnowledgePill — all stamped
 * after the bubble's prose so they don't interrupt reading flow.
 *
 * Why it exists: today, when the user stops mid-stream, the partial
 * text stays put but there's NO visible affordance distinguishing it
 * from a complete answer. The user can re-read in a week and assume
 * the truncated reply was the model's actual best effort. The pill
 * makes "this was cut short on your request" legible.
 *
 * Trigger: `useSendMessage` flips `Message.wasInterrupted = true` when
 * `stoppedRef.current` is observed mid-stream AND the bubble has
 * already received at least some text (empty cancels fall through to
 * the existing isError path instead).
 *
 * Pure helper `shouldShowInterruptedPill` exported for vitest.
 */

import { Pause } from "lucide-react";
import { useLang } from "../../LanguageContext";

interface Props {
  wasInterrupted?: boolean | null;
}

/** Pure predicate — exported for vitest. Renders only on a true flag. */
export function shouldShowInterruptedPill(
  wasInterrupted?: boolean | null,
): boolean {
  return wasInterrupted === true;
}

/** Pure label helper — bilingual. Exported for vitest. */
export function interruptedPillLabel(lang: "ru" | "kz"): string {
  return lang === "kz"
    ? "Жауап үзілді — өзіңіз тоқтаттыңыз"
    : "Ответ прерван — вы остановили генерацию";
}

export function InterruptedPill({ wasInterrupted }: Props) {
  const { lang } = useLang();
  if (!shouldShowInterruptedPill(wasInterrupted)) return null;
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  return (
    <div
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 samga-anim-pill"
      role="note"
    >
      <Pause className="h-3 w-3" aria-hidden="true" />
      <span>{interruptedPillLabel(langSafe)}</span>
    </div>
  );
}

export default InterruptedPill;
