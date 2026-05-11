/**
 * s35 wave 62 (2026-04-28) — firstSendTiming pure pins.
 */

import { describe, expect, it } from "vitest";
import { computeTimeToFirstSendMs, firstSendBucket } from "../firstSendTiming";

describe("computeTimeToFirstSendMs", () => {
  it("returns sentAt - mountedAt for a normal session", () => {
    expect(computeTimeToFirstSendMs(1000, 5500)).toBe(4500);
  });

  it("returns null when mountedAt is null", () => {
    expect(computeTimeToFirstSendMs(null, 5500)).toBeNull();
  });

  it("returns null when mountedAt is undefined", () => {
    expect(computeTimeToFirstSendMs(undefined, 5500)).toBeNull();
  });

  it("returns null for non-finite mountedAt (NaN/Infinity)", () => {
    expect(computeTimeToFirstSendMs(NaN, 5500)).toBeNull();
    expect(computeTimeToFirstSendMs(Infinity, 5500)).toBeNull();
  });

  it("returns null when sentAt is non-finite", () => {
    expect(computeTimeToFirstSendMs(1000, NaN)).toBeNull();
  });

  it("clamps negative diffs (clock drift) to 0", () => {
    expect(computeTimeToFirstSendMs(2000, 1500)).toBe(0);
  });

  it("returns 0 for a same-tick send (zero diff)", () => {
    expect(computeTimeToFirstSendMs(1500, 1500)).toBe(0);
  });
});

describe("firstSendBucket", () => {
  it("buckets sub-2s as '0-2s'", () => {
    expect(firstSendBucket(0)).toBe("0-2s");
    expect(firstSendBucket(1_999)).toBe("0-2s");
  });

  it("buckets 2..9.999s as '2-10s'", () => {
    expect(firstSendBucket(2_000)).toBe("2-10s");
    expect(firstSendBucket(9_999)).toBe("2-10s");
  });

  it("buckets 10..59.999s as '10-60s'", () => {
    expect(firstSendBucket(10_000)).toBe("10-60s");
    expect(firstSendBucket(59_999)).toBe("10-60s");
  });

  it("buckets >=60s as '60s+'", () => {
    expect(firstSendBucket(60_000)).toBe("60s+");
    expect(firstSendBucket(10 * 60_000)).toBe("60s+");
  });

  it("returns 'unknown' for null / undefined / NaN / Infinity / negative", () => {
    expect(firstSendBucket(null)).toBe("unknown");
    expect(firstSendBucket(undefined)).toBe("unknown");
    expect(firstSendBucket(NaN)).toBe("unknown");
    expect(firstSendBucket(Infinity)).toBe("unknown");
    expect(firstSendBucket(-1)).toBe("unknown");
  });
});

describe("firstSendTiming — purity", () => {
  it("does not mutate inputs", () => {
    const m = 1000;
    const s = 5500;
    computeTimeToFirstSendMs(m, s);
    firstSendBucket(s - m);
    expect(m).toBe(1000);
    expect(s).toBe(5500);
  });
});
