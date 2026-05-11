/**
 * s30 (A6) — vitest pin tests for GeneralKnowledgePill pure helpers.
 *
 * s35 wave 48 (2026-04-28) — extended with component-contract pins
 * using the @testing-library/react infra introduced in wave 46.
 * Pattern mirrors InterruptedPill.test.tsx: the helper pins below
 * are unchanged; the JSX-contract suite at the bottom proves the
 * component actually consumes the helper output.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  GeneralKnowledgePill,
  generalKnowledgePillLabel,
  shouldShowGeneralKnowledgePill,
} from "../GeneralKnowledgePill";
import { LanguageProvider } from "../../../LanguageContext";

describe("shouldShowGeneralKnowledgePill", () => {
  it("renders only on the literal true", () => {
    expect(shouldShowGeneralKnowledgePill(true)).toBe(true);
  });

  it("does not render on false / undefined / null", () => {
    expect(shouldShowGeneralKnowledgePill(false)).toBe(false);
    expect(shouldShowGeneralKnowledgePill(undefined)).toBe(false);
    expect(shouldShowGeneralKnowledgePill(null)).toBe(false);
  });

  it("does not render on truthy non-boolean values", () => {
    // Defensive: backend contract is a strict bool. A stray string
    // or number must NOT light the pill (would mask a regression).
    expect(
      shouldShowGeneralKnowledgePill(
        "yes" as unknown as boolean | null | undefined,
      ),
    ).toBe(false);
    expect(
      shouldShowGeneralKnowledgePill(
        1 as unknown as boolean | null | undefined,
      ),
    ).toBe(false);
  });
});

describe("generalKnowledgePillLabel", () => {
  it("returns RU copy by default", () => {
    expect(generalKnowledgePillLabel("ru")).toBe(
      "Общие знания — без ваших данных",
    );
  });

  it("returns KZ copy for kazakh locale", () => {
    expect(generalKnowledgePillLabel("kz")).toBe(
      "Жалпы білім — сіздің деректеріңіз қолданылмады",
    );
  });
});

/* ---------------------------------------------------------------- *
 * s35 wave 48 (2026-04-28) — component-contract pins.
 *
 * Mirrors the InterruptedPill (wave 46) pattern: short pure-helper
 * tests above, JSX-contract suite below. Both pills share the same
 * `useLang()` + boolean-flag shape, so this is high-value batting
 * practice for the new RTL infra and proves the helper pin actually
 * tracks DOM rendering (someone could refactor JSX away from the
 * helper and the pure pins wouldn't catch it).
 * ---------------------------------------------------------------- */

function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("GeneralKnowledgePill — component contract", () => {
  it("renders nothing when isGeneralKnowledge is undefined", () => {
    const { container } = renderWithLang(<GeneralKnowledgePill />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when isGeneralKnowledge is false", () => {
    const { container } = renderWithLang(
      <GeneralKnowledgePill isGeneralKnowledge={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when isGeneralKnowledge is null", () => {
    const { container } = renderWithLang(
      <GeneralKnowledgePill isGeneralKnowledge={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the pill with the RU label when isGeneralKnowledge is true", () => {
    renderWithLang(<GeneralKnowledgePill isGeneralKnowledge />);
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent("Общие знания — без ваших данных");
  });

  it("Info icon is aria-hidden so SR doesn't double-read", () => {
    renderWithLang(<GeneralKnowledgePill isGeneralKnowledge />);
    const note = screen.getByRole("note");
    const svg = note.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
