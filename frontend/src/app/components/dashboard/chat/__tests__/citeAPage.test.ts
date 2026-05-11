/**
 * s33 (F6) — vitest pins for the cite-a-page helpers.
 */

import { describe, expect, it } from "vitest";
import {
  CITE_HINT_FENCE,
  findBookByName,
  formatCiteHint,
  hasCiteHint,
  injectCiteHint,
  normalizeCitePageHint,
} from "../citeAPage";

describe("CITE_HINT_FENCE", () => {
  it("is the stable fence label", () => {
    expect(CITE_HINT_FENCE).toBe("samga.cite");
  });
});

describe("normalizeCitePageHint", () => {
  it("accepts a valid hint", () => {
    expect(normalizeCitePageHint({ bookId: 12, pageNumber: 47 })).toEqual({
      bookId: 12,
      pageNumber: 47,
    });
  });

  it("preserves bookName when non-empty", () => {
    expect(
      normalizeCitePageHint({
        bookId: 12,
        pageNumber: 47,
        bookName: "  Algebra-9  ",
      }),
    ).toEqual({ bookId: 12, pageNumber: 47, bookName: "Algebra-9" });
  });

  it("rejects non-positive / non-integer ids and pages", () => {
    expect(normalizeCitePageHint({ bookId: 0, pageNumber: 1 })).toBeNull();
    expect(normalizeCitePageHint({ bookId: -1, pageNumber: 1 })).toBeNull();
    expect(normalizeCitePageHint({ bookId: 3.5, pageNumber: 1 })).toBeNull();
    expect(normalizeCitePageHint({ bookId: 1, pageNumber: 0 })).toBeNull();
    expect(normalizeCitePageHint({ bookId: 1, pageNumber: -2 })).toBeNull();
  });

  it("rejects null / undefined / non-object input", () => {
    expect(normalizeCitePageHint(null)).toBeNull();
    expect(normalizeCitePageHint(undefined)).toBeNull();
  });

  it("drops an empty / whitespace bookName", () => {
    expect(
      normalizeCitePageHint({
        bookId: 12,
        pageNumber: 47,
        bookName: "   ",
      }),
    ).toEqual({ bookId: 12, pageNumber: 47 });
  });
});

describe("formatCiteHint", () => {
  it("emits a fenced JSON envelope", () => {
    const out = formatCiteHint({ bookId: 12, pageNumber: 47 });
    expect(out.startsWith("```samga.cite\n")).toBe(true);
    expect(out.endsWith("\n```")).toBe(true);
    expect(out).toContain('"book_id":12');
    expect(out).toContain('"page_number":47');
    expect(out).not.toContain("book_name");
  });

  it("includes book_name when provided", () => {
    const out = formatCiteHint({
      bookId: 12,
      pageNumber: 47,
      bookName: "Algebra-9",
    });
    expect(out).toContain('"book_name":"Algebra-9"');
  });

  it("returns empty string for invalid hints", () => {
    expect(formatCiteHint({ bookId: 0, pageNumber: 1 } as any)).toBe("");
  });
});

describe("hasCiteHint", () => {
  it("detects a fenced hint at the top", () => {
    const msg =
      '```samga.cite\n{"book_id":12,"page_number":47}\n```\n\nExplain this.';
    expect(hasCiteHint(msg)).toBe(true);
  });

  it("returns false on plain text", () => {
    expect(hasCiteHint("Explain this please.")).toBe(false);
  });

  it("defends against null / non-string", () => {
    expect(hasCiteHint(null)).toBe(false);
    expect(hasCiteHint(undefined)).toBe(false);
    expect(hasCiteHint(42 as any)).toBe(false);
  });
});

describe("injectCiteHint", () => {
  it("prepends the hint to a non-empty message", () => {
    const out = injectCiteHint("Explain this please.", {
      bookId: 12,
      pageNumber: 47,
    });
    expect(out.startsWith("```samga.cite\n")).toBe(true);
    expect(out).toContain("Explain this please.");
  });

  it("returns just the hint when message is empty / whitespace", () => {
    expect(injectCiteHint("", { bookId: 12, pageNumber: 47 })).toContain(
      '"book_id":12',
    );
    expect(injectCiteHint("   ", { bookId: 12, pageNumber: 47 })).toContain(
      '"book_id":12',
    );
  });

  it("is idempotent — second call doesn't double-inject", () => {
    const first = injectCiteHint("Q?", { bookId: 12, pageNumber: 47 });
    const second = injectCiteHint(first, { bookId: 99, pageNumber: 1 });
    expect(second).toBe(first);
  });

  it("returns the message unchanged when hint is invalid", () => {
    const out = injectCiteHint("Q?", { bookId: 0, pageNumber: 1 } as any);
    expect(out).toBe("Q?");
  });
});

describe("findBookByName", () => {
  const catalog = [
    { id: 1, title: "Algebra 9 (Tierney)" },
    { id: 2, title: "Physics 10 (Dolinski)" },
  ];

  it("matches exact title (case-insensitive)", () => {
    expect(findBookByName(catalog, "algebra 9 (tierney)")?.id).toBe(1);
  });

  it("falls back to substring match", () => {
    expect(findBookByName(catalog, "algebra-9")).toBeNull(); // hyphen not present
    expect(findBookByName(catalog, "algebra")?.id).toBe(1);
    expect(findBookByName(catalog, "physics")?.id).toBe(2);
  });

  it("returns null on empty / unknown input", () => {
    expect(findBookByName(catalog, "")).toBeNull();
    expect(findBookByName(catalog, "   ")).toBeNull();
    expect(findBookByName(catalog, "geography")).toBeNull();
  });
});
