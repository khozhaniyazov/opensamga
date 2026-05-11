/**
 * s30 (D4) — vitest pin tests for InterruptedPill pure helpers.
 *
 * s35 wave 46 (2026-04-28) — promoted to .tsx and extended with
 * the project's first @testing-library/react component test. The
 * pure-helper pins below are unchanged; the component-contract
 * suite at the bottom proves the JSX actually consumes the
 * helper output (someone could refactor the JSX away from the
 * helper and the pure pins wouldn't catch it).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  InterruptedPill,
  interruptedPillLabel,
  shouldShowInterruptedPill,
} from "../InterruptedPill";
import { LanguageProvider } from "../../../LanguageContext";

describe("shouldShowInterruptedPill", () => {
  it("renders only on the literal true", () => {
    expect(shouldShowInterruptedPill(true)).toBe(true);
  });

  it("does not render on false / undefined / null", () => {
    expect(shouldShowInterruptedPill(false)).toBe(false);
    expect(shouldShowInterruptedPill(undefined)).toBe(false);
    expect(shouldShowInterruptedPill(null)).toBe(false);
  });

  it("does not render on truthy non-boolean values", () => {
    // Defensive: Message.wasInterrupted is strict bool; non-bool
    // truthies must NOT light the pill.
    expect(
      shouldShowInterruptedPill("yes" as unknown as boolean | null | undefined),
    ).toBe(false);
    expect(
      shouldShowInterruptedPill(1 as unknown as boolean | null | undefined),
    ).toBe(false);
  });
});

describe("interruptedPillLabel", () => {
  it("returns RU copy by default", () => {
    expect(interruptedPillLabel("ru")).toBe(
      "Ответ прерван — вы остановили генерацию",
    );
  });

  it("returns KZ copy for kazakh locale", () => {
    expect(interruptedPillLabel("kz")).toBe(
      "Жауап үзілді — өзіңіз тоқтаттыңыз",
    );
  });
});

/* ---------------------------------------------------------------- *
 * s35 wave 46 (2026-04-28) — first component-contract test using
 * @testing-library/react.
 *
 * Why InterruptedPill goes first:
 *   - It's tiny (40 lines), already has the pure-helper pins
 *     above. Low risk for shaking out infra issues.
 *   - It exercises the `useLang()` consumer pattern most chat
 *     components share — proves the LanguageProvider wrapping
 *     pattern works for future component tests.
 *   - It has two clear branches: render-nothing on flag=false,
 *     render-pill-with-label on flag=true. We pin the branches
 *     end-to-end (helper return → JSX visibility → screen reader
 *     name) instead of trusting the helper unit pin alone.
 *
 * What this proves that the helper test does NOT prove:
 *   1. The helper's boolean is actually consumed by the JSX
 *      (someone could refactor and forget to call it — pure
 *      tests wouldn't catch it).
 *   2. The bilingual label string ends up in the DOM, with the
 *      correct `role="note"` so SR users hear it as a note.
 *   3. The Pause icon is `aria-hidden` so SRs don't double-read.
 *   4. The component doesn't blow up when `wasInterrupted` is
 *      `null` / `undefined` (passed via prop, not the helper).
 * ---------------------------------------------------------------- */

function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("InterruptedPill — component contract", () => {
  it("renders nothing when wasInterrupted is undefined", () => {
    const { container } = renderWithLang(<InterruptedPill />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when wasInterrupted is false", () => {
    const { container } = renderWithLang(
      <InterruptedPill wasInterrupted={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when wasInterrupted is null", () => {
    const { container } = renderWithLang(
      <InterruptedPill wasInterrupted={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the pill with the RU label when wasInterrupted is true", () => {
    // LanguageProvider defaults to "ru" via localStorage init —
    // jsdom localStorage is fresh per test (cleanup() in setup).
    renderWithLang(<InterruptedPill wasInterrupted />);

    // Pill is announced as a `note` so SR users hear it as
    // supplementary info, not an alert.
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();

    // The full RU label string lands in the DOM via the helper.
    expect(note).toHaveTextContent("Ответ прерван — вы остановили генерацию");
  });

  it("Pause icon is aria-hidden so SR doesn't double-read", () => {
    renderWithLang(<InterruptedPill wasInterrupted />);
    const note = screen.getByRole("note");
    // The lucide Pause renders as <svg>; whatever shape, the
    // aria-hidden attribute is what matters.
    const svg = note.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
