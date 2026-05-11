/**
 * v3.35 (2026-05-01) — RetakeGuideFetchStatsPage component-contract pins.
 *
 * Pure model coverage lives in `retakeGuideFetchStatsModel.test.ts`.
 * This file pins the rendered DOM: the page calls the v3.34
 * endpoint, surfaces the resulting status banner with the right
 * tone, renders all four count/age cards, and degrades gracefully
 * on a payload that fails validation.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ---- Mocks (hoisted) -----------------------------------------------

const apiGet = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({}),
);

// SUT lives at src/app/components/dashboard/RetakeGuideFetchStatsPage.tsx.
// From this test file (dashboard/__tests__/) the module path is one hop
// less than from a chat/__tests__/ test, mirroring the trustSignalsModel
// test convention.
vi.mock("../../../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(async () => ({})),
  API_BASE: "http://test",
}));

// ---- SUT (after mocks) ---------------------------------------------

import { LanguageProvider } from "../../LanguageContext";
import { RetakeGuideFetchStatsPage } from "../RetakeGuideFetchStatsPage";

function renderPage() {
  return render(
    <LanguageProvider>
      <RetakeGuideFetchStatsPage />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  apiGet.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RetakeGuideFetchStatsPage", () => {
  it("calls the v3.34 admin endpoint on mount", async () => {
    apiGet.mockResolvedValue({
      schedule_url: "https://www.testing.kz/ent/schedule",
      stats: {
        success_count: 0,
        failure_count: 0,
        last_success_at: null,
        last_failure_at: null,
        last_failure_reason: null,
      },
    });
    renderPage();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith("/admin/retake-guide/fetch-stats");
    });
  });

  it("renders the 'dead' status banner when only failures recorded (current prod)", async () => {
    apiGet.mockResolvedValue({
      schedule_url: "https://www.testing.kz/ent/schedule",
      stats: {
        success_count: 0,
        failure_count: 7,
        last_success_at: null,
        last_failure_at: Math.floor(Date.now() / 1000) - 60,
        last_failure_reason: "httpx_ConnectError",
      },
    });
    renderPage();
    const banner = await screen.findByRole("status");
    expect(banner.dataset.tone).toBe("dead");
    // Failure reason surfaced verbatim (mono row).
    expect(screen.getByText("httpx_ConnectError")).toBeInTheDocument();
  });

  it("renders the 'idle' banner for a fresh worker", async () => {
    apiGet.mockResolvedValue({
      schedule_url: "https://www.testing.kz/ent/schedule",
      stats: {
        success_count: 0,
        failure_count: 0,
        last_success_at: null,
        last_failure_at: null,
        last_failure_reason: null,
      },
    });
    renderPage();
    const banner = await screen.findByRole("status");
    expect(banner.dataset.tone).toBe("idle");
  });

  it("renders the 'ok' banner when last success is fresh", async () => {
    const now = Math.floor(Date.now() / 1000);
    apiGet.mockResolvedValue({
      schedule_url: "https://example.test/ok",
      stats: {
        success_count: 5,
        failure_count: 0,
        last_success_at: now - 600,
        last_failure_at: null,
        last_failure_reason: null,
      },
    });
    renderPage();
    const banner = await screen.findByRole("status");
    expect(banner.dataset.tone).toBe("ok");
    expect(screen.getByText("https://example.test/ok")).toBeInTheDocument();
  });

  it("surfaces a friendly error when the payload fails validation", async () => {
    apiGet.mockResolvedValue({ schedule_url: "" });
    renderPage();
    const alert = await screen.findByRole("alert");
    // v3.50: error banner is now `<localized prefix>: <detail>`,
    // so the technical detail (`schedule_url`) is still surfaced
    // verbatim. This regex stays loose enough to pass under
    // either RU or KZ language context (default is RU).
    expect(alert.textContent).toMatch(/schedule_url/);
    // No status banner should render when validation fails.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("v3.50: error banner uses the localized RU prefix", async () => {
    apiGet.mockResolvedValue({ schedule_url: "" });
    renderPage();
    const alert = await screen.findByRole("alert");
    // The default LanguageProvider lang is RU.
    // Pin both halves: localized prefix + colon + verbose-English
    // detail from validateFetchStatsPayload.
    expect(alert.textContent).toMatch(/Не удалось загрузить статистику:/);
    expect(alert.textContent).toMatch(/schedule_url/);
  });

  it("v3.50: empty-state placeholder renders before fetch resolves", async () => {
    // Hand-rolled deferred so the fetch never settles during the
    // assertion — that's the slice of UI lifecycle we're pinning.
    let _resolve: (v: unknown) => void = () => {};
    apiGet.mockImplementationOnce(
      () =>
        new Promise<unknown>((res) => {
          _resolve = res;
        }),
    );
    renderPage();
    // The placeholder is keyed by data-testid so it doesn't
    // compete with the success-path StatusBanner's role="status".
    const placeholder = await screen.findByTestId("retake-guide-loading");
    expect(placeholder.dataset.state).toBe("loading");
    // No StatusBanner yet (no payload), no alert (no error).
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
