/**
 * s35 wave 66 (2026-04-28) — ChatTranscript render-contract pins.
 *
 * The transcript is the last unpinned big component. We mount it
 * by stubbing the heavy children as marker fragments (wave 65
 * pattern × 6 components) + vi.mock("../MessagesContext") for
 * controllable transcript state.
 *
 * The pins focus on the BRANCHING contract:
 *   1. Empty messages array → ChatEmptyState rendered, not the log.
 *   2. Non-empty → log live-region rendered with correct aria.
 *   3. Role-based row routing: user → UserMessageRow (mocked),
 *      assistant → AssistantMessageRow (mocked), error → inline
 *      AlertCircle + Retry button.
 *   4. Streaming + lastIsUser → typing indicator visible.
 *   5. The 3 SR announcers (StreamComplete / NetworkError /
 *      UnverifiedScoreClaim) are always rendered as siblings of
 *      the log, not nested inside it.
 *
 * We do NOT pin: scroll-to-bottom geometry (jsdom doesn't compute
 * scrollHeight reliably), animation frames (rAF semantics), or
 * the auto-scroll-on-stream behaviour — those are exercised by the
 * pure helpers (transcriptLogAria, messageItemAria,
 * messageVirtualization) plus the ScrollToBottomPill suite.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- Mocks (hoisted) ----------------------------------------------

interface FakeMessagesState {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    isError?: boolean;
    retryPrompt?: string;
  }>;
  isSending: boolean;
  removeMessage: (id: string) => void;
  truncateFrom: (id: string) => void;
  seedComposer: (text: string) => void;
}
const messagesState: FakeMessagesState = {
  messages: [],
  isSending: false,
  removeMessage: vi.fn(),
  truncateFrom: vi.fn(),
  seedComposer: vi.fn(),
};

vi.mock("../MessagesContext", () => ({
  useMessages: () => messagesState,
}));

vi.mock("../useReducedMotion", () => ({
  useReducedMotion: () => true,
}));

// Heavy children → marker fragments (wave-65 trick).
vi.mock("../AssistantMessageRow", () => ({
  AssistantMessageRow: ({
    message,
  }: {
    message: { id: string; text: string };
  }) => (
    <div data-testid="assistant-row" data-id={message.id}>
      {message.text}
    </div>
  ),
}));
vi.mock("../UserMessageRow", () => ({
  UserMessageRow: ({ text }: { text: string }) => (
    <div data-testid="user-row">{text}</div>
  ),
}));
vi.mock("../ChatEmptyState", () => ({
  ChatEmptyState: ({ onPick }: { onPick: (s: string) => void }) => (
    <div data-testid="empty-state">
      <button onClick={() => onPick("starter prompt")}>pick</button>
    </div>
  ),
}));
vi.mock("../ScrollToBottomPill", () => ({
  ScrollToBottomPill: () => <div data-testid="scroll-pill" />,
}));
vi.mock("../StreamCompleteAnnouncer", () => ({
  StreamCompleteAnnouncer: ({ isSending }: { isSending: boolean }) => (
    <div data-testid="announcer-stream" data-sending={String(isSending)} />
  ),
}));
vi.mock("../NetworkErrorAnnouncer", () => ({
  NetworkErrorAnnouncer: () => <div data-testid="announcer-network" />,
}));
vi.mock("../UnverifiedScoreClaimAnnouncer", () => ({
  UnverifiedScoreClaimAnnouncer: () => (
    <div data-testid="announcer-unverified" />
  ),
}));

// ---- SUT (after mocks) --------------------------------------------

import { LanguageProvider } from "../../../LanguageContext";
import { ChatTranscript } from "../ChatTranscript";

function renderTranscript(
  props?: Partial<React.ComponentProps<typeof ChatTranscript>>,
) {
  return render(
    <LanguageProvider>
      <ChatTranscript
        onPickStarter={props?.onPickStarter ?? vi.fn()}
        onStop={props?.onStop ?? vi.fn()}
        onRegenerate={props?.onRegenerate ?? vi.fn()}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  messagesState.messages = [];
  messagesState.isSending = false;
  messagesState.removeMessage = vi.fn();
  messagesState.truncateFrom = vi.fn();
  messagesState.seedComposer = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatTranscript — empty branch", () => {
  it("renders ChatEmptyState when there are no messages", () => {
    renderTranscript();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("user-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-row")).not.toBeInTheDocument();
  });

  it("clicking a starter forwards to onPickStarter", async () => {
    const onPickStarter = vi.fn();
    renderTranscript({ onPickStarter });
    screen.getByText("pick").click();
    expect(onPickStarter).toHaveBeenCalledTimes(1);
    expect(onPickStarter).toHaveBeenCalledWith("starter prompt");
  });
});

describe("ChatTranscript — sibling SR announcers", () => {
  it("renders all 3 announcers regardless of message state", () => {
    renderTranscript();
    expect(screen.getByTestId("announcer-stream")).toBeInTheDocument();
    expect(screen.getByTestId("announcer-network")).toBeInTheDocument();
    expect(screen.getByTestId("announcer-unverified")).toBeInTheDocument();
  });

  it("StreamComplete announcer receives the live isSending prop", () => {
    messagesState.isSending = true;
    messagesState.messages = [{ id: "u1", role: "user", text: "ping" }];
    renderTranscript();
    expect(
      screen.getByTestId("announcer-stream").getAttribute("data-sending"),
    ).toBe("true");
  });

  it("announcers are NOT nested inside the log live-region (sibling pattern)", () => {
    renderTranscript();
    const log = screen.getByRole("log");
    expect(log.contains(screen.getByTestId("announcer-stream"))).toBe(false);
    expect(log.contains(screen.getByTestId("announcer-network"))).toBe(false);
    expect(log.contains(screen.getByTestId("announcer-unverified"))).toBe(
      false,
    );
  });
});

describe("ChatTranscript — role-based row routing", () => {
  it("user message → UserMessageRow", () => {
    messagesState.messages = [{ id: "u1", role: "user", text: "What is 2+2?" }];
    renderTranscript();
    expect(screen.getByTestId("user-row")).toHaveTextContent("What is 2+2?");
    expect(screen.queryByTestId("assistant-row")).not.toBeInTheDocument();
  });

  it("assistant message → AssistantMessageRow", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "What is 2+2?" },
      { id: "a1", role: "assistant", text: "Four." },
    ];
    renderTranscript();
    expect(screen.getByTestId("user-row")).toHaveTextContent("What is 2+2?");
    expect(screen.getByTestId("assistant-row")).toHaveTextContent("Four.");
  });

  it("error message → inline error block with role=alert (NOT AssistantMessageRow)", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "What is 2+2?" },
      {
        id: "e1",
        role: "assistant",
        text: "Network failed.",
        isError: true,
        retryPrompt: "What is 2+2?",
      },
    ];
    renderTranscript();
    expect(screen.queryByTestId("assistant-row")).not.toBeInTheDocument();
    // Error block uses role="alert".
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Network failed.");
  });

  it("error message with retryPrompt renders a Retry button", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "ping" },
      {
        id: "e1",
        role: "assistant",
        text: "Network failed.",
        isError: true,
        retryPrompt: "ping",
      },
    ];
    renderTranscript();
    // The Retry button is the only button inside the alert region.
    const alert = screen.getByRole("alert");
    const retryBtn = alert.querySelector("button");
    expect(retryBtn).not.toBeNull();
  });

  it("error message WITHOUT retryPrompt does NOT render a Retry button", () => {
    messagesState.messages = [
      { id: "u1", role: "user", text: "ping" },
      {
        id: "e1",
        role: "assistant",
        text: "Network failed (no retry available).",
        isError: true,
      },
    ];
    renderTranscript();
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("button")).toBeNull();
  });
});

describe("ChatTranscript — log region aria", () => {
  it("log region has role=log + aria-label + aria-live=polite", () => {
    messagesState.messages = [{ id: "u1", role: "user", text: "ping" }];
    renderTranscript();
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-label");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-relevant", "additions text");
  });

  it("log region's aria-label is count-aware (changes with message count)", () => {
    messagesState.messages = [];
    const { rerender } = renderTranscript();
    const empty = screen.getByRole("log").getAttribute("aria-label");

    messagesState.messages = [
      { id: "u1", role: "user", text: "ping" },
      { id: "a1", role: "assistant", text: "pong" },
    ];
    rerender(
      <LanguageProvider>
        <ChatTranscript
          onPickStarter={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
        />
      </LanguageProvider>,
    );
    const populated = screen.getByRole("log").getAttribute("aria-label");
    expect(empty).not.toBe(populated);
  });
});

describe("ChatTranscript — typing indicator (streaming + tail user)", () => {
  it("renders the Stop button when isSending AND last message is user", () => {
    messagesState.isSending = true;
    messagesState.messages = [{ id: "u1", role: "user", text: "ping" }];
    renderTranscript();
    // The typing indicator branch (`isSending && lastIsUser`) is
    // the only place the transcript renders a Stop button — every
    // other path delegates Stop to AssistantMessageRow's footer.
    // Pin: when both conditions hold, exactly one button is in the
    // DOM (the Stop button).
    expect(screen.queryAllByRole("button").length).toBe(1);
  });

  it("does NOT render the Stop button when isSending=false", () => {
    messagesState.isSending = false;
    messagesState.messages = [{ id: "u1", role: "user", text: "ping" }];
    renderTranscript();
    expect(screen.queryAllByRole("button").length).toBe(0);
  });

  it("does NOT render the Stop button when last message is assistant (regardless of isSending)", () => {
    // After the assistant turn lands, we should NOT keep the
    // typing indicator visible — that branch is gated on
    // lastIsUser.
    messagesState.isSending = true;
    messagesState.messages = [
      { id: "u1", role: "user", text: "ping" },
      { id: "a1", role: "assistant", text: "pong" },
    ];
    renderTranscript();
    expect(screen.queryAllByRole("button").length).toBe(0);
  });
});
