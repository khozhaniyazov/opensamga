/**
 * s33 (B3, 2026-04-28) — first-time onboarding tour component.
 *
 * Renders a sequence of coach-mark popovers anchored to existing
 * UI elements via CSS selectors. State + step copy lives in
 * `onboardingTour.ts`; this file is purely the React surface.
 *
 * Mounted lazily by ChatEmptyState (so it ONLY appears for users
 * landing in the empty state, not mid-conversation). Self-marks
 * done on the last step OR on explicit Skip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../../LanguageContext";
import {
  buildOnboardingSteps,
  isOnboardingDone,
  markOnboardingDone,
  nextOnboardingStep,
  onboardingControlLabels,
  type OnboardingStep,
} from "./onboardingTourState";
import {
  onboardingAdvanceAriaLabel,
  onboardingDialogAriaLabel,
  onboardingSkipAriaLabel,
} from "./onboardingTourAria";
import { shouldDismissOverlayOnKey } from "./dismissibleOverlayKey";
import { rafThrottle } from "./rafThrottle";
import {
  buildAdvancedEvent,
  trackOnboardingAdvanced,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
  trackOnboardingStepShown,
} from "./onboardingTelemetry";

interface Coords {
  top: number;
  left: number;
  arrowSide: "top" | "bottom";
}

const POPOVER_W = 320;
const POPOVER_H_EST = 130;
const VIEWPORT_MARGIN = 12;

function placePopover(targetRect: DOMRect): Coords {
  // Prefer below the target. If we'd overflow viewport bottom, flip
  // above. Center horizontally within viewport bounds.
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  let left = targetRect.left + targetRect.width / 2 - POPOVER_W / 2;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, vw - POPOVER_W - VIEWPORT_MARGIN),
  );
  const wantBelow = targetRect.bottom + 12;
  const wouldOverflow = wantBelow + POPOVER_H_EST > vh - VIEWPORT_MARGIN;
  if (wouldOverflow) {
    return {
      top: Math.max(VIEWPORT_MARGIN, targetRect.top - POPOVER_H_EST - 12),
      left,
      arrowSide: "bottom",
    };
  }
  return { top: wantBelow, left, arrowSide: "top" };
}

export function OnboardingTour() {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const steps = useMemo<OnboardingStep[]>(
    () => buildOnboardingSteps(langSafe),
    [langSafe],
  );
  const labels = useMemo(() => onboardingControlLabels(langSafe), [langSafe]);

  const [active, setActive] = useState<boolean>(false);
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [coords, setCoords] = useState<Coords | null>(null);
  const targetRectRef = useRef<DOMRect | null>(null);

  // Bootstrap: only fire if the user hasn't completed before.
  useEffect(() => {
    if (isOnboardingDone()) return;
    // Defer one tick so the consumer's DOM (composer textarea, etc.)
    // has mounted; we need getBoundingClientRect to return real
    // coords.
    const t = setTimeout(() => setActive(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Compute coords every step + on resize.
  useEffect(() => {
    if (!active) return;
    const step = steps[stepIdx];
    if (!step) return;
    const recompute = () => {
      const node = document.querySelector(step.targetSelector);
      if (!node) {
        setCoords(null);
        return;
      }
      const rect = (node as HTMLElement).getBoundingClientRect();
      targetRectRef.current = rect;
      setCoords(placePopover(rect));
    };
    recompute();
    // s35 wave 52 (2026-04-28): coalesce scroll/resize bursts. The
    // highlight ring tracks a moving target via getBoundingClientRect
    // — every fire forces a layout read + setState. One reading per
    // animation frame is plenty for visual smoothness; sub-frame
    // precision is unobservable.
    const throttled = rafThrottle(recompute);
    window.addEventListener("resize", throttled);
    window.addEventListener("scroll", throttled, true);
    return () => {
      throttled.cancel();
      window.removeEventListener("resize", throttled);
      window.removeEventListener("scroll", throttled, true);
    };
  }, [active, stepIdx, steps]);

  // s35 wave 37 (2026-04-28): Escape skips the tour. The dialog
  // intentionally doesn't trap focus (boss-confirmed UX — skipping
  // shouldn't block the page below), but a keyboard user landing on
  // the autoFocus'd "Next" button still owes an Escape exit; without
  // it the tour soft-traps anyone who can't reach the dimmed
  // backdrop. Pure predicate gates the listener so a stale window
  // listener never fires after `active` flips false. Lives BEFORE
  // the early-return so hook order stays stable.
  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (shouldDismissOverlayOnKey({ key: e.key, active })) {
        e.preventDefault();
        // s35 wave 53 (2026-04-28): emit a skipped/escape event so
        // the funnel records this exit path. Read steps[stepIdx]
        // off the closure — the listener re-binds whenever
        // active/stepIdx changes via the dep on `active` (stepIdx
        // captured below would go stale, so deref via the steps
        // array + the up-to-date stepIdx via a ref pattern would be
        // overkill; the user is exiting the tour right now and we
        // already have the current step in steps[stepIdx]).
        const cur = steps[stepIdx];
        if (cur) {
          trackOnboardingSkipped({
            step_id: cur.id,
            step_index: stepIdx,
            total_steps: steps.length,
            reason: "escape",
          });
        }
        markOnboardingDone();
        setActive(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, stepIdx, steps]);

  // s35 wave 53 (2026-04-28): emit `onboarding_step_shown` whenever
  // a step's coords land for the first time. The two effect deps
  // (active, stepIdx) cover both the bootstrap fire and every Next
  // click. We intentionally skip the fallback-coords path so we
  // don't double-count steps where the spotlight target wasn't
  // mounted yet (the recompute effect retries until coords land).
  useEffect(() => {
    if (!active) return;
    if (!coords) return;
    const step = steps[stepIdx];
    if (!step) return;
    trackOnboardingStepShown({
      step_id: step.id,
      step_index: stepIdx,
      total_steps: steps.length,
    });
    // We only want this to fire once per step landing — `coords`
    // is the gate, deliberately kept out of the dep so subsequent
    // resize-driven coord updates don't re-fire. eslint will
    // complain; that's fine, the gate predicate above is clearer
    // than a separate ref-based "alreadyEmittedFor[stepIdx]"
    // tracker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIdx]);

  if (!active) return null;
  const step = steps[stepIdx];
  if (!step) return null;

  const advance = () => {
    const next = nextOnboardingStep(stepIdx, steps.length);
    const cur = steps[stepIdx];
    if (next < 0) {
      // Funnel emit ordering: ADVANCED with finished:true fires
      // first (so dashboards can compute "users who reached the
      // finish click"), then COMPLETED fires once we've actually
      // marked the tour done.
      if (cur) {
        trackOnboardingAdvanced(
          buildAdvancedEvent({
            current: { id: cur.id, index: stepIdx },
            next: null,
            totalSteps: steps.length,
          }),
        );
      }
      markOnboardingDone();
      if (cur) {
        trackOnboardingCompleted({
          step_id: cur.id,
          step_index: stepIdx,
          total_steps: steps.length,
        });
      }
      setActive(false);
      return;
    }
    const nxt = steps[next];
    if (cur && nxt) {
      trackOnboardingAdvanced(
        buildAdvancedEvent({
          current: { id: cur.id, index: stepIdx },
          next: { id: nxt.id, index: next },
          totalSteps: steps.length,
        }),
      );
    }
    setStepIdx(next);
  };

  const skip = (reason: "skip_button" | "backdrop" = "skip_button") => {
    const cur = steps[stepIdx];
    if (cur) {
      trackOnboardingSkipped({
        step_id: cur.id,
        step_index: stepIdx,
        total_steps: steps.length,
        reason,
      });
    }
    markOnboardingDone();
    setActive(false);
  };

  const isLast = stepIdx + 1 >= steps.length;
  const stepLabel = labels.step(stepIdx + 1, steps.length);

  // If we couldn't place the popover (target not in DOM yet), still
  // show the dialog as a centered modal — the user shouldn't be
  // stranded without a way out.
  const fallback: Coords | null = coords;
  const placement: Coords = fallback ?? {
    top: 80,
    left: Math.max(
      VIEWPORT_MARGIN,
      (typeof window === "undefined" ? 1280 : window.innerWidth) / 2 -
        POPOVER_W / 2,
    ),
    arrowSide: "top",
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Dimmed backdrop. Click skips the tour. */}
      <div
        onClick={() => skip("backdrop")}
        aria-hidden="true"
        className="samga-anim-modal-scrim samga-anim-scrim-blur"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(9, 9, 11, 0.35)",
          zIndex: 60,
        }}
      />
      <div
        role="dialog"
        aria-modal="false"
        // s35 wave 27b (2026-04-28): redundant SR context. The
        // dialog isn't focus-trapping (intentional, matches
        // tour-skips-don't-block-page UX), so AT users who tab
        // out and back need the step counter announced from the
        // dialog itself, not just the small step pill inside.
        aria-label={onboardingDialogAriaLabel({
          step: stepIdx + 1,
          total: steps.length,
          lang: langSafe,
        })}
        aria-labelledby={`onboarding-${step.id}-title`}
        aria-describedby={`onboarding-${step.id}-body`}
        style={{
          position: "fixed",
          top: placement.top,
          left: placement.left,
          width: POPOVER_W,
          zIndex: 61,
        }}
        className="rounded-xl border border-amber-200 bg-white shadow-2xl samga-anim-modal"
      >
        <div className="p-4">
          <div
            className="mb-1 text-amber-700"
            style={{
              fontSize: 10.5,
              fontWeight: 780,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {stepLabel}
          </div>
          <h3
            id={`onboarding-${step.id}-title`}
            className="mb-1.5 text-zinc-950"
            style={{ fontSize: 15, fontWeight: 720, lineHeight: 1.3 }}
          >
            {step.title}
          </h3>
          <p
            id={`onboarding-${step.id}-body`}
            className="text-zinc-700"
            style={{ fontSize: 13, lineHeight: 1.55 }}
          >
            {step.body}
          </p>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5">
          <button
            type="button"
            onClick={() => skip("skip_button")}
            // s35 wave 27b: consequence-aware aria — visible
            // chrome stays "Пропустить" but SR users hear that
            // skipping ends the tour permanently.
            aria-label={onboardingSkipAriaLabel(langSafe)}
            className="text-zinc-500 hover:text-zinc-700"
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            {labels.skip}
          </button>
          <button
            type="button"
            onClick={advance}
            autoFocus
            // s35 wave 27b: count-aware on intermediate steps,
            // finish-consequence on the last step.
            aria-label={onboardingAdvanceAriaLabel({
              step: stepIdx + 1,
              total: steps.length,
              lang: langSafe,
            })}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-white shadow-sm hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300"
            style={{ fontSize: 12.5, fontWeight: 700 }}
          >
            {isLast ? labels.finish : labels.next}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default OnboardingTour;
