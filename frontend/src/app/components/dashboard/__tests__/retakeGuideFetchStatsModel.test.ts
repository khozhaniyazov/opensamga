import { describe, expect, it } from "vitest";

import {
  classifyFetchStats,
  humanizeEpochSeconds,
  validateFetchStatsPayload,
  type RetakeGuideFetchStats,
} from "../retakeGuideFetchStatsModel";

describe("humanizeEpochSeconds", () => {
  it("returns dash placeholder for null/undefined/NaN", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(null, now)).toBe("—");
    expect(humanizeEpochSeconds(undefined, now)).toBe("—");
    expect(humanizeEpochSeconds(NaN, now)).toBe("—");
    expect(humanizeEpochSeconds(Infinity, now)).toBe("—");
  });

  it("collapses tiny ages to 'just now'", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now, now)).toBe("just now");
    expect(humanizeEpochSeconds(now - 5, now)).toBe("just now");
    expect(humanizeEpochSeconds(now - 29, now)).toBe("just now");
  });

  it("formats sub-minute ages in seconds", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now - 45, now)).toBe("45s");
  });

  it("formats minute ages", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now - 90, now)).toBe("1m");
    expect(humanizeEpochSeconds(now - 59 * 60, now)).toBe("59m");
  });

  it("formats hour ages", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now - 3600, now)).toBe("1h");
    expect(humanizeEpochSeconds(now - 23 * 3600, now)).toBe("23h");
  });

  it("formats day ages", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now - 24 * 3600, now)).toBe("1d");
    expect(humanizeEpochSeconds(now - 7 * 24 * 3600, now)).toBe("7d");
  });

  it("coerces clock-skew (future) timestamps to 'just now'", () => {
    const now = 1_700_000_000;
    expect(humanizeEpochSeconds(now + 600, now)).toBe("just now");
  });
});

describe("classifyFetchStats", () => {
  const now = 1_700_000_000;
  const fresh: RetakeGuideFetchStats = {
    success_count: 0,
    failure_count: 0,
    last_success_at: null,
    last_failure_at: null,
    last_failure_reason: null,
  };

  it("returns 'idle' when nothing has happened yet", () => {
    expect(classifyFetchStats(fresh, now)).toBe("idle");
  });

  it("returns 'dead' when only failures recorded (current prod state)", () => {
    expect(
      classifyFetchStats(
        {
          ...fresh,
          failure_count: 5,
          last_failure_at: now - 600,
          last_failure_reason: "httpx_ConnectError",
        },
        now,
      ),
    ).toBe("dead");
  });

  it("returns 'ok' when last success is within 24h", () => {
    expect(
      classifyFetchStats(
        { ...fresh, success_count: 4, last_success_at: now - 3600 },
        now,
      ),
    ).toBe("ok");
  });

  it("returns 'ok' for a mix when the last success is fresh", () => {
    expect(
      classifyFetchStats(
        {
          ...fresh,
          success_count: 10,
          failure_count: 2,
          last_success_at: now - 1800,
          last_failure_at: now - 600,
        },
        now,
      ),
    ).toBe("ok");
  });

  it("returns 'warn' when last success is older than 24h", () => {
    expect(
      classifyFetchStats(
        {
          ...fresh,
          success_count: 1,
          failure_count: 0,
          last_success_at: now - 25 * 3600,
        },
        now,
      ),
    ).toBe("warn");
  });

  it("returns 'warn' when there is no last_success_at but counters exist", () => {
    expect(
      classifyFetchStats(
        {
          ...fresh,
          success_count: 3,
          failure_count: 1,
          last_success_at: null,
        },
        now,
      ),
    ).toBe("warn");
  });
});

describe("validateFetchStatsPayload", () => {
  const happy = {
    schedule_url: "https://www.testing.kz/ent/schedule",
    stats: {
      success_count: 0,
      failure_count: 3,
      last_success_at: null,
      last_failure_at: 1_700_000_000.5,
      last_failure_reason: "httpx_ConnectError",
    },
  };

  it("accepts the BE-shaped payload verbatim", () => {
    const out = validateFetchStatsPayload(happy);
    expect(out.schedule_url).toBe(happy.schedule_url);
    expect(out.stats.failure_count).toBe(3);
    expect(out.stats.last_success_at).toBeNull();
    expect(out.stats.last_failure_reason).toBe("httpx_ConnectError");
  });

  it("rejects a non-object payload with a useful error", () => {
    expect(() => validateFetchStatsPayload(null)).toThrow();
    expect(() => validateFetchStatsPayload("hello")).toThrow();
  });

  it("rejects when schedule_url is missing or empty", () => {
    expect(() => validateFetchStatsPayload({ stats: happy.stats })).toThrow(
      /schedule_url/,
    );
    expect(() =>
      validateFetchStatsPayload({ ...happy, schedule_url: "" }),
    ).toThrow(/schedule_url/);
  });

  it("rejects when stats is missing", () => {
    expect(() =>
      validateFetchStatsPayload({ schedule_url: happy.schedule_url }),
    ).toThrow(/stats/);
  });

  it("rejects when a required stats key is missing", () => {
    const broken = {
      ...happy,
      stats: { ...happy.stats } as Record<string, unknown>,
    };
    delete broken.stats.last_failure_reason;
    expect(() => validateFetchStatsPayload(broken)).toThrow(
      /last_failure_reason/,
    );
  });

  it("coerces stringified counters to numbers (defensive)", () => {
    const out = validateFetchStatsPayload({
      ...happy,
      stats: {
        ...happy.stats,
        success_count: "12",
      },
    });
    expect(out.stats.success_count).toBe(12);
  });
});
