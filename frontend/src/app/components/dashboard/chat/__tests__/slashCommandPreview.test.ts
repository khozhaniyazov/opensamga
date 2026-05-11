import { describe, it, expect } from "vitest";
import {
  slashCommandPreviewText,
  shouldShowSlashCommandPreview,
  SLASH_PREVIEW_MAX_LENGTH,
} from "../slashCommandPreview";

describe("slashCommandPreviewText — guard cases", () => {
  it("returns '' on null / undefined / non-string", () => {
    expect(slashCommandPreviewText(null)).toBe("");
    expect(slashCommandPreviewText(undefined)).toBe("");
    expect(slashCommandPreviewText(123 as unknown as string)).toBe("");
  });

  it("returns '' for an all-whitespace string", () => {
    expect(slashCommandPreviewText("    \n\t  ")).toBe("");
  });

  it("returns the original short prompt unchanged (no ellipsis)", () => {
    const out = slashCommandPreviewText("Объясни мою последнюю ошибку.");
    expect(out).toBe("Объясни мою последнюю ошибку.");
    expect(out.endsWith("…")).toBe(false);
  });
});

describe("slashCommandPreviewText — collapse + trim", () => {
  it("collapses CRLF / LF / TAB into a single space", () => {
    expect(
      slashCommandPreviewText("line one\r\nline two\n\nline three\tindent"),
    ).toBe("line one line two line three indent");
  });

  it("trims leading + trailing whitespace", () => {
    expect(slashCommandPreviewText("   hello world   ")).toBe("hello world");
  });
});

describe("slashCommandPreviewText — truncation", () => {
  it("truncates to the default cap with a single ellipsis", () => {
    const long = "ab".repeat(200); // 400 chars
    const out = slashCommandPreviewText(long);
    // codepoint count == cap exactly
    expect(Array.from(out)).toHaveLength(SLASH_PREVIEW_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never produces multiple consecutive ellipses", () => {
    const out = slashCommandPreviewText("x".repeat(500));
    expect(out.match(/…/g)?.length ?? 0).toBe(1);
  });

  it("respects an explicit lower maxLength", () => {
    const out = slashCommandPreviewText("abcdefghijklmnop", 6);
    expect(Array.from(out)).toHaveLength(6);
    expect(out.endsWith("…")).toBe(true);
    // First 5 codepoints preserved.
    expect(out.startsWith("abcde")).toBe(true);
  });

  it("falls back to default cap on negative / non-finite maxLength", () => {
    const long = "a".repeat(500);
    expect(Array.from(slashCommandPreviewText(long, -10))).toHaveLength(
      SLASH_PREVIEW_MAX_LENGTH,
    );
    expect(Array.from(slashCommandPreviewText(long, Number.NaN))).toHaveLength(
      SLASH_PREVIEW_MAX_LENGTH,
    );
  });

  it("counts by codepoints, not UTF-16 units (no broken surrogates)", () => {
    // Each emoji is two UTF-16 code units but one codepoint.
    const emoji = "🎓".repeat(50);
    const out = slashCommandPreviewText(emoji, 10);
    expect(Array.from(out)).toHaveLength(10);
    // Last char must be the ellipsis, not half a surrogate.
    expect(out.endsWith("…")).toBe(true);
  });

  it("drops trailing whitespace produced by the cut before adding the ellipsis", () => {
    // "abcde " has a trailing space at index 5; truncating to 6 chars
    // would naively produce "abcde …" — the helper must collapse that.
    const out = slashCommandPreviewText("abcde     fghij", 6);
    expect(out).toBe("abcde…");
  });

  it("on a Cyrillic input that's borderline-cap-length, never breaks mid-codepoint", () => {
    const ru = "Объясни последнюю ошибку и предложи короткий план повторения.";
    // Force cap == length-1 to actually trigger truncation.
    const cap = Array.from(ru).length - 1;
    const out = slashCommandPreviewText(ru, cap);
    expect(Array.from(out)).toHaveLength(cap);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("shouldShowSlashCommandPreview", () => {
  it("returns false for empty / whitespace / non-string", () => {
    expect(shouldShowSlashCommandPreview("")).toBe(false);
    expect(shouldShowSlashCommandPreview("   \n\t")).toBe(false);
    expect(shouldShowSlashCommandPreview(null)).toBe(false);
    expect(shouldShowSlashCommandPreview(undefined)).toBe(false);
  });

  it("returns true for any non-empty trimmed prompt", () => {
    expect(shouldShowSlashCommandPreview("a")).toBe(true);
    expect(shouldShowSlashCommandPreview("  hello  ")).toBe(true);
  });
});
