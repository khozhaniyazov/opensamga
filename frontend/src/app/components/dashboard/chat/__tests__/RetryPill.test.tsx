/**
 * s30 (D5) — vitest pin tests for RetryPill pure helpers.
 *
 * The classifier `isTransient5xx` is the single point of truth for
 * which HTTP statuses warrant a silent retry on /api/chat/stream;
 * the predicate / label helpers cover the standard pattern.
 */

import { describe, expect, it } from "vitest";
import {
  isTransient5xx,
  retryPillLabel,
  shouldShowRetryPill,
} from "../RetryPill";

describe("shouldShowRetryPill", () => {
  it("renders only on the literal true", () => {
    expect(shouldShowRetryPill(true)).toBe(true);
  });

  it("does not render on false / undefined / null", () => {
    expect(shouldShowRetryPill(false)).toBe(false);
    expect(shouldShowRetryPill(undefined)).toBe(false);
    expect(shouldShowRetryPill(null)).toBe(false);
  });

  it("does not render on truthy non-boolean values", () => {
    expect(
      shouldShowRetryPill("yes" as unknown as boolean | null | undefined),
    ).toBe(false);
    expect(
      shouldShowRetryPill(1 as unknown as boolean | null | undefined),
    ).toBe(false);
  });
});

describe("retryPillLabel", () => {
  it("returns RU copy by default", () => {
    expect(retryPillLabel("ru")).toBe("Повторная попытка...");
  });

  it("returns KZ copy for kazakh locale", () => {
    expect(retryPillLabel("kz")).toBe("Қайта тырысу...");
  });
});

describe("isTransient5xx", () => {
  it("retries the canonical Bad Gateway / Service Unavailable / Gateway Timeout trio", () => {
    expect(isTransient5xx(502)).toBe(true);
    expect(isTransient5xx(503)).toBe(true);
    expect(isTransient5xx(504)).toBe(true);
  });

  it("retries Cloudflare/edge transients 520..524", () => {
    expect(isTransient5xx(520)).toBe(true);
    expect(isTransient5xx(521)).toBe(true);
    expect(isTransient5xx(522)).toBe(true);
    expect(isTransient5xx(523)).toBe(true);
    expect(isTransient5xx(524)).toBe(true);
  });

  it("does not retry 500 (treat as deterministic server bug, not transient)", () => {
    // 500 means "we hit a code path that throws"; retrying just hits
    // the same throw. Better to fall straight through to REST so the
    // user gets a working answer from the parallel path.
    expect(isTransient5xx(500)).toBe(false);
  });

  it("does not retry 501/505/525..599", () => {
    expect(isTransient5xx(501)).toBe(false);
    expect(isTransient5xx(505)).toBe(false);
    expect(isTransient5xx(525)).toBe(false);
    expect(isTransient5xx(599)).toBe(false);
  });

  it("does not retry 4xx (client errors)", () => {
    // 4xx are client errors — retrying them just hits the same wall
    // (auth missing, payload malformed, etc.) and the FE has dedicated
    // handlers (429 → quota modal, 403 → paywall) elsewhere.
    expect(isTransient5xx(400)).toBe(false);
    expect(isTransient5xx(401)).toBe(false);
    expect(isTransient5xx(403)).toBe(false);
    expect(isTransient5xx(404)).toBe(false);
    expect(isTransient5xx(429)).toBe(false);
  });

  it("does not retry 2xx / 3xx", () => {
    expect(isTransient5xx(200)).toBe(false);
    expect(isTransient5xx(204)).toBe(false);
    expect(isTransient5xx(301)).toBe(false);
  });

  it("rejects NaN / non-finite values defensively", () => {
    // fetch().status can be 0 on opaque redirects / cors weirdness;
    // never retry on a non-finite or non-positive number.
    expect(isTransient5xx(Number.NaN)).toBe(false);
    expect(isTransient5xx(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
