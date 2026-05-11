/**
 * s33 wave 3 (C3) — vitest pins for the collapsible-code helpers.
 */

import { describe, expect, it } from "vitest";
import {
  COLLAPSE_LINE_THRESHOLD,
  COLLAPSE_PREVIEW_LINES,
  collapseToggleLabel,
  copyButtonLabel,
  countCodeLines,
  previewLines,
  shouldCollapseCode,
} from "../codeCollapse";

describe("constants", () => {
  it("threshold is 30 lines (boss-stated)", () => {
    expect(COLLAPSE_LINE_THRESHOLD).toBe(30);
  });
  it("preview slice is 12 lines", () => {
    expect(COLLAPSE_PREVIEW_LINES).toBe(12);
  });
});

describe("countCodeLines", () => {
  it("returns 0 for empty / null / non-string", () => {
    expect(countCodeLines("")).toBe(0);
    expect(countCodeLines(null)).toBe(0);
    expect(countCodeLines(undefined)).toBe(0);
    expect(countCodeLines(42 as any)).toBe(0);
  });

  it("returns 1 for a single line (no newline)", () => {
    expect(countCodeLines("hello")).toBe(1);
  });

  it("treats trailing newline as part of the prior line", () => {
    expect(countCodeLines("a\n")).toBe(1);
    expect(countCodeLines("a\nb\n")).toBe(2);
  });

  it("counts intermediate newlines", () => {
    expect(countCodeLines("a\nb\nc")).toBe(3);
    expect(countCodeLines("a\nb\nc\n")).toBe(3);
  });

  it("handles a blank-line-only input", () => {
    expect(countCodeLines("\n")).toBe(1);
    expect(countCodeLines("\n\n")).toBe(2);
  });
});

describe("shouldCollapseCode", () => {
  it("false on tiny blocks", () => {
    expect(shouldCollapseCode("a\nb\nc")).toBe(false);
  });

  it("false right below the threshold (29 lines)", () => {
    const lines = Array.from({ length: 29 }, (_, i) => `line ${i}`).join("\n");
    expect(shouldCollapseCode(lines)).toBe(false);
  });

  it("true at the threshold (30 lines, >= trip)", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    expect(shouldCollapseCode(lines)).toBe(true);
  });

  it("true well above the threshold", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    expect(shouldCollapseCode(lines)).toBe(true);
  });

  it("defends against null/non-string", () => {
    expect(shouldCollapseCode(null)).toBe(false);
    expect(shouldCollapseCode(undefined)).toBe(false);
  });
});

describe("previewLines", () => {
  it("returns full code unchanged when not collapsible", () => {
    const code = "a\nb\nc";
    expect(previewLines(code)).toBe(code);
  });

  it("returns 12-line slice (default) when collapsible", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
    const out = previewLines(lines.join("\n"));
    expect(out.split("\n").length).toBe(12);
    expect(out.startsWith("L0\nL1\n")).toBe(true);
    expect(out.endsWith("L11")).toBe(true);
  });

  it("respects custom previewCount override", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
    const out = previewLines(lines.join("\n"), 5);
    expect(out.split("\n").length).toBe(5);
  });

  it("clamps negative previewCount to 0 (returns empty string)", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
    expect(previewLines(lines.join("\n"), -3)).toBe("");
  });

  it("returns '' for non-string input", () => {
    expect(previewLines(null)).toBe("");
    expect(previewLines(undefined)).toBe("");
  });
});

describe("collapseToggleLabel", () => {
  it("RU expanded → 'Свернуть'", () => {
    expect(
      collapseToggleLabel({ expanded: true, totalLines: 100, lang: "ru" }),
    ).toBe("Свернуть");
  });

  it("RU collapsed includes total line count", () => {
    expect(
      collapseToggleLabel({ expanded: false, totalLines: 87, lang: "ru" }),
    ).toBe("Показать полностью (87 строк)");
  });

  it("KZ collapsed includes total line count with жол unit", () => {
    expect(
      collapseToggleLabel({ expanded: false, totalLines: 50, lang: "kz" }),
    ).toBe("Толық көрсету (50 жол)");
  });

  it("KZ expanded → 'Жасыру'", () => {
    expect(
      collapseToggleLabel({ expanded: true, totalLines: 50, lang: "kz" }),
    ).toBe("Жасыру");
  });
});

describe("copyButtonLabel", () => {
  it("RU pre/post-copy", () => {
    expect(copyButtonLabel({ copied: false, lang: "ru" })).toBe("Копировать");
    expect(copyButtonLabel({ copied: true, lang: "ru" })).toBe("Скопировано");
  });

  it("KZ pre/post-copy", () => {
    expect(copyButtonLabel({ copied: false, lang: "kz" })).toBe("Көшіру");
    expect(copyButtonLabel({ copied: true, lang: "kz" })).toBe("Көшірілді");
  });
});
