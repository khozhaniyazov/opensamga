/**
 * s29 (C1, 2026-04-27) — AnchoredToc helpers pin.
 *
 * The TOC component itself uses `useLang` (React context) and DOM
 * APIs, so until @testing-library/react lands we exercise the four
 * pure helpers the component delegates to:
 *
 *   slugifyHeading(raw)            — must match the id stamped on
 *                                    h2/h3 by AssistantMessage's
 *                                    markdownComponents. Drift here
 *                                    silently breaks "click TOC →
 *                                    scroll to heading".
 *   extractTocEntries(text)        — walks markdown for h2/h3,
 *                                    skips fenced code blocks.
 *   countWords(text)               — used by the gate.
 *   shouldShowToc(text, entries)   — gate: ≥3 headings, OR ≥2
 *                                    headings + >300 words.
 */
import { describe, it, expect } from "vitest";
import {
  slugifyHeading,
  extractTocEntries,
  countWords,
  shouldShowToc,
} from "../AnchoredToc";

describe("slugifyHeading", () => {
  it("ASCII text becomes hyphenated lowercase", () => {
    expect(slugifyHeading("Hello World")).toBe("hello-world");
  });
  it("preserves Cyrillic letters (no transliteration)", () => {
    expect(slugifyHeading("Закон Ньютона")).toBe("закон-ньютона");
  });
  it("preserves Kazakh letters", () => {
    expect(slugifyHeading("Қазақстан тарихы")).toBe("қазақстан-тарихы");
  });
  it("strips markdown residue", () => {
    expect(slugifyHeading("**Header** _x_")).toBe("header-x");
  });
  it("collapses multiple whitespace runs", () => {
    expect(slugifyHeading("a   b   c")).toBe("a-b-c");
  });
  it("strips leading/trailing punctuation", () => {
    expect(slugifyHeading("--Header.--")).toBe("header");
  });
  it("empty input returns empty slug", () => {
    expect(slugifyHeading("")).toBe("");
    expect(slugifyHeading("   ")).toBe("");
  });
});

describe("extractTocEntries", () => {
  it("walks h2/h3 in document order", () => {
    const md = [
      "# H1 ignored",
      "## First",
      "Some prose.",
      "### First.A",
      "## Second",
    ].join("\n");
    const out = extractTocEntries(md);
    expect(out).toEqual([
      { level: 2, text: "First", slug: "first" },
      { level: 3, text: "First.A", slug: "firsta" },
      { level: 2, text: "Second", slug: "second" },
    ]);
  });
  it("skips ## inside fenced code blocks", () => {
    const md = [
      "## Real heading",
      "```",
      "## not a heading",
      "```",
      "### Another real",
    ].join("\n");
    const out = extractTocEntries(md);
    expect(out.map((e) => e.text)).toEqual(["Real heading", "Another real"]);
  });
  it("ignores h1 and h4+", () => {
    const md = ["# h1", "## h2", "### h3", "#### h4", "##### h5"].join("\n");
    const out = extractTocEntries(md);
    expect(out.map((e) => e.text)).toEqual(["h2", "h3"]);
  });
  it("empty text returns empty list", () => {
    expect(extractTocEntries("")).toEqual([]);
  });
  it("strips trailing # noise from ATX-style headings", () => {
    const md = "## Heading ##";
    const out = extractTocEntries(md);
    expect(out).toEqual([{ level: 2, text: "Heading", slug: "heading" }]);
  });
});

describe("countWords", () => {
  it("counts whitespace-delimited tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });
  it("collapses runs of whitespace", () => {
    expect(countWords("one\n\ntwo   three\tfour")).toBe(4);
  });
  it("empty input is 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("shouldShowToc", () => {
  const e2: ReturnType<typeof extractTocEntries> = [
    { level: 2, text: "a", slug: "a" },
    { level: 2, text: "b", slug: "b" },
  ];
  const e3: ReturnType<typeof extractTocEntries> = [
    ...e2,
    { level: 3, text: "c", slug: "c" },
  ];
  it("shows when ≥3 headings regardless of length", () => {
    expect(shouldShowToc("short", e3)).toBe(true);
  });
  it("shows when ≥2 headings AND >300 words", () => {
    const longText = Array(305).fill("слово").join(" ");
    expect(shouldShowToc(longText, e2)).toBe(true);
  });
  it("hides when 2 headings but ≤300 words", () => {
    const shortText = Array(299).fill("слово").join(" ");
    expect(shouldShowToc(shortText, e2)).toBe(false);
  });
  it("hides when only 1 heading", () => {
    const longText = Array(305).fill("слово").join(" ");
    expect(shouldShowToc(longText, [{ level: 2, text: "x", slug: "x" }])).toBe(
      false,
    );
  });
  it("hides on empty entries", () => {
    expect(shouldShowToc("anything", [])).toBe(false);
  });
});
