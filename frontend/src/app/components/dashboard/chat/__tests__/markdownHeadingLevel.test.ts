import { describe, it, expect } from "vitest";
import {
  chatMarkdownHeadingLevel,
  chatMarkdownHeadingTag,
} from "../markdownHeadingLevel";

describe("chatMarkdownHeadingLevel (s35 wave 26c)", () => {
  it("# (md 1) demotes to DOM 2", () => {
    expect(chatMarkdownHeadingLevel(1)).toBe(2);
  });

  it("## (md 2) demotes to DOM 3", () => {
    expect(chatMarkdownHeadingLevel(2)).toBe(3);
  });

  it("### (md 3) demotes to DOM 4", () => {
    expect(chatMarkdownHeadingLevel(3)).toBe(4);
  });

  it("#### (md 4) demotes to DOM 5", () => {
    expect(chatMarkdownHeadingLevel(4)).toBe(5);
  });

  it("##### (md 5) demotes to DOM 6", () => {
    expect(chatMarkdownHeadingLevel(5)).toBe(6);
  });

  it("###### (md 6) clamps to DOM 6", () => {
    expect(chatMarkdownHeadingLevel(6)).toBe(6);
  });

  it("md 0 → clamped low to md 1 → DOM 2", () => {
    expect(chatMarkdownHeadingLevel(0)).toBe(2);
  });

  it("md 7 → clamped high to md 6 → DOM 6", () => {
    expect(chatMarkdownHeadingLevel(7)).toBe(6);
  });

  it("md 99 → DOM 6", () => {
    expect(chatMarkdownHeadingLevel(99)).toBe(6);
  });

  it("negative md → DOM 2", () => {
    expect(chatMarkdownHeadingLevel(-3)).toBe(2);
  });

  it("fractional md floors", () => {
    expect(chatMarkdownHeadingLevel(2.9)).toBe(3);
    expect(chatMarkdownHeadingLevel(2.1)).toBe(3);
    expect(chatMarkdownHeadingLevel(3.7)).toBe(4);
  });

  it("null/undefined/NaN/Infinity → DOM 6 (defensive deepest)", () => {
    expect(chatMarkdownHeadingLevel(null)).toBe(6);
    expect(chatMarkdownHeadingLevel(undefined)).toBe(6);
    expect(chatMarkdownHeadingLevel(Number.NaN)).toBe(6);
    expect(chatMarkdownHeadingLevel(Number.POSITIVE_INFINITY)).toBe(6);
    expect(chatMarkdownHeadingLevel(Number.NEGATIVE_INFINITY)).toBe(6);
  });

  it("string input → DOM 6 (defensive)", () => {
    // @ts-expect-error — runtime guard
    expect(chatMarkdownHeadingLevel("2")).toBe(6);
  });

  it("output is always within the DOM 2..6 range", () => {
    for (let n = -5; n <= 12; n++) {
      const level = chatMarkdownHeadingLevel(n);
      expect(level).toBeGreaterThanOrEqual(2);
      expect(level).toBeLessThanOrEqual(6);
    }
  });

  it("output never equals 1 → no H1 collision with ChatPage h1", () => {
    for (let n = -5; n <= 12; n++) {
      expect(chatMarkdownHeadingLevel(n)).not.toBe(1);
    }
  });

  it("multi-call purity", () => {
    const a1 = chatMarkdownHeadingLevel(2);
    chatMarkdownHeadingLevel(5);
    const a2 = chatMarkdownHeadingLevel(2);
    expect(a1).toBe(a2);
  });
});

describe("chatMarkdownHeadingTag (s35 wave 26c)", () => {
  it("# → h2", () => {
    expect(chatMarkdownHeadingTag(1)).toBe("h2");
  });

  it("## → h3", () => {
    expect(chatMarkdownHeadingTag(2)).toBe("h3");
  });

  it("### → h4", () => {
    expect(chatMarkdownHeadingTag(3)).toBe("h4");
  });

  it("#### → h5", () => {
    expect(chatMarkdownHeadingTag(4)).toBe("h5");
  });

  it("##### → h6", () => {
    expect(chatMarkdownHeadingTag(5)).toBe("h6");
  });

  it("###### → h6", () => {
    expect(chatMarkdownHeadingTag(6)).toBe("h6");
  });

  it("never returns h1", () => {
    for (let n = -3; n <= 10; n++) {
      expect(chatMarkdownHeadingTag(n)).not.toBe("h1");
    }
  });

  it("null/undefined → h6 (defensive)", () => {
    expect(chatMarkdownHeadingTag(null)).toBe("h6");
    expect(chatMarkdownHeadingTag(undefined)).toBe("h6");
  });
});
