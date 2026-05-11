/**
 * s35 wave 53 (2026-04-28) — onboarding tour telemetry.
 *
 * Adds the four lifecycle events the B3 onboarding tour was always
 * meant to emit but never did (s33 shipped the UX without
 * telemetry — boss verbal note: "we'll add tracking later"). The
 * events let us measure tour uptake / drop-off without a single
 * additional roundtrip:
 *
 *   onboarding_step_shown     — fires on each step's first paint.
 *                               `step_id`, `step_index`, `total_steps`.
 *   onboarding_advanced       — Next click. Same payload as shown
 *                               plus `from_step_id` / `to_step_id`.
 *   onboarding_skipped        — Skip click OR backdrop click OR Esc.
 *                               Carries the step_id the user bailed
 *                               on so we can see which step is the
 *                               most common drop-off.
 *   onboarding_completed      — Finish click on the last step.
 *
 * Pure helpers `buildAdvancedEvent`, `buildSkippedReason` are
 * exported for vitest pinning. The thin event-emit functions wrap
 * the existing `track()` surface and are typed with discriminated
 * unions so consumer typos surface at compile time.
 *
 * Event names follow the existing snake_case telemetry contract
 * (`chat_template_clicked`, `chat_citation_clicked`, etc.) prefixed
 * with the surface name.
 */

import { track } from "../../../lib/telemetry";

/** Reason payload for the `onboarding_skipped` event. The
 *  three vectors map 1:1 to the three exit paths in OnboardingTour. */
export type OnboardingSkipReason = "skip_button" | "backdrop" | "escape";

/** Common payload shared by step-related events. */
interface StepCtx {
  step_id: string;
  step_index: number; // zero-based — matches the component's stepIdx
  total_steps: number;
}

interface AdvancedProps extends StepCtx {
  from_step_id: string;
  to_step_id: string;
  to_step_index: number;
  finished: boolean; // true when the advance crosses the final step
}

interface SkippedProps extends StepCtx {
  reason: OnboardingSkipReason;
}

/** Pure helper — assemble the `onboarding_advanced` event payload
 *  from the (current step, next step) pair. Exported for vitest. */
export function buildAdvancedEvent(args: {
  current: { id: string; index: number };
  next: { id: string; index: number } | null;
  totalSteps: number;
}): AdvancedProps {
  const { current, next, totalSteps } = args;
  const finished = next === null;
  return {
    step_id: current.id,
    step_index: current.index,
    total_steps: totalSteps,
    from_step_id: current.id,
    // When we're at the final step, the "to" reflects the same step
    // (there's no further step to land on) but `finished: true`
    // disambiguates. Keeps the payload shape stable for the dashboard.
    to_step_id: next ? next.id : current.id,
    to_step_index: next ? next.index : current.index,
    finished,
  };
}

/** Pure helper — clamp the skip-reason vector to the canonical
 *  three values. Defensive against future call-sites passing a
 *  bare string. Exported for vitest. */
export function buildSkippedReason(
  raw: string | null | undefined,
): OnboardingSkipReason {
  if (raw === "skip_button" || raw === "backdrop" || raw === "escape") {
    return raw;
  }
  // Default to skip_button — the most-common path historically.
  return "skip_button";
}

/** Fire when a tour step first becomes visible to the user.
 *  Idempotent at the call-site: the consumer should fire this
 *  exactly once per step transition (not on every coord recompute). */
export function trackOnboardingStepShown(props: StepCtx): void {
  track("onboarding_step_shown", props);
}

/** Fire on the user's "Next" / "Finish" click. */
export function trackOnboardingAdvanced(props: AdvancedProps): void {
  track("onboarding_advanced", props);
}

/** Fire on Skip-button click, backdrop click, or Escape press. */
export function trackOnboardingSkipped(props: SkippedProps): void {
  track("onboarding_skipped", props);
}

/** Fire when the user lands the final-step "Finish" click. The
 *  emit happens AFTER `markOnboardingDone()` so the funnel matches
 *  reality (a stuck-on-completion user wouldn't fire this even if
 *  they reach the last step in the DOM). */
export function trackOnboardingCompleted(props: StepCtx): void {
  track("onboarding_completed", props);
}
