/**
 * s35 wave 56 (2026-04-28) — UnverifiedScoreClaimAnnouncer contract.
 *
 * Pure helpers `containsUnverifiedScoreClaim` /
 * `shouldAnnounceUnverifiedScoreClaim` /
 * `unverifiedScoreClaimAnnouncementText` are pinned in their own
 * file. This proves the React component:
 *   - mounts as role="status" + aria-live="polite" (vs the
 *     NetworkError's assertive — score claims don't interrupt
 *     mid-read).
 *   - reads the trailing assistant message via useMessages and
 *     fires when the body matches the unverified-score predicate.
 *   - skips announcement when the agent loop already redacted
 *     score-shaped sentences (unverifiedScoreClaimsRedacted > 0).
 *   - clears after TTL.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../../LanguageContext";

const messagesState: {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    isError?: boolean;
    unverifiedScoreClaimsRedacted?: number | null;
  }>;
} = { messages: [] };

vi.mock("../MessagesContext", () => ({
  useMessages: () => messagesState,
}));

import { UnverifiedScoreClaimAnnouncer } from "../UnverifiedScoreClaimAnnouncer";

// A textbook score-claim shape. The pure
// `containsUnverifiedScoreClaim` predicate looks for a 2nd-person
// pronoun + a score-shaped number; we use copy that satisfies both.
// (The exact regex is in unverifiedScoreClaimAnnouncement.ts; we
// don't import the predicate here on purpose — we want the test to
// exercise the COMPONENT consuming it, not the predicate alone.)
const SCORE_CLAIM_RU = "Ваш балл 124 достаточен для гранта.";

function renderAnnouncer() {
  return render(
    <LanguageProvider>
      <UnverifiedScoreClaimAnnouncer ttlMs={50} />
    </LanguageProvider>,
  );
}

describe("UnverifiedScoreClaimAnnouncer — component contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messagesState.messages = [];
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders an empty polite live-region by default", () => {
    renderAnnouncer();
    const region = screen.getByTestId("unverified-score-claim-announcer");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent || "").toBe("");
  });

  it("announces on a trailing assistant message that matches the score-claim shape", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "Какой у меня балл?" },
      { id: "a1", role: "assistant", text: SCORE_CLAIM_RU },
    ];
    renderAnnouncer();
    const region = screen.getByTestId("unverified-score-claim-announcer");
    expect((region.textContent || "").length).toBeGreaterThan(0);
  });

  it("does NOT announce when the agent already redacted (unverifiedScoreClaimsRedacted > 0)", () => {
    messagesState.messages = [
      {
        id: "a1",
        role: "assistant",
        text: SCORE_CLAIM_RU,
        unverifiedScoreClaimsRedacted: 1,
      },
    ];
    renderAnnouncer();
    expect(
      screen.getByTestId("unverified-score-claim-announcer").textContent || "",
    ).toBe("");
  });

  it("does NOT announce on a trailing error bubble (NetworkError owns that)", () => {
    messagesState.messages = [
      {
        id: "a1",
        role: "assistant",
        text: SCORE_CLAIM_RU,
        isError: true,
      },
    ];
    renderAnnouncer();
    // Error-flagged assistant bubbles are skipped by the announcer
    // even if they happen to contain a score claim. Stops the
    // SR from getting two simultaneous cues.
    expect(
      screen.getByTestId("unverified-score-claim-announcer").textContent || "",
    ).toBe("");
  });

  it("does NOT announce on user-only history (no trailing assistant turn)", () => {
    messagesState.messages = [{ id: "u1", role: "user", text: SCORE_CLAIM_RU }];
    renderAnnouncer();
    expect(
      screen.getByTestId("unverified-score-claim-announcer").textContent || "",
    ).toBe("");
  });

  it("clears after TTL", () => {
    messagesState.messages = [
      { id: "a1", role: "assistant", text: SCORE_CLAIM_RU },
    ];
    renderAnnouncer();
    expect(
      (screen.getByTestId("unverified-score-claim-announcer").textContent || "")
        .length,
    ).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(
      screen.getByTestId("unverified-score-claim-announcer").textContent || "",
    ).toBe("");
  });
});
