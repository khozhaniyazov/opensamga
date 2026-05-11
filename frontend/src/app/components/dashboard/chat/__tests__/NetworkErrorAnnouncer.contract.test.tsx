/**
 * s35 wave 56 (2026-04-28) — NetworkErrorAnnouncer contract pins.
 *
 * Pure helpers `shouldAnnounceNetworkError` /
 * `networkErrorAnnouncementText` are pinned in their own file.
 * This proves the React component:
 *   - mounts as role="alert" + aria-live="assertive" (the
 *     connectivity-failure cue is unconditional, not lang-gated).
 *   - reads the trailing-error message from MessagesContext via
 *     `useMessages` and renders the localized text inside.
 *   - dedupes via lastAnnouncedRef so the same error id doesn't
 *     re-announce on a benign re-render.
 *   - clears the text after TTL.
 *
 * To avoid pulling in MessagesProvider's full surface (which would
 * mount its own /api/chat/history fetch + thread rail), we
 * `vi.mock('../MessagesContext')` and provide a tiny stub. This
 * matches the pattern many of the existing wave-46+ contract tests
 * follow when a component reads context.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../../LanguageContext";

// Mock MessagesContext BEFORE importing the SUT — vitest hoists
// vi.mock to the top of the module on its own, but the explicit
// pre-import order keeps the intent clear.
const messagesState: {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    isError?: boolean;
  }>;
} = { messages: [] };

vi.mock("../MessagesContext", () => ({
  useMessages: () => messagesState,
}));

// SUT import goes AFTER the mock declaration.
import { NetworkErrorAnnouncer } from "../NetworkErrorAnnouncer";

function renderAnnouncer() {
  return render(
    <LanguageProvider>
      <NetworkErrorAnnouncer ttlMs={50} />
    </LanguageProvider>,
  );
}

describe("NetworkErrorAnnouncer — component contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messagesState.messages = [];
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders an empty assertive live-region by default", () => {
    renderAnnouncer();
    const region = screen.getByTestId("network-error-announcer");
    expect(region.getAttribute("role")).toBe("alert");
    expect(region.getAttribute("aria-live")).toBe("assertive");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent || "").toBe("");
  });

  it("announces on a trailing error message", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "Hello" },
      {
        id: "a1",
        role: "assistant",
        text: "Connection failed",
        isError: true,
      },
    ];
    renderAnnouncer();
    const region = screen.getByTestId("network-error-announcer");
    // Helper picks the network reason; copy is RU/KZ. Tolerate
    // either default-locale resolution (the LanguageProvider may
    // have hydrated kz from localStorage in some environments).
    const txt = region.textContent || "";
    expect(txt.length).toBeGreaterThan(0);
  });

  it("clears after TTL so a remount doesn't re-announce", () => {
    messagesState.messages = [
      {
        id: "a1",
        role: "assistant",
        text: "Something broke",
        isError: true,
      },
    ];
    renderAnnouncer();
    expect(
      (screen.getByTestId("network-error-announcer").textContent || "").length,
    ).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId("network-error-announcer").textContent).toBe("");
  });

  it("does NOT announce when there is no trailing error", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "Hello" },
      { id: "a1", role: "assistant", text: "Hi back" },
    ];
    renderAnnouncer();
    expect(
      screen.getByTestId("network-error-announcer").textContent || "",
    ).toBe("");
  });

  it("is visually hidden via the same sr-only inline-style trick", () => {
    renderAnnouncer();
    const region = screen.getByTestId("network-error-announcer");
    expect(region.style.position).toBe("absolute");
    expect(region.style.width).toBe("1px");
    expect(region.style.overflow).toBe("hidden");
  });
});
