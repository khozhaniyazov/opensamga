/**
 * s35 wave 74 (2026-04-29) — CitationChip render-contract pins.
 *
 * The last unpinned big component in chat/. Helper coverage was
 * thick (citationChipAria, citationHoverDwell) but no DOM-level
 * pins for: linked vs unlinked branch (interactive <a> vs static
 * badge), the popover portal lifecycle, the openTimer 180ms delay,
 * the click telemetry payload, the keyboard-activate path
 * (focus → click without mouseenter).
 *
 * Mocks the telemetry surface so we can pin payload shape without
 * polluting the buffer.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// ---- Mocks (hoisted) ----------------------------------------------

const trackCitationClicked = vi.fn();
const trackCitationHover = vi.fn();
// vi.mock specifier resolves relative to THIS test file; SUT
// uses "../../../lib/telemetry" from chat/, so from
// chat/__tests__/ that's "../../../../lib/telemetry".
vi.mock("../../../../lib/telemetry", () => ({
  trackCitationClicked: (...a: unknown[]) => trackCitationClicked(...a),
  trackCitationHover: (...a: unknown[]) => trackCitationHover(...a),
}));

// ---- SUT ----------------------------------------------------------

import { LanguageProvider } from "../../../LanguageContext";
import { CitationChip } from "../CitationChip";
import type { Citation } from "../citations";

const CITATION: Citation = {
  bookName: "Algebra 9 Tierney",
  pageNumber: 42,
};

function renderChip(opts?: { bookId?: number | null; citation?: Citation }) {
  return render(
    <LanguageProvider>
      <CitationChip
        citation={opts?.citation ?? CITATION}
        bookId={opts?.bookId === undefined ? 7 : opts.bookId}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  trackCitationClicked.mockClear();
  trackCitationHover.mockClear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CitationChip — linked branch (bookId resolved)", () => {
  it("renders an anchor with target=_blank + rel=noreferrer", () => {
    renderChip({ bookId: 7 });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveAttribute("href");
    expect(link.getAttribute("href")).toMatch(/\b7\b/);
    expect(link.getAttribute("href")).toMatch(/\b42\b/);
  });

  it("the anchor has an aria-label resolved from citationChipLinkAriaLabel", () => {
    renderChip({ bookId: 7 });
    const link = screen.getByRole("link");
    const aria = link.getAttribute("aria-label") || "";
    expect(aria.length).toBeGreaterThan(0);
    expect(aria.toLowerCase()).toContain("algebra 9 tierney");
  });

  it("clicking the chip emits trackCitationClicked with full payload (incl. hover_dwell_ms)", () => {
    renderChip({ bookId: 7 });
    fireEvent.click(screen.getByRole("link"));
    expect(trackCitationClicked).toHaveBeenCalledTimes(1);
    const props = trackCitationClicked.mock.calls[0][0] as {
      book_id: number | null;
      page_number: number;
      hover_dwell_ms: number | null;
    };
    expect(props.book_id).toBe(7);
    expect(props.page_number).toBe(42);
    // Click without prior mouseenter → hover_dwell_ms=null (the
    // wave-61 cold-click contract).
    expect(props.hover_dwell_ms).toBeNull();
  });

  it("hover then click emits a non-null hover_dwell_ms", () => {
    renderChip({ bookId: 7 });
    const link = screen.getByRole("link");
    fireEvent.mouseEnter(link);
    fireEvent.click(link);
    expect(trackCitationClicked).toHaveBeenCalledTimes(1);
    const props = trackCitationClicked.mock.calls[0][0] as {
      hover_dwell_ms: number | null;
    };
    expect(props.hover_dwell_ms).not.toBeNull();
    expect(typeof props.hover_dwell_ms).toBe("number");
    expect((props.hover_dwell_ms as number) >= 0).toBe(true);
  });
});

describe("CitationChip — unlinked branch (bookId null)", () => {
  it("renders a STATIC badge (no role=link, no anchor) when bookId is null", () => {
    renderChip({ bookId: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The unlinked badge is a plain <span> with the missing aria
    // label — pin presence via the missing-link aria text.
    const labelled = screen.getByLabelText(/algebra 9 tierney/i);
    expect(labelled.tagName.toLowerCase()).not.toBe("a");
  });

  it("clicking an unlinked badge does NOT emit telemetry", () => {
    renderChip({ bookId: null });
    const labelled = screen.getByLabelText(/algebra 9 tierney/i);
    fireEvent.click(labelled);
    expect(trackCitationClicked).not.toHaveBeenCalled();
  });
});

describe("CitationChip — popover lifecycle", () => {
  it("popover does NOT appear immediately on mouseenter (180ms delay)", () => {
    vi.useFakeTimers();
    renderChip({ bookId: 7 });
    fireEvent.mouseEnter(screen.getByRole("link"));
    // Before 180ms elapses no role=dialog should mount.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("popover appears after the 180ms openTimer", () => {
    vi.useFakeTimers();
    renderChip({ bookId: 7 });
    const link = screen.getByRole("link");
    fireEvent.mouseEnter(link);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // The popover is a portal'd role=dialog with a bilingual aria-label.
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
  });

  it("mouseleave starts the close timer; popover unmounts after 120ms", () => {
    vi.useFakeTimers();
    renderChip({ bookId: 7 });
    const link = screen.getByRole("link");
    fireEvent.mouseEnter(link);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseLeave(link);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("popover never opens for unlinked chips even on mouseenter", () => {
    vi.useFakeTimers();
    renderChip({ bookId: null });
    // Unlinked branch — no role=link to enter; the badge is the
    // labelled span. Even firing mouseenter on it shouldn't open
    // a popover because handleEnter early-returns on !hasLink.
    const labelled = screen.getByLabelText(/algebra 9 tierney/i);
    fireEvent.mouseEnter(labelled);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
