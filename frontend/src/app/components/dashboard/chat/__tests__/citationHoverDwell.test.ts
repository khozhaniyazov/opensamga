/**
 * s35 wave 61 (2026-04-28) — citationHoverDwell pure pins.
 */

import { describe, expect, it } from "vitest";
import { computeHoverDwellMs, hoverDwellBucket } from "../citationHoverDwell";

describe("computeHoverDwellMs", () => {
  it("returns the click-minus-hover diff for a normal hover→click sequence", () => {
    expect(computeHoverDwellMs(1000, 1500)).toBe(500);
  });

  it("returns null when hoverStartedAt is null (click without prior hover)", () => {
    expect(computeHoverDwellMs(null, 1500)).toBeNull();
  });

  it("returns null when hoverStartedAt is undefined", () => {
    expect(computeHoverDwellMs(undefined, 1500)).toBeNull();
  });

  it("returns null for non-finite hoverStartedAt (NaN / Infinity)", () => {
    expect(computeHoverDwellMs(NaN, 1500)).toBeNull();
    expect(computeHoverDwellMs(Infinity, 1500)).toBeNull();
  });

  it("returns null when clickedAt is non-finite", () => {
    expect(computeHoverDwellMs(1000, NaN)).toBeNull();
  });

  it("clamps negative diffs (clock drift) to 0", () => {
    expect(computeHoverDwellMs(2000, 1500)).toBe(0);
  });

  it("returns 0 for a same-tick click (zero diff)", () => {
    expect(computeHoverDwellMs(1500, 1500)).toBe(0);
  });
});

describe("hoverDwellBucket", () => {
  it("buckets sub-200 ms as '0-200'", () => {
    expect(hoverDwellBucket(0)).toBe("0-200");
    expect(hoverDwellBucket(199)).toBe("0-200");
  });

  it("buckets 200..499 ms as '200-500'", () => {
    expect(hoverDwellBucket(200)).toBe("200-500");
    expect(hoverDwellBucket(499)).toBe("200-500");
  });

  it("buckets 500..999 ms as '500-1000'", () => {
    expect(hoverDwellBucket(500)).toBe("500-1000");
    expect(hoverDwellBucket(999)).toBe("500-1000");
  });

  it("buckets 1000..2999 ms as '1000-3000'", () => {
    expect(hoverDwellBucket(1000)).toBe("1000-3000");
    expect(hoverDwellBucket(2999)).toBe("1000-3000");
  });

  it("buckets >=3000 ms as '3000+'", () => {
    expect(hoverDwellBucket(3000)).toBe("3000+");
    expect(hoverDwellBucket(60_000)).toBe("3000+");
  });

  it("returns 'unknown' for null / undefined / NaN / Infinity / negative", () => {
    expect(hoverDwellBucket(null)).toBe("unknown");
    expect(hoverDwellBucket(undefined)).toBe("unknown");
    expect(hoverDwellBucket(NaN)).toBe("unknown");
    expect(hoverDwellBucket(Infinity)).toBe("unknown");
    expect(hoverDwellBucket(-1)).toBe("unknown");
  });
});

describe("hoverDwellBucket — purity", () => {
  it("does not mutate inputs (identity preserved)", () => {
    const ms = 1234;
    hoverDwellBucket(ms);
    expect(ms).toBe(1234);
  });
});
