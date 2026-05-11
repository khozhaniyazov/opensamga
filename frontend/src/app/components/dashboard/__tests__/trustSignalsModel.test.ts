import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUST_SIGNAL_DAYS,
  TRUST_SIGNAL_WINDOWS,
  formatAvg,
  formatCount,
  formatPct,
  redactionTone,
  sortRowsForDisplay,
  validateRollupPayload,
  type TrustSignalRow,
} from "../trustSignalsModel";

const baseRow: TrustSignalRow = {
  bucket: "agent",
  turns: 100,
  redactions_total: 0,
  turns_with_redaction: 0,
  redaction_pct: 0,
  turns_with_failed_tool: 0,
  failed_tool_pct: 0,
  turns_general_knowledge: 0,
  general_knowledge_pct: 0,
  turns_with_sources: 0,
  sourced_pct: 0,
  avg_redactions: null,
};

describe("trustSignalsModel — formatters", () => {
  it("formatPct: one decimal, em-dash for null/NaN", () => {
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(5.6)).toBe("5.6%");
    expect(formatPct(100)).toBe("100.0%");
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(Number.NaN)).toBe("—");
  });

  it("formatAvg: two decimals, em-dash distinguishes null from literal 0", () => {
    expect(formatAvg(0)).toBe("0.00");
    expect(formatAvg(0.083)).toBe("0.08");
    expect(formatAvg(null)).toBe("—");
    expect(formatAvg(undefined)).toBe("—");
    expect(formatAvg(Number.NaN)).toBe("—");
  });

  it("formatCount: ru-RU thousands separator (non-breaking space), em-dash for null", () => {
    // ru-RU locale uses non-breaking space (U+00A0) as a separator.
    expect(formatCount(1234567)).toMatch(/^1\D234\D567$/);
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
  });
});

describe("trustSignalsModel — sortRowsForDisplay", () => {
  it("sorts by turns desc, then bucket asc on ties", () => {
    const rows: TrustSignalRow[] = [
      { ...baseRow, bucket: "unknown", turns: 5 },
      { ...baseRow, bucket: "agent", turns: 100 },
      { ...baseRow, bucket: "legacy", turns: 100 },
    ];
    const sorted = sortRowsForDisplay(rows);
    expect(sorted.map((r) => r.bucket)).toEqual(["agent", "legacy", "unknown"]);
  });

  it("does not mutate the input array", () => {
    const rows: TrustSignalRow[] = [
      { ...baseRow, bucket: "z", turns: 1 },
      { ...baseRow, bucket: "a", turns: 99 },
    ];
    const before = rows.map((r) => r.bucket);
    sortRowsForDisplay(rows);
    expect(rows.map((r) => r.bucket)).toEqual(before);
  });
});

describe("trustSignalsModel — redactionTone", () => {
  it("warns at 5% threshold, ok below", () => {
    expect(redactionTone(0)).toBe("ok");
    expect(redactionTone(4.9)).toBe("ok");
    expect(redactionTone(5)).toBe("warn");
    expect(redactionTone(99)).toBe("warn");
    expect(redactionTone(null)).toBe("ok");
    expect(redactionTone(undefined)).toBe("ok");
    expect(redactionTone(Number.NaN)).toBe("ok");
  });
});

describe("trustSignalsModel — validateRollupPayload", () => {
  it("accepts a well-formed payload", () => {
    const ok = validateRollupPayload({
      window_days: 7,
      rows: [],
      totals: {
        turns: 0,
        redactions_total: 0,
        redaction_pct: 0,
        failed_tool_pct: 0,
        general_knowledge_pct: 0,
        sourced_pct: 0,
      },
    });
    expect(ok.window_days).toBe(7);
    expect(ok.rows).toEqual([]);
  });

  it("rejects non-objects", () => {
    expect(() => validateRollupPayload(null)).toThrow();
    expect(() => validateRollupPayload("string")).toThrow();
    expect(() => validateRollupPayload(42)).toThrow();
  });

  it("rejects payloads missing window_days / rows / totals", () => {
    expect(() => validateRollupPayload({ rows: [], totals: {} })).toThrow(
      /window_days/,
    );
    expect(() => validateRollupPayload({ window_days: 7, totals: {} })).toThrow(
      /rows/,
    );
    expect(() => validateRollupPayload({ window_days: 7, rows: [] })).toThrow(
      /totals/,
    );
  });
});

describe("trustSignalsModel — constants", () => {
  it("DEFAULT_TRUST_SIGNAL_DAYS is one of the allowed windows", () => {
    expect(TRUST_SIGNAL_WINDOWS.map((w) => w.days)).toContain(
      DEFAULT_TRUST_SIGNAL_DAYS,
    );
  });

  it("windows are unique and ascending", () => {
    const days = TRUST_SIGNAL_WINDOWS.map((w) => w.days);
    expect(new Set(days).size).toBe(days.length);
    const sorted = [...days].sort((a, b) => a - b);
    expect(days).toEqual(sorted);
  });
});
