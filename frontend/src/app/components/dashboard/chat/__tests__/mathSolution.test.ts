/**
 * s32 (C4) — vitest pins for the math-solution detection helpers.
 */

import { describe, expect, it } from "vitest";
import {
  countOrderedListItems,
  hasMathSignal,
  looksLikeMathSolution,
  stepLabel,
  stepPrefix,
} from "../mathSolution";

describe("countOrderedListItems", () => {
  it("counts top-level numbered items", () => {
    const md = "1. first\n2. second\n3. third";
    expect(countOrderedListItems(md)).toBe(3);
  });

  it("counts items even when separated by prose", () => {
    const md = "1. first\n\nProse here.\n\n2. second";
    expect(countOrderedListItems(md)).toBe(2);
  });

  it("returns 0 for unordered lists", () => {
    expect(countOrderedListItems("- a\n- b\n- c")).toBe(0);
  });

  it("returns 0 on empty input", () => {
    expect(countOrderedListItems("")).toBe(0);
    expect(countOrderedListItems("   \n   ")).toBe(0);
  });

  it("counts indented items up to 3 spaces (markdown spec)", () => {
    const md = "   1. one\n   2. two";
    expect(countOrderedListItems(md)).toBe(2);
  });
});

describe("hasMathSignal", () => {
  it("detects inline math $...$", () => {
    expect(hasMathSignal("solve $x^2 + 1 = 0$")).toBe(true);
  });

  it("detects display math $$...$$", () => {
    expect(hasMathSignal("$$\\int_0^1 x dx$$")).toBe(true);
  });

  it("detects \\frac / \\sqrt / \\int", () => {
    expect(hasMathSignal("the \\frac{a}{b} term")).toBe(true);
    expect(hasMathSignal("\\sqrt{2}")).toBe(true);
    expect(hasMathSignal("\\int x dx")).toBe(true);
  });

  it("detects power notation a^2", () => {
    expect(hasMathSignal("we get a^2 + b^2")).toBe(true);
  });

  it("detects equation-with-digit (= 5)", () => {
    expect(hasMathSignal("x = 5")).toBe(true);
  });

  it("returns false for plain prose", () => {
    expect(
      hasMathSignal("this is just a list of items in plain language"),
    ).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasMathSignal("")).toBe(false);
  });
});

describe("looksLikeMathSolution", () => {
  it("returns true for a numbered list with math signal", () => {
    const md = [
      "Решим уравнение:",
      "1. Запишем $x^2 + 4x + 3 = 0$",
      "2. Дискриминант $D = 16 - 12 = 4$",
      "3. Корни: $x_1 = -1, x_2 = -3$",
    ].join("\n");
    expect(looksLikeMathSolution(md)).toBe(true);
  });

  it("returns false for prose-only numbered lists", () => {
    const md = [
      "Three reasons to study:",
      "1. Discipline",
      "2. Curiosity",
      "3. Career",
    ].join("\n");
    expect(looksLikeMathSolution(md)).toBe(false);
  });

  it("returns false for math-only without a numbered list", () => {
    const md = "We have $x = 5$ and $y = 7$. The product is $35$.";
    expect(looksLikeMathSolution(md)).toBe(false);
  });

  it("returns false on a single numbered item (1. only)", () => {
    const md = "1. just one $x = 5$";
    expect(looksLikeMathSolution(md)).toBe(false);
  });

  it("returns false on null / undefined / empty input", () => {
    expect(looksLikeMathSolution(null)).toBe(false);
    expect(looksLikeMathSolution(undefined)).toBe(false);
    expect(looksLikeMathSolution("")).toBe(false);
  });

  it("returns false for non-string input (defensive)", () => {
    expect(looksLikeMathSolution(42 as unknown as string)).toBe(false);
  });
});

describe("stepPrefix", () => {
  it("returns the RU prefix for ru", () => {
    expect(stepPrefix("ru")).toBe("Шаг");
  });

  it("returns the KZ prefix for kz", () => {
    expect(stepPrefix("kz")).toBe("Қадам");
  });
});

describe("stepLabel", () => {
  it("composes the prefix and index", () => {
    expect(stepLabel(1, "ru")).toBe("Шаг 1:");
    expect(stepLabel(3, "kz")).toBe("Қадам 3:");
  });

  it("returns empty string on non-positive / non-finite idx", () => {
    expect(stepLabel(0, "ru")).toBe("");
    expect(stepLabel(-1, "ru")).toBe("");
    expect(stepLabel(Number.NaN, "ru")).toBe("");
    expect(stepLabel(Number.POSITIVE_INFINITY, "ru")).toBe("");
  });

  it("floors a non-integer idx", () => {
    expect(stepLabel(2.7, "ru")).toBe("Шаг 2:");
  });
});
