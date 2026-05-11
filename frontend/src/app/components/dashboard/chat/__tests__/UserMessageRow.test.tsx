/**
 * s35 wave 50 (2026-04-28) — UserMessageRow vitest pins.
 *
 * Pure-helper pin (`userMessageHasMath`) plus a component-contract
 * suite using the wave-46 RTL infra. We don't wrap with the
 * LanguageProvider — the component takes `lang` as a prop so the
 * test stays trivially deterministic.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMessageRow, userMessageHasMath } from "../UserMessageRow";

describe("userMessageHasMath", () => {
  it("returns true for $$…$$ block math", () => {
    expect(userMessageHasMath("Solve $$x^2 + 1 = 0$$ please")).toBe(true);
  });

  it("returns true for $…$ inline math", () => {
    expect(userMessageHasMath("Find $x$ in equation")).toBe(true);
  });

  it("returns true for \\[…\\] bracket display", () => {
    expect(userMessageHasMath("\\[a^2 + b^2 = c^2\\]")).toBe(true);
  });

  it("returns true for \\(…\\) paren inline", () => {
    expect(userMessageHasMath("\\(\\sin x\\)")).toBe(true);
  });

  it("returns false for plain prose", () => {
    expect(userMessageHasMath("Hello, how are you?")).toBe(false);
  });

  it("returns false for prose with a single literal $ (currency)", () => {
    // The inline-math regex requires a closing $ on the same line so
    // this should NOT match — currency must not light up the renderer.
    expect(userMessageHasMath("Costs $5 dollars")).toBe(false);
  });

  it("returns false for empty / non-string inputs (defensive)", () => {
    expect(userMessageHasMath("")).toBe(false);
    expect(userMessageHasMath(undefined as unknown as string)).toBe(false);
    expect(userMessageHasMath(null as unknown as string)).toBe(false);
    expect(userMessageHasMath(42 as unknown as string)).toBe(false);
  });
});

describe("UserMessageRow — component contract", () => {
  const baseProps = {
    text: "Hello samga",
    isSending: false,
    followUpCount: 0,
    lang: "ru" as const,
    onEdit: () => {},
  };

  it("renders plain text in a <p> with whitespace preserved", () => {
    const { container } = render(
      <UserMessageRow {...baseProps} text={"line one\nline two"} />,
    );
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(p).toHaveTextContent("line one line two");
  });

  it("does not render the pencil button while sending", () => {
    render(<UserMessageRow {...baseProps} isSending />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the pencil button when idle", () => {
    render(<UserMessageRow {...baseProps} isSending={false} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("title");
  });

  it("forwards the followUpCount to the consequence-aria label", () => {
    render(<UserMessageRow {...baseProps} followUpCount={3} />);
    const btn = screen.getByRole("button");
    const label = btn.getAttribute("aria-label") || "";
    // editUserMessageAria contract (s35 wave 24b): RU label includes
    // the count + paucal noun. Pin loosely so a copy tweak doesn't
    // break here, but a missing count signal does.
    expect(label).toMatch(/3/);
  });

  it("calls onEdit when the pencil is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<UserMessageRow {...baseProps} onEdit={onEdit} />);
    await user.click(screen.getByRole("button"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
