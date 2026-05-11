/**
 * s30 (A4) — vitest pin tests for FailedToolPill pure helpers.
 *
 * Originally pure-helper-only because @testing-library/react wasn't
 * installed. Wave 46 (2026-04-28) added the infra; wave 48 (same day)
 * extends this file with the component-contract suite at the bottom.
 *
 * FailedToolPill is the most interesting pill in the family because
 * it ships an expand/collapse disclosure button on top of the static
 * summary chrome — the wave 48 suite is the first interactive RTL
 * contract test in the codebase.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FailedToolPill,
  failedToolPillLabel,
  prettyToolName,
  shouldShowFailedToolPill,
} from "../FailedToolPill";
import type { FailedToolCall } from "../types";
import { LanguageProvider } from "../../../LanguageContext";

describe("shouldShowFailedToolPill", () => {
  it("returns false on undefined / null", () => {
    expect(shouldShowFailedToolPill(undefined)).toBe(false);
    expect(shouldShowFailedToolPill(null)).toBe(false);
  });

  it("returns false on empty list", () => {
    expect(shouldShowFailedToolPill([])).toBe(false);
  });

  it("returns true on at least one row", () => {
    const row: FailedToolCall = {
      name: "consult_library",
      error_preview: "down",
    };
    expect(shouldShowFailedToolPill([row])).toBe(true);
  });

  it("returns false on non-array values (defensive)", () => {
    // Persisted rows from very old envelopes might land as a stringified
    // shape; the pill must not render in that case.
    expect(
      shouldShowFailedToolPill("nope" as unknown as FailedToolCall[]),
    ).toBe(false);
    expect(shouldShowFailedToolPill({} as unknown as FailedToolCall[])).toBe(
      false,
    );
  });
});

describe("failedToolPillLabel", () => {
  it("formats RU singular vs plural", () => {
    expect(failedToolPillLabel(1, "ru")).toBe(
      "Не удалось получить данные: 1 инструмент",
    );
    expect(failedToolPillLabel(2, "ru")).toBe(
      "Не удалось получить данные: 2 инструмента",
    );
  });

  it("formats KZ singular vs plural", () => {
    expect(failedToolPillLabel(1, "kz")).toBe("Дерек алу сәтсіз: 1 құрал");
    expect(failedToolPillLabel(3, "kz")).toBe("Дерек алу сәтсіз: 3 құрал");
  });

  // s35 wave B1 (2026-04-28): when there is exactly ONE failure and a
  // tool name is provided, the pill surfaces the pretty name in the
  // collapsed summary so users learn whether the failure was the RAG
  // retriever or a profile lookup.
  it("uses the single-tool label when count=1 and a name is supplied (RU)", () => {
    expect(failedToolPillLabel(1, "ru", "consult_library")).toBe(
      "Сбой: библиотека",
    );
  });

  it("uses the single-tool label when count=1 and a name is supplied (KZ)", () => {
    expect(failedToolPillLabel(1, "kz", "consult_library")).toBe(
      "Сәтсіз: кітапхана",
    );
  });

  it("falls back to count copy when name is missing or count > 1", () => {
    expect(failedToolPillLabel(1, "ru", null)).toBe(
      "Не удалось получить данные: 1 инструмент",
    );
    // Even with a name supplied, count > 1 must fall back to the count
    // form because the expanded list will still show every tool.
    expect(failedToolPillLabel(2, "ru", "consult_library")).toBe(
      "Не удалось получить данные: 2 инструмента",
    );
  });
});

describe("prettyToolName", () => {
  it("maps known tools to readable RU labels", () => {
    expect(prettyToolName("consult_library", "ru")).toBe("библиотека");
    expect(prettyToolName("get_user_profile", "ru")).toBe("профиль");
    expect(prettyToolName("get_recent_mistakes", "ru")).toBe("ошибки");
  });

  it("maps known tools to readable KZ labels", () => {
    expect(prettyToolName("consult_library", "kz")).toBe("кітапхана");
    expect(prettyToolName("get_user_profile", "kz")).toBe("профиль");
  });

  it("falls back to Title-Case for unknown tools", () => {
    // Forward-compat: when a new tool ships before its entry lands
    // in the prettyToolName map, the FE must still render something
    // readable rather than the snake_case identifier.
    expect(prettyToolName("some_brand_new_tool", "ru")).toBe(
      "Some Brand New Tool",
    );
  });

  it("handles single-word names", () => {
    expect(prettyToolName("noop", "ru")).toBe("Noop");
  });
});

/* ---------------------------------------------------------------- *
 * s35 wave 48 (2026-04-28) — component-contract pins.
 *
 * First interactive RTL test: pin the disclosure-button toggle
 * (collapsed → expanded → list rendered → collapsed again) plus the
 * static summary copy + aria-expanded + role=status wrapper.
 * ---------------------------------------------------------------- */

function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("FailedToolPill — component contract", () => {
  it("renders nothing when failures is undefined", () => {
    const { container } = renderWithLang(<FailedToolPill />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when failures is an empty list", () => {
    const { container } = renderWithLang(<FailedToolPill failures={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders single-tool RU summary when one failure is supplied", () => {
    const failure: FailedToolCall = {
      name: "consult_library",
      error_preview: "503 Service Unavailable",
    };
    renderWithLang(<FailedToolPill failures={[failure]} />);
    // role=status wrapper is the live region.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Wave B1 single-tool summary uses the pretty name.
    expect(screen.getByRole("button")).toHaveTextContent("Сбой: библиотека");
    // Collapsed by default.
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // List is not in the DOM yet.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders count summary when multiple failures are supplied", () => {
    const failures: FailedToolCall[] = [
      { name: "consult_library", error_preview: "down" },
      { name: "get_user_profile", error_preview: "401" },
    ];
    renderWithLang(<FailedToolPill failures={failures} />);
    expect(screen.getByRole("button")).toHaveTextContent(
      "Не удалось получить данные: 2 инструмента",
    );
  });

  it("expands the failure list when the disclosure button is clicked", async () => {
    const user = userEvent.setup();
    const failures: FailedToolCall[] = [
      { name: "consult_library", error_preview: "503 down" },
      { name: "get_user_profile", error_preview: "401 unauthorized" },
    ];
    renderWithLang(<FailedToolPill failures={failures} />);

    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "false");

    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");

    // List + both failure rows now visible.
    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();
    expect(list).toHaveTextContent("библиотека");
    expect(list).toHaveTextContent("503 down");
    expect(list).toHaveTextContent("профиль");
    expect(list).toHaveTextContent("401 unauthorized");

    // Click again collapses.
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).toBeNull();
  });
});
