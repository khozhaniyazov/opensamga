/**
 * s35 wave 54 (2026-04-28) — templateDwell pure-helper pins.
 */

import { describe, expect, it } from "vitest";
import { computeDwellMs, dwellBucket } from "../templateDwell";

describe("computeDwellMs", () => {
  it("returns the floored positive diff for the typical case", () => {
    expect(computeDwellMs(1000, 1500)).toBe(500);
    expect(computeDwellMs(1000, 1500.7)).toBe(500); // floors
    expect(computeDwellMs(1000, 61_000)).toBe(60_000);
  });

  it("returns 0 on null / undefined inputs", () => {
    expect(computeDwellMs(null, 1500)).toBe(0);
    expect(computeDwellMs(undefined, 1500)).toBe(0);
    expect(computeDwellMs(1000, null)).toBe(0);
    expect(computeDwellMs(1000, undefined)).toBe(0);
    expect(computeDwellMs(null, null)).toBe(0);
  });

  it("returns 0 on non-number inputs", () => {
    expect(computeDwellMs("1000" as unknown as number, 1500)).toBe(0);
    expect(computeDwellMs(1000, "1500" as unknown as number)).toBe(0);
  });

  it("returns 0 on non-finite values", () => {
    expect(computeDwellMs(Number.NaN, 1500)).toBe(0);
    expect(computeDwellMs(1000, Number.POSITIVE_INFINITY)).toBe(0);
    expect(computeDwellMs(Number.NEGATIVE_INFINITY, 1500)).toBe(0);
  });

  it("returns 0 on clock drift / debugger pause (clickedAt <= mountedAt)", () => {
    // If the user double-clicks fast enough that JS ms tick stalls,
    // we'd rather record 0 than a confusing negative ms.
    expect(computeDwellMs(1500, 1500)).toBe(0);
    expect(computeDwellMs(1500, 1499)).toBe(0);
    // 24h backwards (NTP correction mid-session) — still 0.
    expect(computeDwellMs(1_700_000_000_000, 1_699_900_000_000)).toBe(0);
  });
});

describe("dwellBucket", () => {
  it("categorises typical dwell values into the canonical buckets", () => {
    expect(dwellBucket(0)).toBe("reflexive_lt_500ms");
    expect(dwellBucket(120)).toBe("reflexive_lt_500ms");
    expect(dwellBucket(499)).toBe("reflexive_lt_500ms");
    expect(dwellBucket(500)).toBe("skim_500_2000ms");
    expect(dwellBucket(1500)).toBe("skim_500_2000ms");
    expect(dwellBucket(1999)).toBe("skim_500_2000ms");
    expect(dwellBucket(2000)).toBe("read_2_10s");
    expect(dwellBucket(5000)).toBe("read_2_10s");
    expect(dwellBucket(9999)).toBe("read_2_10s");
    expect(dwellBucket(10_000)).toBe("deliberate_10_60s");
    expect(dwellBucket(45_000)).toBe("deliberate_10_60s");
    expect(dwellBucket(59_999)).toBe("deliberate_10_60s");
    expect(dwellBucket(60_000)).toBe("idle_gte_60s");
    expect(dwellBucket(600_000)).toBe("idle_gte_60s");
  });

  it("returns 'unknown' on negative or non-finite values", () => {
    expect(dwellBucket(-1)).toBe("unknown");
    expect(dwellBucket(Number.NaN)).toBe("unknown");
    expect(dwellBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});
