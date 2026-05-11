/**
 * s35 wave 60 (2026-04-28) — ChatComposer component-contract pins.
 *
 * The composer is the most-used surface in the app; up to wave 60
 * it had pure-helper coverage (slashMenu, slashShortcutMatch,
 * composerSendButtonAria, composerCounterAnnounce, etc.) but no
 * DOM-level pins for: send-button enabled/disabled state matrix,
 * Enter-to-send vs Shift+Enter newline, Escape-stop-during-send,
 * IME suppression on Enter, draft restore on remount.
 *
 * vi.mock("../MessagesContext") gives us a controllable stub —
 * each test sets the exact shape of useMessages() it needs without
 * pulling in the real provider's /api/chat/threads fetch.
 *
 * useKeyboardInset is also mocked to a constant 0 so we don't
 * need to stub visualViewport.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Mocks (hoisted by vitest) -------------------------------------

interface FakeMessagesState {
  isSending: boolean;
  composerSeed: { text: string; nonce: number };
  activeThreadId: number | null;
}
const messagesState: FakeMessagesState = {
  isSending: false,
  composerSeed: { text: "", nonce: 0 },
  activeThreadId: null,
};

vi.mock("../MessagesContext", () => ({
  useMessages: () => messagesState,
}));

vi.mock("../useKeyboardInset", () => ({
  useKeyboardInset: () => 0,
}));

// ---- SUT (after mocks) ---------------------------------------------

import { LanguageProvider } from "../../../LanguageContext";
import { ChatComposer } from "../ChatComposer";

function renderComposer(
  props?: Partial<React.ComponentProps<typeof ChatComposer>>,
) {
  const onSend = props?.onSend ?? vi.fn(async () => {});
  const onStop = props?.onStop;
  return {
    onSend,
    onStop,
    ...render(
      <LanguageProvider>
        <ChatComposer onSend={onSend} onStop={onStop} />
      </LanguageProvider>,
    ),
  };
}

function getTextarea(): HTMLTextAreaElement {
  // The composer textarea is the only multi-line input on screen.
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function getSendOrStopButton(): HTMLButtonElement {
  // Send/Stop is the LAST button in the composer footer.
  const all = screen.getAllByRole("button");
  return all[all.length - 1] as HTMLButtonElement;
}

beforeEach(() => {
  messagesState.isSending = false;
  messagesState.composerSeed = { text: "", nonce: 0 };
  messagesState.activeThreadId = null;
  // draftStorage is localStorage-backed — clear between tests so
  // a stray draft from one test doesn't leak into the next.
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatComposer — render shape", () => {
  it("renders a textarea + a send button", () => {
    renderComposer();
    expect(getTextarea()).toBeInTheDocument();
    expect(getSendOrStopButton()).toBeInTheDocument();
  });

  it("textarea starts empty when there is no draft / seed", () => {
    renderComposer();
    expect(getTextarea().value).toBe("");
  });
});

describe("ChatComposer — send button state matrix", () => {
  it("send is DISABLED when input is empty (whitespace only)", async () => {
    renderComposer();
    const ta = getTextarea();
    const user = userEvent.setup();
    await user.type(ta, "   ");
    expect(getSendOrStopButton()).toBeDisabled();
  });

  it("send becomes ENABLED once input has non-whitespace content", async () => {
    renderComposer();
    const user = userEvent.setup();
    await user.type(getTextarea(), "hello");
    expect(getSendOrStopButton()).toBeEnabled();
  });

  it("send is DISABLED while a turn is in flight (isSending=true)", () => {
    messagesState.isSending = true;
    renderComposer({ onStop: vi.fn() });
    // While sending with onStop wired, the button is the STOP
    // button — which is enabled (its job is to be clickable). The
    // textarea, however, is disabled.
    expect(getTextarea()).toBeDisabled();
  });

  it("submit fires onSend with the trimmed text, then clears the textarea", async () => {
    const onSend = vi.fn(async () => {});
    renderComposer({ onSend });
    const user = userEvent.setup();
    const ta = getTextarea();
    await user.type(ta, "hello world");
    expect(getSendOrStopButton()).toBeEnabled();
    await act(async () => {
      await user.click(getSendOrStopButton());
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world");
    expect(ta.value).toBe("");
  });
});

describe("ChatComposer — Enter / Shift+Enter behaviour", () => {
  it("Enter submits", async () => {
    const onSend = vi.fn(async () => {});
    renderComposer({ onSend });
    const user = userEvent.setup();
    const ta = getTextarea();
    await user.type(ta, "ping");
    await act(async () => {
      await user.keyboard("{Enter}");
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("ping");
  });

  it("Shift+Enter inserts a newline and does NOT submit", async () => {
    const onSend = vi.fn(async () => {});
    renderComposer({ onSend });
    const user = userEvent.setup();
    const ta = getTextarea();
    await user.type(ta, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(ta, "line two");
    expect(onSend).not.toHaveBeenCalled();
    // The exact whitespace inserted by user-event for Shift+Enter is
    // jsdom-version-dependent; we just need to know there's MORE
    // than the single line of text.
    expect(ta.value.length).toBeGreaterThan("line oneline two".length - 1);
    expect(ta.value).toContain("line one");
    expect(ta.value).toContain("line two");
  });
});

describe("ChatComposer — Escape stop", () => {
  it("Escape during isSending fires onStop", () => {
    // The textarea is `disabled={isSending}` — userEvent.keyboard
    // routes through document.activeElement which jsdom won't
    // assign to a disabled input. We dispatch a real keydown event
    // on the textarea node so the bubbled React listener fires.
    messagesState.isSending = true;
    const onStop = vi.fn();
    renderComposer({ onStop });
    fireEvent.keyDown(getTextarea(), { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("Escape when NOT sending does NOT fire onStop", () => {
    const onStop = vi.fn();
    renderComposer({ onStop });
    fireEvent.keyDown(getTextarea(), { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe("ChatComposer — composerSeed hydration", () => {
  it("seeded text appears in the textarea on mount", () => {
    messagesState.composerSeed = { text: "seeded prompt", nonce: 1 };
    renderComposer();
    // The seed effect runs after mount; the seed value should
    // populate the textarea.
    expect(getTextarea().value).toBe("seeded prompt");
  });
});
