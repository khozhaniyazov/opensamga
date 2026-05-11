/**
 * v3.59 (2026-05-02) — `describeApiError` contract pins.
 *
 * Backstory: B1 in the 2026-05-02 E2E report — when
 * `/api/parent-report/tokens` returned 500 (alembic drift,
 * `parent_report_share_tokens` missing), the page rendered the raw
 * string "Internal Server Error" between the form and the empty-list
 * label. The migration drift was the proximate cause, but the FE
 * surface was the visible bug: no status code, no localized prefix,
 * just the upstream text leaking onto the page.
 *
 * `describeApiError` extracts the HTTP code and decides whether the
 * server-supplied message is safe to surface verbatim. If not, it
 * substitutes a localized fallback. Pure function; no DOM.
 */

import { describe, expect, it } from "vitest";
import { describeApiError } from "../ParentReportPage";

class FakeApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

describe("describeApiError (v3.59)", () => {
  it("returns HTTP code + fallback when message is a generic 500-echo", () => {
    const err = new FakeApiError(500, "Internal Server Error");
    const out = describeApiError(err, "повторите попытку позже");
    expect(out.code).toBe("HTTP 500");
    expect(out.detail).toBe("повторите попытку позже");
  });

  it("filters 'Request failed with status N' echoes too", () => {
    const err = new FakeApiError(502, "Request failed with status 502");
    const out = describeApiError(err, "fallback");
    expect(out.code).toBe("HTTP 502");
    expect(out.detail).toBe("fallback");
  });

  it("filters Bad Gateway / Service Unavailable / Gateway Timeout echoes", () => {
    for (const [status, msg] of [
      [502, "Bad Gateway"],
      [503, "Service Unavailable"],
      [504, "Gateway Timeout"],
    ] as const) {
      const out = describeApiError(new FakeApiError(status, msg), "fallback");
      expect(out.code).toBe(`HTTP ${status}`);
      expect(out.detail).toBe("fallback");
    }
  });

  it("surfaces a useful 400-class detail verbatim", () => {
    const err = new FakeApiError(403, "Premium subscription required");
    const out = describeApiError(err, "fallback");
    expect(out.code).toBe("HTTP 403");
    expect(out.detail).toBe("Premium subscription required");
  });

  it("substitutes fallback when message is implausibly long (likely an HTML body)", () => {
    const long = "x".repeat(500);
    const err = new FakeApiError(500, long);
    const out = describeApiError(err, "fallback");
    expect(out.detail).toBe("fallback");
  });

  it("handles a plain Error (network failure) gracefully", () => {
    const err = new Error("Failed to fetch");
    const out = describeApiError(err, "fallback");
    expect(out.code).toBe("—");
    expect(out.detail).toBe("Failed to fetch");
  });

  it("falls back when given non-Error garbage (e.g. a parsed JSON value)", () => {
    const out = describeApiError({ random: "thing" }, "fallback");
    expect(out.code).toBe("—");
    expect(out.detail).toBe("fallback");
  });

  it("treats status=0 as missing", () => {
    const err = new FakeApiError(0, "Custom message");
    const out = describeApiError(err, "fallback");
    expect(out.code).toBe("—");
    expect(out.detail).toBe("Custom message");
  });
});
