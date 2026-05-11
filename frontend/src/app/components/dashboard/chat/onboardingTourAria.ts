/**
 * s35 wave 27b (2026-04-28) — pure helper for OnboardingTour
 * popover aria.
 *
 * Three problems on the live tour:
 *
 *   (1) Dialog has `aria-modal="false"`. That's intentional (it
 *       does NOT trap focus — boss called this out earlier as
 *       deferred). But the dialog should still announce its
 *       step position so SR users know they're "step 2 of 5",
 *       not just floating in space. We add a count-aware
 *       aria-label on the dialog itself for redundant context.
 *
 *   (2) The "Skip" button reads as the bare verb. SR users
 *       don't know skipping ENDS the tour entirely (it sets
 *       isOnboardingDone, the tour will not return). We add a
 *       consequence-aware aria-label "Пропустить вступление —
 *       больше не показывать".
 *
 *   (3) The "Next" / "Поехали" button on intermediate steps
 *       reads as bare "Дальше". On the LAST step the same
 *       button changes to "Поехали" (finish). SR users on the
 *       middle steps deserve the count cue ("2 из 5"); on the
 *       last step they need to know clicking ENDS the tour and
 *       opens the chat for real work.
 *
 * All four helpers are pure and Intl-free, with defensive
 * coercion for non-finite step / total inputs.
 */

export type OnboardingTourLang = "ru" | "kz";

function safeStep(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(1, Math.floor(n));
  }
  return 1;
}

function safeTotal(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(1, Math.floor(n));
  }
  return 1;
}

/** Pure helper — dialog-level aria-label. Names the role
 *  ("Вступительный обзор") and surfaces the current step. */
export function onboardingDialogAriaLabel(args: {
  step: number | null | undefined;
  total: number | null | undefined;
  lang: OnboardingTourLang;
}): string {
  const langSafe: OnboardingTourLang = args.lang === "kz" ? "kz" : "ru";
  const cur = safeStep(args.step);
  const tot = safeTotal(args.total);
  // Clamp current to total so out-of-bounds never reads nonsense.
  const c = Math.min(cur, tot);

  if (langSafe === "kz") {
    return `Кіріспе шолу, ${c}-қадам, барлығы ${tot}`;
  }
  return `Вступительный обзор, шаг ${c} из ${tot}`;
}

/** Pure helper — "Skip" button consequence-aware aria-label. */
export function onboardingSkipAriaLabel(lang: OnboardingTourLang): string {
  const langSafe: OnboardingTourLang = lang === "kz" ? "kz" : "ru";
  if (langSafe === "kz") {
    return "Кіріспені өткізіп жіберу — қайтадан көрсетпеу";
  }
  return "Пропустить вступление — больше не показывать";
}

/** Pure helper — "Next" / "Finish" button aria-label. On
 *  intermediate steps the label appends the step counter so SR
 *  users hear "Перейти к шагу 3 из 5". On the last step it
 *  switches to a finish-consequence sentence. */
export function onboardingAdvanceAriaLabel(args: {
  step: number | null | undefined;
  total: number | null | undefined;
  lang: OnboardingTourLang;
}): string {
  const langSafe: OnboardingTourLang = args.lang === "kz" ? "kz" : "ru";
  const cur = safeStep(args.step);
  const tot = safeTotal(args.total);
  const c = Math.min(cur, tot);
  const isLast = c >= tot;

  if (langSafe === "kz") {
    if (isLast) {
      return "Кіріспені аяқтау және чатты бастау";
    }
    const next = c + 1;
    return `Келесі қадамға өту: ${next}-қадам, барлығы ${tot}`;
  }

  if (isLast) {
    return "Завершить вступление и начать чат";
  }
  const next = c + 1;
  return `Перейти к шагу ${next} из ${tot}`;
}
