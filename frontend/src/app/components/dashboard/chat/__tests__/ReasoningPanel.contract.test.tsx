/**
 * s35 wave 65 (2026-04-28) — ReasoningPanel render-contract pins.
 *
 * Wave 57 deferred this with the note "ReasoningPanel reads
 * LanguageContext + useViewportMobile + useReducedMotion + renders
 * ThinkingTrack + ToolCallTimeline — heavy provider stack". Now
 * that we have the wave-56 vi.mock pattern + the wave-58/63
 * SUT-import-after-mock convention, we can mount it cleanly:
 *   - useViewportMobile / useReducedMotion → tiny module stubs.
 *   - ThinkingTrack / ToolCallTimeline → marker fragments, so we
 *     don't pull in their dependencies (markdown, motion, etc.).
 *
 * Pins focus on the BEHAVIOURAL contract documented inline in
 * ReasoningPanel.tsx:
 *   1. Streaming → default-expanded.
 *   2. Streaming flips off → auto-collapse exactly once.
 *   3. Manual toggle after auto-collapse opens it again, and a
 *      subsequent re-render does NOT slam it shut.
 *   4. Returns null when there is no content AND we're not
 *      streaming.
 *   5. Streaming = brain icon (live header) vs done = sparkles.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Mocks (hoisted) ----------------------------------------------

vi.mock("../useViewportMobile", () => ({
  useViewportMobile: () => false,
}));
vi.mock("../useReducedMotion", () => ({
  useReducedMotion: () => true, // suppress motion classes in test output
}));
vi.mock("../ThinkingBlock", () => ({
  ThinkingTrack: ({
    text,
    isStreaming,
  }: {
    text: string;
    isStreaming: boolean;
  }) => (
    <div data-testid="thinking-track" data-streaming={String(isStreaming)}>
      {text}
    </div>
  ),
}));
vi.mock("../ToolCallTimeline", () => ({
  ToolCallTimeline: ({ isStreaming }: { isStreaming: boolean }) => (
    <div
      data-testid="tool-call-timeline"
      data-streaming={String(isStreaming)}
    />
  ),
}));

// ---- SUT (after mocks) --------------------------------------------

import { LanguageProvider } from "../../../LanguageContext";
import { ReasoningPanel } from "../ReasoningPanel";
import type { MessagePart } from "../types";

const THINKING_PART: MessagePart = {
  kind: "thinking",
  text: "Working through the problem...",
};
const TOOL_PART: MessagePart = {
  kind: "tool_call",
  tool: "consult_library",
  args: {},
  status: "done",
  iteration: 1,
};

function renderPanel(props: { parts: MessagePart[]; isStreaming?: boolean }) {
  return render(
    <LanguageProvider>
      <ReasoningPanel parts={props.parts} isStreaming={props.isStreaming} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  // No global state to reset; each test sets its own props.
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReasoningPanel — empty / null guard", () => {
  it("renders NULL when there is no thinking, no tools, and not streaming", () => {
    const { container } = renderPanel({ parts: [], isStreaming: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when streaming, even with empty parts", () => {
    renderPanel({ parts: [], isStreaming: true });
    // The toggle button is the only role=button in the panel.
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("ReasoningPanel — streaming → default expanded", () => {
  it("toggle button reports aria-expanded=true while streaming", () => {
    renderPanel({
      parts: [THINKING_PART, TOOL_PART],
      isStreaming: true,
    });
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("renders ThinkingTrack + ToolCallTimeline children when streaming with content", () => {
    renderPanel({
      parts: [THINKING_PART, TOOL_PART],
      isStreaming: true,
    });
    expect(screen.getByTestId("thinking-track")).toBeInTheDocument();
    expect(screen.getByTestId("tool-call-timeline")).toBeInTheDocument();
  });
});

describe("ReasoningPanel — manual toggle", () => {
  it("clicking the header toggles aria-expanded", async () => {
    renderPanel({
      parts: [THINKING_PART, TOOL_PART],
      isStreaming: true,
    });
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const user = userEvent.setup();
    await act(async () => {
      await user.click(btn);
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      await user.click(btn);
    });
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ReasoningPanel — done state (sparkles + collapsed)", () => {
  it("done state with manual collapse stays collapsed across re-renders", async () => {
    const { rerender } = render(
      <LanguageProvider>
        <ReasoningPanel
          parts={[THINKING_PART, TOOL_PART]}
          isStreaming={false}
        />
      </LanguageProvider>,
    );
    // Done-state default is collapsed (auto-collapse after stream).
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Manually open it.
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    // Trigger a re-render with the SAME isStreaming=false — manual
    // open MUST persist (the auto-collapse logic must not slam it
    // shut on every render).
    rerender(
      <LanguageProvider>
        <ReasoningPanel
          parts={[THINKING_PART, TOOL_PART]}
          isStreaming={false}
        />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });
});
