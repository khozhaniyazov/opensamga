/**
 * s35 wave 63 (2026-04-28) — FeedbackButtons component-contract pins.
 *
 * Up to wave 63 the feedback row had pure-helper coverage
 * (feedbackButtonAriaLabel, feedbackReasonChipAria,
 * feedbackPopoverDialogAria, feedbackReasons) but no DOM-level
 * pins for the actual click flow: thumbs-up POSTs the rating,
 * thumbs-down opens the reason popover, the popover Send button
 * stays disabled until either a reason chip or text is provided,
 * Escape closes the popover, etc.
 *
 * Unlike MessageActions/ChatComposer, FeedbackButtons does NOT
 * read MessagesContext — only useLang. We mock `apiPost` so the
 * network call is observable without triggering real fetch.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Mocks (hoisted) -----------------------------------------------

const apiPost = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({}),
);
// vi.mock resolves the specifier relative to the FILE THAT CALLS
// IT (this test file), not relative to the importer. The SUT uses
// `"../../../lib/api"` from FeedbackButtons.tsx (chat/ → ../ → ../
// → ../ = app/). From this test file (chat/__tests__/) the same
// module is `"../../../../lib/api"` (one extra hop out of __tests__).
vi.mock("../../../../lib/api", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: vi.fn(async () => ({})),
  API_BASE: "http://test",
}));

// ---- SUT (after mocks) ---------------------------------------------

import { LanguageProvider } from "../../../LanguageContext";
import { FeedbackButtons } from "../FeedbackButtons";

function renderFB(
  props?: Partial<React.ComponentProps<typeof FeedbackButtons>>,
) {
  return render(
    <LanguageProvider>
      <FeedbackButtons
        messageId={props?.messageId ?? "msg-1"}
        ragQueryLogId={props?.ragQueryLogId ?? 42}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  apiPost.mockClear();
  apiPost.mockImplementation(async () => ({}));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("FeedbackButtons — render shape", () => {
  it("renders thumbs-up + thumbs-down buttons (no popover at rest)", () => {
    renderFB();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("both thumbs buttons start with aria-pressed=false", () => {
    renderFB();
    const [up, down] = screen.getAllByRole("button");
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");
  });
});

describe("FeedbackButtons — thumbs up", () => {
  it("clicking thumbs-up POSTs rating=1 with the message + rag_query_log ids", async () => {
    renderFB({ messageId: "msg-7", ragQueryLogId: 99 });
    const user = userEvent.setup();
    const [up] = screen.getAllByRole("button");
    await act(async () => {
      await user.click(up);
    });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/feedback/chat", {
      message_id: "msg-7",
      rating: 1,
      rag_query_log_id: 99,
    });
  });

  it("after thumbs-up, the up button reflects aria-pressed=true", async () => {
    renderFB();
    const user = userEvent.setup();
    const buttons = screen.getAllByRole("button");
    await act(async () => {
      await user.click(buttons[0]);
    });
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    // Down button is unaffected.
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking thumbs-up TWICE toggles the rating off (rating=0 on the 2nd POST)", async () => {
    renderFB();
    const user = userEvent.setup();
    const [up] = screen.getAllByRole("button");
    await act(async () => {
      await user.click(up);
    });
    await act(async () => {
      await user.click(up);
    });
    expect(apiPost).toHaveBeenCalledTimes(2);
    const secondCall = apiPost.mock.calls[1]?.[1] as { rating: number };
    expect(secondCall.rating).toBe(0);
  });
});

describe("FeedbackButtons — thumbs down + reason popover", () => {
  it("clicking thumbs-down opens the reason popover", async () => {
    renderFB();
    const user = userEvent.setup();
    const [, down] = screen.getAllByRole("button");
    await act(async () => {
      await user.click(down);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The dialog has an accessible name (one of the
    // feedbackPopoverDialogAria-resolved strings).
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label");
  });

  it("popover Send button is DISABLED until a reason chip OR text is provided", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    // Send is the LAST visible button in the dialog at this state.
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const sendBtn = dialogButtons[dialogButtons.length - 1];
    expect(sendBtn).toBeDisabled();
  });

  it("Escape closes the popover", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the X close button closes the popover", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    // First button inside the dialog is the X close icon.
    await act(async () => {
      await user.click(dialogButtons[0]);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("typing in the comment textarea enables Send", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "neispravlennaya formula");
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const sendBtn = dialogButtons[dialogButtons.length - 1];
    expect(sendBtn).toBeEnabled();
  });

  it("when comment POST fails, popover STAYS open with role='alert' (no fake 'Спасибо')", async () => {
    // v3.78 (2026-05-03) regression pin. Pre-v3.78 a failed
    // second POST set submittedComment=true and auto-closed the
    // popover, showing the green "Спасибо, мы прочитаем" pill.
    // The user walked away believing the comment was recorded
    // when it wasn't. Now the popover keeps the form visible
    // with an inline alert.
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    expect(apiPost).toHaveBeenCalledTimes(1); // initial -1 POST succeeded
    // Make the NEXT POST fail.
    apiPost.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "kommentariy");
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const sendBtn = dialogButtons[dialogButtons.length - 1];
    await act(async () => {
      await user.click(sendBtn);
    });
    // Popover is still open and the form is still visible.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    // Inline error region with role=alert.
    const alert = screen.getByTestId("feedback-comment-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toBeTruthy();
    // The success-styled "Спасибо, мы прочитаем" / "Рақмет, біз
    // оқимыз" pill is NOT shown.
    expect(screen.queryByText(/Спасибо, мы прочитаем/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Рақмет, біз оқимыз/)).not.toBeInTheDocument();
  });

  it("after a failed POST the user can retry; success closes the popover and shows 'Спасибо'", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    apiPost.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "kommentariy");
    let dialog = screen.getByRole("dialog");
    let dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    let sendBtn = dialogButtons[dialogButtons.length - 1];
    await act(async () => {
      await user.click(sendBtn);
    });
    // First retry click: alert is visible, Send is re-enabled (no
    // longer busy, reason/comment still satisfy the gate).
    expect(screen.getByTestId("feedback-comment-error")).toBeInTheDocument();
    dialog = screen.getByRole("dialog");
    dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    sendBtn = dialogButtons[dialogButtons.length - 1];
    expect(sendBtn).toBeEnabled();
    // Second click succeeds (default mock returns {}).
    await act(async () => {
      await user.click(sendBtn);
    });
    // Now the success-styled pill renders inside the still-open
    // dialog (the dialog auto-closes ~800ms later via setTimeout
    // which we don't advance here).
    expect(screen.getByText(/Спасибо, мы прочитаем/)).toBeInTheDocument();
    // 3 POSTs total: initial -1, failed comment, retry comment.
    expect(apiPost).toHaveBeenCalledTimes(3);
  });

  it("typing in the textarea after a failed POST clears the alert", async () => {
    renderFB();
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    apiPost.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "abc");
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const sendBtn = dialogButtons[dialogButtons.length - 1];
    await act(async () => {
      await user.click(sendBtn);
    });
    expect(screen.getByTestId("feedback-comment-error")).toBeInTheDocument();
    // One more keystroke — error clears.
    await user.type(textarea, "x");
    expect(
      screen.queryByTestId("feedback-comment-error"),
    ).not.toBeInTheDocument();
  });

  it("submitting the comment fires a SECOND POST with rating=-1 + comment", async () => {
    renderFB({ messageId: "msg-9" });
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getAllByRole("button")[1]);
    });
    expect(apiPost).toHaveBeenCalledTimes(1); // initial -1 POST
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "kommentariy");
    const dialog = screen.getByRole("dialog");
    const dialogButtons = Array.from(
      dialog.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const sendBtn = dialogButtons[dialogButtons.length - 1];
    await act(async () => {
      await user.click(sendBtn);
    });
    expect(apiPost).toHaveBeenCalledTimes(2);
    const second = apiPost.mock.calls[1]?.[1] as {
      rating: number;
      message_id: string;
      comment: string | null;
    };
    expect(second.rating).toBe(-1);
    expect(second.message_id).toBe("msg-9");
    // Comment is packed by packFeedbackComment — exact format is
    // pinned in feedbackReasons.test.ts. We just need a non-null
    // string that contains the user's text.
    expect(second.comment).toBeTruthy();
    expect(second.comment).toContain("kommentariy");
  });
});
