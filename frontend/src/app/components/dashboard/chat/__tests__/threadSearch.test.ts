/**
 * s31 wave 2 (E1) — vitest pin tests for the threadSearch helpers.
 */

import { describe, expect, it } from "vitest";
import {
  filterThreadsBySearch,
  normalizeThreadSearchQuery,
} from "../threadSearch";
import type { ChatThread } from "../MessagesContext";

const mk = (id: number | null, title: string | null): ChatThread => ({
  id,
  title,
  created_at: null,
  updated_at: null,
  message_count: 0,
});

describe("normalizeThreadSearchQuery", () => {
  it("returns empty string for null/undefined/non-string", () => {
    // Function takes `unknown`; these calls are intentionally not
    // typed so the runtime guard gets exercised.
    expect(normalizeThreadSearchQuery(null)).toBe("");
    expect(normalizeThreadSearchQuery(undefined)).toBe("");
    expect(normalizeThreadSearchQuery(42)).toBe("");
  });

  it("trims and lowercases", () => {
    expect(normalizeThreadSearchQuery("  Hello  ")).toBe("hello");
  });

  it("returns empty string for whitespace-only", () => {
    expect(normalizeThreadSearchQuery("   \t\n")).toBe("");
  });

  it("strips Cyrillic diacritics (ё → е)", () => {
    // Critical: a user typing "елка" should match "Ёлка". This is
    // the primary reason the helper exists as a pure function.
    expect(normalizeThreadSearchQuery("Ёлка")).toBe(
      normalizeThreadSearchQuery("елка"),
    );
  });

  it("strips Latin diacritics (š → s)", () => {
    expect(normalizeThreadSearchQuery("škola")).toBe("skola");
  });
});

describe("filterThreadsBySearch", () => {
  const threads: ChatThread[] = [
    mk(1, "Физика 9: законы Ньютона"),
    mk(2, "Электростатика"),
    mk(3, "История Казахстана"),
    mk(4, "Ёлка на новый год"),
    mk(5, ""),
    mk(null, null), // legacy/orphan bucket
  ];

  it("returns the full list (copy) on empty query", () => {
    const out = filterThreadsBySearch(threads, "");
    expect(out).toHaveLength(threads.length);
    expect(out).not.toBe(threads); // mutation safety
  });

  it("returns the full list on whitespace-only query", () => {
    expect(filterThreadsBySearch(threads, "   ")).toHaveLength(threads.length);
  });

  it("filters by case-insensitive substring", () => {
    const out = filterThreadsBySearch(threads, "Физика");
    expect(out.map((t) => t.id)).toEqual([1]);
    const out2 = filterThreadsBySearch(threads, "физ");
    expect(out2.map((t) => t.id)).toEqual([1]);
  });

  it("matches diacritic-folded queries (елка → Ёлка)", () => {
    const out = filterThreadsBySearch(threads, "елка");
    expect(out.map((t) => t.id)).toEqual([4]);
  });

  it("excludes threads with null titles when filtering", () => {
    // The legacy/orphan bucket is intentionally hidden during search
    // — a user looking for "physics" isn't looking for the unnamed
    // mailbox.
    const out = filterThreadsBySearch(threads, "э");
    expect(out.every((t) => typeof t.title === "string")).toBe(true);
    expect(out.some((t) => t.id === null)).toBe(false);
  });

  it("excludes threads with empty-string titles when filtering", () => {
    const out = filterThreadsBySearch(threads, "э");
    expect(out.some((t) => t.id === 5)).toBe(false);
  });

  it("returns an empty list on no match", () => {
    expect(filterThreadsBySearch(threads, "absolutelynothing")).toEqual([]);
  });

  it("preserves the input order", () => {
    // Sort order is the caller's concern (recency, pin status...);
    // the filter must not reorder. Use a custom 4-thread fixture
    // (the module-level one has too many incidental "ка" hits via
    // Физика/Электростатика to make the order assertion crisp).
    const fixture: ChatThread[] = [
      mk(10, "Зебра"),
      mk(20, "Альфа"),
      mk(30, "Бета альфа"),
      mk(40, "Гамма"),
    ];
    const out = filterThreadsBySearch(fixture, "альфа");
    // Input order: 20 then 30 — never sorted by length / relevance.
    expect(out.map((t) => t.id)).toEqual([20, 30]);
  });

  it("rejects a non-array threads list defensively", () => {
    // @ts-expect-error — runtime guard
    expect(filterThreadsBySearch(null, "foo")).toEqual([]);
    // @ts-expect-error
    expect(filterThreadsBySearch(undefined, "foo")).toEqual([]);
  });
});
