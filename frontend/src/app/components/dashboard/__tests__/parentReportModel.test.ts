/**
 * v3.27 — Pure-helper contract tests for the parent-report model.
 * No DOM, no React, no fetch — vitest unit lane only.
 */

import { describe, it, expect } from "vitest";
import {
  PARENT_REPORT_DEFAULT_TTL_DAYS,
  PARENT_REPORT_MAX_TTL_DAYS,
  clampTtlDays,
  formatTokenDate,
  isTokenStillActive,
  parentReportShareUrl,
  type ParentReportTokenSummary,
} from "../parentReportModel";

function mkToken(
  overrides: Partial<ParentReportTokenSummary> = {},
): ParentReportTokenSummary {
  return {
    id: 1,
    token: "tok_abc123",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    is_revoked: false,
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    access_count: 0,
    ...overrides,
  };
}

describe("clampTtlDays", () => {
  it("falls back to default for null / undefined / non-positive", () => {
    expect(clampTtlDays(null)).toBe(PARENT_REPORT_DEFAULT_TTL_DAYS);
    expect(clampTtlDays(undefined)).toBe(PARENT_REPORT_DEFAULT_TTL_DAYS);
    expect(clampTtlDays(0)).toBe(PARENT_REPORT_DEFAULT_TTL_DAYS);
    expect(clampTtlDays(-3)).toBe(PARENT_REPORT_DEFAULT_TTL_DAYS);
  });

  it("caps at PARENT_REPORT_MAX_TTL_DAYS", () => {
    expect(clampTtlDays(PARENT_REPORT_MAX_TTL_DAYS + 100)).toBe(
      PARENT_REPORT_MAX_TTL_DAYS,
    );
  });

  it("passes valid values through, flooring fractions", () => {
    expect(clampTtlDays(7)).toBe(7);
    expect(clampTtlDays(14.9)).toBe(14);
  });

  it("rejects NaN", () => {
    expect(clampTtlDays(Number.NaN)).toBe(PARENT_REPORT_DEFAULT_TTL_DAYS);
  });
});

describe("isTokenStillActive", () => {
  it("returns false for revoked tokens regardless of expiry", () => {
    const future = new Date(Date.now() + 100_000_000).toISOString();
    expect(
      isTokenStillActive(mkToken({ is_revoked: true, expires_at: future })),
    ).toBe(false);
  });

  it("returns false for expired tokens", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isTokenStillActive(mkToken({ expires_at: past }))).toBe(false);
  });

  it("returns true for live tokens", () => {
    expect(isTokenStillActive(mkToken())).toBe(true);
  });

  it("returns false on unparseable expiry", () => {
    expect(isTokenStillActive(mkToken({ expires_at: "not-a-date" }))).toBe(
      false,
    );
  });
});

describe("formatTokenDate", () => {
  it("returns dash for null / unparseable input", () => {
    expect(formatTokenDate(null)).toBe("—");
    expect(formatTokenDate("not-a-date")).toBe("—");
  });

  it("returns a non-empty locale string for ISO input", () => {
    const out = formatTokenDate("2026-05-01T09:00:00Z");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("parentReportShareUrl", () => {
  it("anchors at window.origin when available (jsdom default)", () => {
    const url = parentReportShareUrl("abc-token");
    // jsdom default origin is http://localhost:3000 or similar — assert
    // shape rather than exact host.
    expect(url).toMatch(/^https?:\/\/[^/]+\/parent-report\/abc-token$/);
  });

  it("URL-encodes the token", () => {
    const url = parentReportShareUrl("a/b?c");
    expect(url).toContain("a%2Fb%3Fc");
  });
});
