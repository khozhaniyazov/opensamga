/**
 * s32 (A5) — vitest pin tests for OutdatedDataPill pure helpers.
 */

import { describe, expect, it } from "vitest";
import {
  STALENESS_THRESHOLD_DAYS,
  countStaleSources,
  isSourceStale,
  outdatedDataPillLabel,
  shouldShowOutdatedDataPill,
} from "../OutdatedDataPill";
import type { ConsultedSource } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-04-27T12:00:00Z");

const mk = (updated_at: string | null | undefined): ConsultedSource => ({
  book_id: 1,
  page_number: 1,
  updated_at,
});

describe("STALENESS_THRESHOLD_DAYS", () => {
  it("is pinned to 540 (~18 months)", () => {
    // The threshold drives a real user-visible warning. Bumping it
    // up makes the pill quieter; bumping it down makes more
    // citations feel "outdated". Boss-call decision.
    expect(STALENESS_THRESHOLD_DAYS).toBe(540);
  });
});

describe("isSourceStale", () => {
  it("flags a source older than the threshold", () => {
    const ts = new Date(
      NOW - (STALENESS_THRESHOLD_DAYS + 5) * MS_PER_DAY,
    ).toISOString();
    expect(isSourceStale(mk(ts), NOW)).toBe(true);
  });

  it("does not flag a source on the boundary", () => {
    // The check is `> threshold`, not `>=`, so a source exactly at
    // 540 days is still considered fresh enough.
    const ts = new Date(
      NOW - STALENESS_THRESHOLD_DAYS * MS_PER_DAY,
    ).toISOString();
    expect(isSourceStale(mk(ts), NOW)).toBe(false);
  });

  it("does not flag a source younger than the threshold", () => {
    const ts = new Date(NOW - 30 * MS_PER_DAY).toISOString();
    expect(isSourceStale(mk(ts), NOW)).toBe(false);
  });

  it("does not flag a future timestamp (clock skew, not stale)", () => {
    const ts = new Date(NOW + 5 * MS_PER_DAY).toISOString();
    expect(isSourceStale(mk(ts), NOW)).toBe(false);
  });

  it("does not flag a source with null updated_at (unknown != stale)", () => {
    // Critical: we treat missing freshness as "unknown", NOT as
    // "stale", so the pill doesn't false-positive on legacy
    // citations that pre-date the s32 alembic migration.
    expect(isSourceStale(mk(null), NOW)).toBe(false);
    expect(isSourceStale(mk(undefined), NOW)).toBe(false);
  });

  it("does not flag a source with empty/whitespace updated_at", () => {
    expect(isSourceStale(mk(""), NOW)).toBe(false);
    expect(isSourceStale(mk("   "), NOW)).toBe(false);
  });

  it("does not flag a source with unparseable updated_at", () => {
    expect(isSourceStale(mk("not a date"), NOW)).toBe(false);
  });

  it("rejects null/undefined source defensively", () => {
    expect(isSourceStale(null, NOW)).toBe(false);
    expect(isSourceStale(undefined, NOW)).toBe(false);
  });
});

describe("countStaleSources", () => {
  it("counts the number of stale entries", () => {
    const stale = new Date(
      NOW - (STALENESS_THRESHOLD_DAYS + 30) * MS_PER_DAY,
    ).toISOString();
    const fresh = new Date(NOW - 10 * MS_PER_DAY).toISOString();
    const sources = [mk(stale), mk(fresh), mk(stale), mk(null)];
    expect(countStaleSources(sources, NOW)).toBe(2);
  });

  it("returns 0 on empty/non-array input", () => {
    expect(countStaleSources([], NOW)).toBe(0);
    expect(countStaleSources(null, NOW)).toBe(0);
    expect(countStaleSources(undefined, NOW)).toBe(0);
  });
});

describe("shouldShowOutdatedDataPill", () => {
  it("is true iff at least one stale source", () => {
    const stale = new Date(
      NOW - (STALENESS_THRESHOLD_DAYS + 1) * MS_PER_DAY,
    ).toISOString();
    expect(shouldShowOutdatedDataPill([mk(stale)], NOW)).toBe(true);
  });

  it("is false on an all-fresh source list", () => {
    const fresh = new Date(NOW - 30 * MS_PER_DAY).toISOString();
    expect(shouldShowOutdatedDataPill([mk(fresh), mk(fresh)], NOW)).toBe(false);
  });

  it("is false on an all-unknown-freshness source list", () => {
    // 8 legacy citations with no updated_at must NOT light up the
    // pill — the pill is for "we know it's stale", not "we don't
    // know how fresh".
    expect(
      shouldShowOutdatedDataPill([mk(null), mk(null), mk(null)], NOW),
    ).toBe(false);
  });

  it("is false on an empty list", () => {
    expect(shouldShowOutdatedDataPill([], NOW)).toBe(false);
  });
});

describe("outdatedDataPillLabel", () => {
  it("appends a stale/total ratio to the base label", () => {
    expect(outdatedDataPillLabel(2, 5, "Стало")).toBe("Стало (2/5)");
  });

  it("returns the base label when no stale", () => {
    expect(outdatedDataPillLabel(0, 5, "Стало")).toBe("Стало");
  });

  it("clamps ratio when stale > total (defensive)", () => {
    // Should never happen, but if it does, render at least a
    // sensible "(N/N)" rather than "(3/2)".
    expect(outdatedDataPillLabel(3, 2, "Стало")).toBe("Стало (3/3)");
  });

  it("returns the base label on zero total", () => {
    expect(outdatedDataPillLabel(0, 0, "Стало")).toBe("Стало");
  });
});
