/**
 * s29 (A2, 2026-04-27) — SourcesDrawer predicate + label pins.
 *
 * Mirrors the RedactionPill testing convention: the component itself
 * uses `useLang` (React context) and `useState`, so until
 * @testing-library/react lands we exercise the three pure helpers
 * the component delegates to:
 *
 *   shouldShowSourcesDrawer(sources) — `> 0` guard.
 *   sourcesDrawerLabel(count, lang)  — bilingual count pill copy.
 *   sourceRowTitle(source, idx, lang) — fallback title for legacy rows.
 *
 * Combined these cover the drawer's contract: render-or-skip, summary
 * label drift, and title-fallback drift on legacy persisted rows that
 * pre-date the s29 envelope.
 */
import { describe, it, expect } from "vitest";
import {
  shouldShowSourcesDrawer,
  sourcesDrawerLabel,
  sourceRowTitle,
} from "../SourcesDrawer";
import type { ConsultedSource } from "../types";

const SAMPLE: ConsultedSource = {
  book_id: 257,
  page_number: 66,
  book_name: "Физика 9",
  snippet: "Второй закон Ньютона",
  score: 0.91,
};

describe("shouldShowSourcesDrawer", () => {
  it("hides when sources is undefined", () => {
    expect(shouldShowSourcesDrawer(undefined)).toBe(false);
  });
  it("hides when sources is null", () => {
    expect(shouldShowSourcesDrawer(null)).toBe(false);
  });
  it("hides when sources is an empty array", () => {
    expect(shouldShowSourcesDrawer([])).toBe(false);
  });
  it("hides when sources is not an array (defensive)", () => {
    // Tolerate stray persisted shapes — the BE typically writes [],
    // but malformed legacy rows shouldn't crash the renderer.
    // @ts-expect-error — intentionally wrong shape.
    expect(shouldShowSourcesDrawer({})).toBe(false);
    // @ts-expect-error — intentionally wrong shape.
    expect(shouldShowSourcesDrawer("oops")).toBe(false);
  });
  it("shows when sources has at least one row", () => {
    expect(shouldShowSourcesDrawer([SAMPLE])).toBe(true);
  });
  it("shows for multi-row arrays", () => {
    expect(
      shouldShowSourcesDrawer([SAMPLE, { ...SAMPLE, page_number: 67 }]),
    ).toBe(true);
  });
});

describe("sourcesDrawerLabel", () => {
  it("Russian copy includes the count", () => {
    expect(sourcesDrawerLabel(3, "ru")).toBe("Использовано источников: 3");
  });
  it("Kazakh copy includes the count", () => {
    expect(sourcesDrawerLabel(3, "kz")).toBe("Қолданылған дереккөздер: 3");
  });
  it("singular count still reads grammatically (1)", () => {
    // We intentionally don't pluralize — keeps the label pure and
    // testable. If the boss wants "1 source / N sources" we add a
    // separate i18n key.
    expect(sourcesDrawerLabel(1, "ru")).toBe("Использовано источников: 1");
  });
});

describe("sourceRowTitle", () => {
  it("uses book_name when present", () => {
    expect(sourceRowTitle(SAMPLE, 0, "ru")).toBe("Физика 9");
  });
  it("trims whitespace-only book_name and falls back", () => {
    const blank: ConsultedSource = { ...SAMPLE, book_name: "   " };
    expect(sourceRowTitle(blank, 0, "ru")).toBe("Источник №1");
  });
  it("falls back to bilingual generic title (RU)", () => {
    const legacy: ConsultedSource = {
      book_id: 1,
      page_number: 1,
      book_name: null,
    };
    expect(sourceRowTitle(legacy, 2, "ru")).toBe("Источник №3");
  });
  it("falls back to bilingual generic title (KZ)", () => {
    const legacy: ConsultedSource = {
      book_id: 1,
      page_number: 1,
      book_name: undefined,
    };
    expect(sourceRowTitle(legacy, 0, "kz")).toBe("Дереккөз №1");
  });
});
