/**
 * v3.62 (2026-05-02) — `safeOrbitRingRadii` contract pins.
 *
 * Backstory: B6 in the 2026-05-02 E2E report. On a 390x844 mobile
 * viewport, the LandingPage `drawOrbit` loop produced a negative
 * radius on one of the inner rings, and CanvasRenderingContext2D.ellipse()
 * threw `IndexSizeError`. The error fired on every resize-tick — every
 * mobile visitor saw a console error wall.
 *
 *   IndexSizeError: Failed to execute 'ellipse' on 'CanvasRenderingContext2D':
 *   The major-axis radius provided (-24) is negative.
 *
 * The fix lifts a tiny pure helper so we can pin the clamp without a
 * canvas. We do NOT add a full LandingPage render test — its render
 * tree is heavy and the canvas behaviour is the only thing under bug.
 */

import { describe, expect, it } from "vitest";

import { safeOrbitRingRadii } from "../LandingPage";

describe("safeOrbitRingRadii (v3.62)", () => {
  it("returns the base radii at ring 0 (outermost ring)", () => {
    const out = safeOrbitRingRadii(260, 220, 0);
    expect(out).toEqual({ rx: 260, ry: 220 });
  });

  it("steps inward by 34/23 per ring (matches drawOrbit's stride)", () => {
    expect(safeOrbitRingRadii(260, 220, 1)).toEqual({ rx: 226, ry: 197 });
    expect(safeOrbitRingRadii(260, 220, 2)).toEqual({ rx: 192, ry: 174 });
    expect(safeOrbitRingRadii(260, 220, 3)).toEqual({ rx: 158, ry: 151 });
  });

  it("clamps to 0 when the ring stride exceeds the base radius (the B6 case)", () => {
    // A 390-wide viewport gets a radiusX of width*0.2 = 78; the third
    // inner ring tries 78-3*34 = -24. Pre-fix, ellipse() threw.
    expect(safeOrbitRingRadii(78, 70, 3)).toEqual({ rx: 0, ry: 1 });
    // And one step further still — never negative.
    expect(safeOrbitRingRadii(60, 50, 3)).toEqual({ rx: 0, ry: 0 });
  });

  it("never returns a negative radius regardless of how deep the loop goes", () => {
    for (let ring = 0; ring < 12; ring += 1) {
      const out = safeOrbitRingRadii(50, 40, ring);
      expect(out.rx).toBeGreaterThanOrEqual(0);
      expect(out.ry).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats 0/0 base radii as already-clamped", () => {
    expect(safeOrbitRingRadii(0, 0, 0)).toEqual({ rx: 0, ry: 0 });
    expect(safeOrbitRingRadii(0, 0, 5)).toEqual({ rx: 0, ry: 0 });
  });
});
