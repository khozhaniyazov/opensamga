/**
 * s35 wave 58 (2026-04-28) — MessageActions component-contract pins.
 *
 * MessageActions is the per-message Copy + Regenerate row under
 * every assistant bubble. Up to wave 58 it had pure-helper coverage
 * (cleanForCopy / messageActionsLabels / messageCopiedAnnouncement /
 * regenerateButtonAria) but no test that asserted the real DOM —
 * which buttons render, when Regenerate is disabled, what the
 * split-menu chevron exposes.
 *
 * The wave-46 RTL pattern + the wave-56 vi.mock("../MessagesContext")
 * trick combine cleanly here: MessageActions reads useMessages()
 * to derive `isTail` and `priorUser`. We mock that with a
 * controlled stub so each test sets up the exact transcript shape
 * it cares about.
 *
 * Clipboard is also stubbed via vi.spyOn so we don't depend on
 * jsdom's permissions handling (which varies per node version).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../../LanguageContext";
import type { Message } from "../types";

const messagesState: { messages: Message[] } = { messages: [] };
vi.mock("../MessagesContext", () => ({
  useMessages: () => messagesState,
}));

// SUT after the mock declaration.
import { MessageActions } from "../MessageActions";

const ASSISTANT_TAIL: Message = {
  id: "a1",
  role: "assistant",
  text: "Hello, here is the answer.",
};
const USER_PRIOR: Message = {
  id: "u1",
  role: "user",
  text: "What's the answer?",
};

function renderActions(
  message: Message,
  onRegenerate: (s: string) => void = () => {},
) {
  return render(
    <LanguageProvider>
      <MessageActions message={message} onRegenerate={onRegenerate} />
    </LanguageProvider>,
  );
}

describe("MessageActions — component contract", () => {
  beforeEach(() => {
    messagesState.messages = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Copy + chevron + Regenerate buttons", () => {
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    // 4 buttons total: Copy main, chevron split, Regenerate, plus
    // any menuitems... before opening the menu, just 3.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);
    // The first should be the Copy main action — its icon-only
    // shape means we identify by aria-label resolution.
    expect(buttons[0]).toHaveAttribute("aria-label");
    expect(buttons[1]).toHaveAttribute("aria-haspopup", "menu");
    expect(buttons[1]).toHaveAttribute("aria-expanded", "false");
  });

  it("disables Regenerate when this is NOT the tail message", () => {
    // Simulate: the assistant message we're rendering is not the
    // last in the transcript. canRegen is false → Regenerate
    // disabled.
    const otherTail: Message = { id: "a2", role: "assistant", text: "Newer" };
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL, otherTail];
    renderActions(ASSISTANT_TAIL);
    const regen = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("title")?.length && b.querySelector("svg"));
    // Regen is the LAST button — match by index since it's icon-only.
    const buttons = screen.getAllByRole("button");
    const regenBtn = buttons[buttons.length - 1];
    expect(regenBtn).toBeDisabled();
  });

  it("enables Regenerate when tail AND prior is user", () => {
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    const buttons = screen.getAllByRole("button");
    const regenBtn = buttons[buttons.length - 1];
    expect(regenBtn).toBeEnabled();
  });

  it("disables Regenerate when prior is NOT a user turn", () => {
    // Two assistant messages in a row (theoretical — system seeded
    // a greeting then the answer, no user prompt in between).
    const seedAssistant: Message = {
      id: "a0",
      role: "assistant",
      text: "Hello, ask me anything.",
    };
    messagesState.messages = [seedAssistant, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    const buttons = screen.getAllByRole("button");
    const regenBtn = buttons[buttons.length - 1];
    expect(regenBtn).toBeDisabled();
  });

  it("clicking Regenerate fires onRegenerate with the prior user text", async () => {
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    const onRegen = vi.fn();
    renderActions(ASSISTANT_TAIL, onRegen);
    const user = userEvent.setup();
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(onRegen).toHaveBeenCalledTimes(1);
    expect(onRegen).toHaveBeenCalledWith(USER_PRIOR.text);
  });

  it("clicking the chevron opens a menu with two copy-format items", async () => {
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    const user = userEvent.setup();
    const chevron = screen.getAllByRole("button")[1];
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await user.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    // Menu role + 2 menuitems (markdown + plain).
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(2);
  });

  it("Escape closes the open copy-format menu", async () => {
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    const user = userEvent.setup();
    const chevron = screen.getAllByRole("button")[1];
    await user.click(chevron);
    expect(screen.queryByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("Copy main button toggles copied-state styling after click", async () => {
    // Stub navigator.clipboard.writeText so the primary path
    // resolves cleanly. jsdom's clipboard surface varies across
    // versions — defining it explicitly is the safe play.
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderActions(ASSISTANT_TAIL);
    const user = userEvent.setup();
    const copyBtn = screen.getAllByRole("button")[0];
    await act(async () => {
      await user.click(copyBtn);
    });
    // The button picked up the emerald-tint class — the visible
    // confirmation. This proves the writeClipboard happy path
    // executed end-to-end (any failure would skip the setCopied).
    expect(copyBtn.className).toMatch(/!bg-emerald-50/);
  });

  it("regenerate button has a state-aware aria-label", () => {
    // Enabled — aria-label should be the regular regenerate label.
    messagesState.messages = [USER_PRIOR, ASSISTANT_TAIL];
    const { unmount } = renderActions(ASSISTANT_TAIL);
    let buttons = screen.getAllByRole("button");
    const aria = buttons[buttons.length - 1].getAttribute("aria-label") || "";
    expect(aria.length).toBeGreaterThan(0);
    unmount();

    // Disabled (no prior user) — aria-label folds in the reason.
    const seedAssistant: Message = {
      id: "a0",
      role: "assistant",
      text: "Hello.",
    };
    messagesState.messages = [seedAssistant, ASSISTANT_TAIL];
    renderActions(ASSISTANT_TAIL);
    buttons = screen.getAllByRole("button");
    const ariaDisabled =
      buttons[buttons.length - 1].getAttribute("aria-label") || "";
    // Pin: the disabled aria differs from the enabled aria. The
    // exact copy lives in regenerateButtonAria.ts and is pinned
    // there; we only need to know they're not byte-identical.
    expect(ariaDisabled).not.toBe(aria);
  });
});
