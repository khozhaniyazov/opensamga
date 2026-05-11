/**
 * s35 wave 73 (2026-04-29) — MAX_BUFFER overflow contract.
 *
 * The buffer caps at 500 events. Past the cap, the OLDEST event
 * is shifted off (FIFO drop). This test pins both:
 *   1. Cap value (500) — refactors that change the ceiling without
 *      a corresponding test/comment update fail loudly.
 *   2. FIFO drop semantics — if a future change switches to
 *      drop-newest or stop-accepting, the test catches it.
 *
 * Why FIFO-drop matters: the freshest events are usually the most
 * actionable for funnel analysis (e.g. the click that immediately
 * preceded a session bounce). Newest-wins is the right policy for
 * a navigation flush; tests should make that policy explicit.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainBuffer, peekBuffer, track } from "../telemetry";

const MAX_BUFFER_EXPECTED = 500;

beforeEach(() => {
  drainBuffer();
});
afterEach(() => {
  drainBuffer();
});

describe("BUFFER cap & overflow", () => {
  it("accepts events up to MAX_BUFFER (500) without dropping", () => {
    for (let i = 0; i < MAX_BUFFER_EXPECTED; i++) {
      track("fill", { i });
    }
    expect(peekBuffer().length).toBe(MAX_BUFFER_EXPECTED);
  });

  it("when buffer would exceed cap, drops the OLDEST event (FIFO)", () => {
    for (let i = 0; i < MAX_BUFFER_EXPECTED + 5; i++) {
      track("fill", { i });
    }
    const buf = peekBuffer();
    // Buffer length stays at the cap.
    expect(buf.length).toBe(MAX_BUFFER_EXPECTED);
    // The first 5 events were shifted off; the oldest survivor is
    // i=5, the newest is i=504.
    const firstI = buf[0].props.i as number;
    const lastI = buf[buf.length - 1].props.i as number;
    expect(firstI).toBe(5);
    expect(lastI).toBe(MAX_BUFFER_EXPECTED + 4);
  });

  it("never grows past MAX_BUFFER even under heavy churn", () => {
    // Simulate 3× the cap of events arriving in a tight loop.
    for (let i = 0; i < MAX_BUFFER_EXPECTED * 3; i++) {
      track("churn", { i });
    }
    expect(peekBuffer().length).toBe(MAX_BUFFER_EXPECTED);
  });
});
