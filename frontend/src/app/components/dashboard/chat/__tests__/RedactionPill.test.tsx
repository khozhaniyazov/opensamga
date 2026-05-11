/**
 * s27 (C1, 2026-04-27) — RedactionPill predicate + label pin.
 *
 * The pill itself uses `useLang` (a React context) so until we install
 * @testing-library/react the React tree can't be exercised directly.
 * Instead we test the two pure helpers the component delegates to:
 *
 *   shouldShowRedactionPill(count) — matches the `count > 0` guard.
 *   redactionPillLabel(lang)        — bilingual copy.
 *
 * Together those cover the full behavioural surface of the pill: any
 * future regression that breaks rendering (e.g. label drift, predicate
 * inversion) fails here.
 *
 * s35 wave 48 (2026-04-28) — component-contract suite added at the
 * bottom now that the @testing-library/react infra (wave 46) is
 * available. Same shape as InterruptedPill / GeneralKnowledgePill:
 * boolean-flag + useLang() + role=status pill chrome.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RedactionPill,
  shouldShowRedactionPill,
  redactionPillLabel,
} from "../RedactionPill";
import { LanguageProvider } from "../../../LanguageContext";

describe("shouldShowRedactionPill", () => {
  it("hides when count is 0", () => {
    expect(shouldShowRedactionPill(0)).toBe(false);
  });
  it("hides when count is undefined", () => {
    expect(shouldShowRedactionPill(undefined)).toBe(false);
  });
  it("hides when count is null", () => {
    expect(shouldShowRedactionPill(null)).toBe(false);
  });
  it("hides when count is negative (defensive)", () => {
    expect(shouldShowRedactionPill(-1)).toBe(false);
  });
  it("hides when count is NaN", () => {
    expect(shouldShowRedactionPill(Number.NaN)).toBe(false);
  });
  it("shows when count is 1", () => {
    expect(shouldShowRedactionPill(1)).toBe(true);
  });
  it("shows for higher counts (binary signal)", () => {
    expect(shouldShowRedactionPill(5)).toBe(true);
  });
});

describe("redactionPillLabel", () => {
  it("emits Russian copy for ru", () => {
    const out = redactionPillLabel("ru");
    expect(out).toMatch(/Не подтверждённые числа/);
    // mentions the "ask about your past tests" hint so users know how
    // to get the real number — that's the whole point of the pill.
    expect(out).toMatch(/прошлых тестов/);
  });

  it("emits Kazakh copy for kz", () => {
    const out = redactionPillLabel("kz");
    expect(out).toMatch(/Тексерілмеген сандар/);
    expect(out).toMatch(/нақты балыңды/);
  });

  it("ru and kz copies are distinct (not the same fallback)", () => {
    expect(redactionPillLabel("ru")).not.toBe(redactionPillLabel("kz"));
  });

  // s35 wave B2 (2026-04-28): when a count is supplied, the label is
  // prefixed with the number of redacted claims and the matching
  // grammatical form. Pin the three RU plural cases (1 / 2-4 / 5+)
  // and the single KZ form so future copy edits don't silently break
  // the agreement rules.
  describe("with count prefix (s35 wave B2)", () => {
    it("RU plural: 1 → 'число'", () => {
      expect(redactionPillLabel("ru", 1)).toMatch(/^1 число удалено —/);
    });

    it("RU plural: 2 → 'числа'", () => {
      expect(redactionPillLabel("ru", 2)).toMatch(/^2 числа удалено —/);
    });

    it("RU plural: 5 → 'чисел'", () => {
      expect(redactionPillLabel("ru", 5)).toMatch(/^5 чисел удалено —/);
    });

    it("RU plural: 11 is teen, falls back to 'чисел'", () => {
      // 11 mod 10 === 1 but mod 100 === 11 so we must NOT match singular.
      expect(redactionPillLabel("ru", 11)).toMatch(/^11 чисел удалено —/);
    });

    it("RU plural: 21 → singular ('число') again", () => {
      // mod 10 === 1, mod 100 === 21 → singular form.
      expect(redactionPillLabel("ru", 21)).toMatch(/^21 число удалено —/);
    });

    it("KZ uses one form, prefixed with count", () => {
      expect(redactionPillLabel("kz", 3)).toMatch(/^3 тексерілмеген сан —/);
    });

    it("zero / null / undefined / negative counts use the unprefixed copy", () => {
      // Zero or missing count must not render "0 чисел удалено".
      const fallbackRu = redactionPillLabel("ru");
      expect(redactionPillLabel("ru", 0)).toBe(fallbackRu);
      expect(redactionPillLabel("ru", null)).toBe(fallbackRu);
      expect(redactionPillLabel("ru", undefined)).toBe(fallbackRu);
      expect(redactionPillLabel("ru", -1)).toBe(fallbackRu);
    });
  });
});

/* ---------------------------------------------------------------- *
 * s35 wave 48 (2026-04-28) — component-contract pins.
 *
 * RedactionPill ships with role="status" + aria-live="polite" and
 * an aria-label set to the same string the visible <span> renders;
 * the latter is what SR users hear. Pin both branches (count=0 →
 * nothing, count>0 → label DOM + aria-label match) so a refactor
 * that drops aria-label or changes role surfaces here.
 * ---------------------------------------------------------------- */

function renderWithLang(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("RedactionPill — component contract", () => {
  it("renders nothing when count is undefined", () => {
    const { container } = renderWithLang(<RedactionPill />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when count is 0", () => {
    const { container } = renderWithLang(<RedactionPill count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the unprefixed RU label when count is undefined-but-shown via flag", () => {
    // Defensive: the helper renders the unprefixed copy at count=null
    // but the predicate hides the pill there, so we should see nothing.
    const { container } = renderWithLang(<RedactionPill count={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the prefixed RU label when count > 0", () => {
    renderWithLang(<RedactionPill count={2} />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("2 числа удалено");
  });

  it("aria-label matches the visible label so SR text is single-source", () => {
    renderWithLang(<RedactionPill count={5} />);
    const status = screen.getByRole("status");
    const label = status.getAttribute("aria-label");
    expect(label).not.toBeNull();
    expect(label).toMatch(/^5 чисел удалено —/);
    expect(status).toHaveTextContent(label as string);
  });
});
