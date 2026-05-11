/**
 * s35 wave 57 (2026-04-28) — ReasoningPanel telemetry pure pins.
 *
 * Component-render tests deferred (ReasoningPanel reads
 * LanguageContext + useViewportMobile + useReducedMotion + renders
 * ThinkingTrack + ToolCallTimeline — heavy provider stack). The
 * telemetry contract itself is what the dashboards depend on; that
 * surface is small enough to pin without a renderer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  drainBuffer,
  peekBuffer,
  trackReasoningPanelToggled,
} from "../../../../lib/telemetry";

beforeEach(() => {
  drainBuffer();
});
afterEach(() => {
  drainBuffer();
});

describe("trackReasoningPanelToggled", () => {
  it("emits chat_reasoning_panel_toggled with full payload on open", () => {
    trackReasoningPanelToggled({
      is_open: true,
      is_streaming: false,
      tool_count: 3,
      iteration_count: 2,
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].event).toBe("chat_reasoning_panel_toggled");
    expect(buf[0].props).toEqual({
      is_open: true,
      is_streaming: false,
      tool_count: 3,
      iteration_count: 2,
    });
  });

  it("emits is_open:false on collapse", () => {
    trackReasoningPanelToggled({
      is_open: false,
      is_streaming: false,
      tool_count: 5,
      iteration_count: 3,
    });
    const buf = peekBuffer();
    expect(buf[0].props.is_open).toBe(false);
  });

  it("captures is_streaming:true so mid-run opens are distinguishable from post-run trust checks", () => {
    // Mid-run open → engagement signal.
    trackReasoningPanelToggled({
      is_open: true,
      is_streaming: true,
      tool_count: 1,
      iteration_count: 1,
    });
    expect(peekBuffer()[0].props.is_streaming).toBe(true);
  });

  it("preserves zero counts (zero-tool / zero-iteration runs)", () => {
    // ReasoningPanel can render with thinking-only parts and no
    // tool calls. The toggle event must still emit cleanly with
    // zeros so the dashboard can surface "no-tool runs were
    // engagement-grade for the user" insights.
    trackReasoningPanelToggled({
      is_open: true,
      is_streaming: false,
      tool_count: 0,
      iteration_count: 0,
    });
    const props = peekBuffer()[0].props;
    expect(props.tool_count).toBe(0);
    expect(props.iteration_count).toBe(0);
  });

  it("event name does NOT collide with sources-drawer or template events", () => {
    trackReasoningPanelToggled({
      is_open: true,
      is_streaming: false,
      tool_count: 1,
      iteration_count: 1,
    });
    const ev = peekBuffer()[0].event;
    expect(ev).not.toBe("chat_sources_drawer_toggled");
    expect(ev).not.toBe("chat_template_clicked");
    expect(ev).toBe("chat_reasoning_panel_toggled");
  });
});
