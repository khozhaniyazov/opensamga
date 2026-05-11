/**
 * s35 wave 53 (2026-04-28) — onboardingTelemetry pure-helper pins.
 *
 * Pins:
 *   - buildAdvancedEvent shape on intermediate / final-step
 *   - buildSkippedReason canonicalisation + defensive default
 *   - trackOnboarding* event names land in the in-memory buffer
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAdvancedEvent,
  buildSkippedReason,
  trackOnboardingAdvanced,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
  trackOnboardingStepShown,
} from "../onboardingTelemetry";
import { drainBuffer, peekBuffer } from "../../../../lib/telemetry";

beforeEach(() => {
  // Drain anything left over from previous suites — telemetry uses
  // a process-wide singleton buffer.
  drainBuffer();
});

afterEach(() => {
  drainBuffer();
});

describe("buildAdvancedEvent", () => {
  it("emits a finished:false payload when there is a next step", () => {
    const ev = buildAdvancedEvent({
      current: { id: "rail_toggle", index: 0 },
      next: { id: "composer", index: 1 },
      totalSteps: 3,
    });
    expect(ev).toEqual({
      step_id: "rail_toggle",
      step_index: 0,
      total_steps: 3,
      from_step_id: "rail_toggle",
      to_step_id: "composer",
      to_step_index: 1,
      finished: false,
    });
  });

  it("emits a finished:true payload on the last step (next === null)", () => {
    const ev = buildAdvancedEvent({
      current: { id: "sources_drawer", index: 2 },
      next: null,
      totalSteps: 3,
    });
    expect(ev.finished).toBe(true);
    // When there's no further step, to_* mirrors current to keep
    // the dashboard schema stable.
    expect(ev.to_step_id).toBe("sources_drawer");
    expect(ev.to_step_index).toBe(2);
  });

  it("preserves total_steps for funnel sizing", () => {
    const ev = buildAdvancedEvent({
      current: { id: "composer", index: 1 },
      next: { id: "sources_drawer", index: 2 },
      totalSteps: 5, // hypothetical longer tour
    });
    expect(ev.total_steps).toBe(5);
  });
});

describe("buildSkippedReason", () => {
  it("passes the canonical three reasons through unchanged", () => {
    expect(buildSkippedReason("skip_button")).toBe("skip_button");
    expect(buildSkippedReason("backdrop")).toBe("backdrop");
    expect(buildSkippedReason("escape")).toBe("escape");
  });

  it("defaults to skip_button on null / undefined / unknown strings", () => {
    expect(buildSkippedReason(null)).toBe("skip_button");
    expect(buildSkippedReason(undefined)).toBe("skip_button");
    expect(buildSkippedReason("")).toBe("skip_button");
    expect(buildSkippedReason("backdrop_click" as unknown as string)).toBe(
      "skip_button",
    );
    expect(buildSkippedReason("ESCAPE" as unknown as string)).toBe(
      "skip_button",
    ); // case-sensitive on purpose
  });
});

describe("trackOnboarding* emit canonical event names", () => {
  it("trackOnboardingStepShown emits onboarding_step_shown", () => {
    trackOnboardingStepShown({
      step_id: "composer",
      step_index: 1,
      total_steps: 3,
    });
    const buffered = peekBuffer();
    expect(buffered.length).toBe(1);
    expect(buffered[0].event).toBe("onboarding_step_shown");
    expect(buffered[0].props.step_id).toBe("composer");
  });

  it("trackOnboardingAdvanced emits onboarding_advanced", () => {
    trackOnboardingAdvanced(
      buildAdvancedEvent({
        current: { id: "rail_toggle", index: 0 },
        next: { id: "composer", index: 1 },
        totalSteps: 3,
      }),
    );
    const buffered = peekBuffer();
    expect(buffered.length).toBe(1);
    expect(buffered[0].event).toBe("onboarding_advanced");
    expect(buffered[0].props.finished).toBe(false);
  });

  it("trackOnboardingSkipped carries the canonical reason vector", () => {
    trackOnboardingSkipped({
      step_id: "rail_toggle",
      step_index: 0,
      total_steps: 3,
      reason: "escape",
    });
    const buffered = peekBuffer();
    expect(buffered.length).toBe(1);
    expect(buffered[0].event).toBe("onboarding_skipped");
    expect(buffered[0].props.reason).toBe("escape");
  });

  it("trackOnboardingCompleted emits onboarding_completed", () => {
    trackOnboardingCompleted({
      step_id: "sources_drawer",
      step_index: 2,
      total_steps: 3,
    });
    const buffered = peekBuffer();
    expect(buffered.length).toBe(1);
    expect(buffered[0].event).toBe("onboarding_completed");
    expect(buffered[0].props.step_index).toBe(2);
  });
});
