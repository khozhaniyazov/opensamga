/**
 * s35 wave 56 (2026-04-28) — StreamCompleteAnnouncer
 * component-contract pins.
 *
 * The pure helpers (`politenessFor`, `announcementMessageFor`) are
 * already pinned in StreamCompleteAnnouncer.test.ts (s32 wave H1).
 * This file proves that the React component actually consumes those
 * helpers and ends up rendering the right DOM:
 *
 *   - The live region exists from first paint with role="status"
 *     and aria-live="polite" (the polite default — no transition
 *     yet).
 *   - On a true → false transition, the SR live-region renders the
 *     "Ответ готов" / "Жауап дайын" text inside (and bumps to
 *     aria-live="assertive").
 *   - After the TTL we clear the text so a remount of an
 *     already-done thread doesn't re-announce.
 *   - Visually-hidden inline styles are present (`width:1px`,
 *     `clip:rect(0,0,0,0)`) so the user never sees the text but
 *     the SR can read it.
 *
 * Why the .contract.test.tsx suffix: keep the pure-helper file
 * untouched (it's referenced by the s32 commit message), and follow
 * the wave-46/48 RTL pattern of separating render-this from
 * pin-the-pure-helper.
 *
 * Mirrors the renderWithLang pattern from GeneralKnowledgePill.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StreamCompleteAnnouncer } from "../StreamCompleteAnnouncer";
import { LanguageProvider } from "../../../LanguageContext";

function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("StreamCompleteAnnouncer — component contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the live-region from first paint with polite default", () => {
    renderWithLang(<StreamCompleteAnnouncer isSending={false} />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    // Empty body initially — no transition has happened yet.
    expect(region.textContent || "").toBe("");
  });

  it("announces 'done' on true → false transition (assertive)", () => {
    const { rerender } = render(
      <LanguageProvider>
        <StreamCompleteAnnouncer isSending />
      </LanguageProvider>,
    );
    // Sanity: while sending, the region is still polite + empty.
    let region = screen.getByRole("status");
    expect(region.textContent || "").toBe("");
    expect(region.getAttribute("aria-live")).toBe("polite");

    // Flip true → false. This is the announcement gate.
    rerender(
      <LanguageProvider>
        <StreamCompleteAnnouncer isSending={false} />
      </LanguageProvider>,
    );

    region = screen.getByRole("status");
    // Either RU or KZ default — the helper picks based on lang
    // context. RU is the default LanguageProvider locale, but we
    // tolerate either copy so a future flip of the default doesn't
    // false-alarm the test.
    const txt = region.textContent || "";
    expect(txt === "Ответ готов" || txt === "Жауап дайын").toBe(true);
    expect(region.getAttribute("aria-live")).toBe("assertive");
  });

  it("clears the announcement after TTL (no re-announce on remount)", () => {
    const { rerender } = render(
      <LanguageProvider>
        <StreamCompleteAnnouncer isSending ttlMs={50} />
      </LanguageProvider>,
    );
    rerender(
      <LanguageProvider>
        <StreamCompleteAnnouncer isSending={false} ttlMs={50} />
      </LanguageProvider>,
    );

    const regionAfter = screen.getByRole("status");
    expect((regionAfter.textContent || "").length).toBeGreaterThan(0);

    // Advance past the TTL — text should clear.
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByRole("status").textContent || "").toBe("");
  });

  it("is visually hidden via inline styles (sr-only without tailwind)", () => {
    renderWithLang(<StreamCompleteAnnouncer isSending={false} />);
    const region = screen.getByRole("status");
    const style = region.style;
    // Check the load-bearing visual-hiding properties. We don't
    // pin every single style key — just enough to prove the
    // sr-only-without-tailwind technique is intact.
    expect(style.width).toBe("1px");
    expect(style.height).toBe("1px");
    expect(style.position).toBe("absolute");
    expect(style.overflow).toBe("hidden");
  });

  it("does not announce when prev is null on idle first mount", () => {
    // Reopen-a-finished-thread case. Mount with isSending=false
    // straight away; prevIsSendingRef starts as null. The pure
    // helper returns "" for this transition, and the component
    // must respect that.
    renderWithLang(<StreamCompleteAnnouncer isSending={false} />);
    expect(screen.getByRole("status").textContent || "").toBe("");
  });
});
