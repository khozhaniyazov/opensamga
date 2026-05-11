/**
 * s34 wave 4 (C6 golden, 2026-04-28) — vitest pins for the
 * math-fence balancer. Acts as the C6 audit's golden:
 *   - well-formed `\frac` / `\sqrt` / `\int` payloads pass through
 *     unchanged in every fence kind;
 *   - mid-stream incomplete fences are detected;
 *   - balance() appends only closers, never reorders content.
 */

import { describe, expect, it } from "vitest";
import {
  balanceMathFences,
  countDollarFences,
  hasUnclosedMathFence,
  tallyMathFences,
} from "../mathFence";

describe("countDollarFences", () => {
  it("zero on empty / null", () => {
    expect(countDollarFences("")).toEqual({ dollarPairs: 0, dollarSingles: 0 });
    expect(countDollarFences(null)).toEqual({
      dollarPairs: 0,
      dollarSingles: 0,
    });
    expect(countDollarFences(undefined)).toEqual({
      dollarPairs: 0,
      dollarSingles: 0,
    });
  });

  it("zero when no dollars", () => {
    expect(countDollarFences("plain text only")).toEqual({
      dollarPairs: 0,
      dollarSingles: 0,
    });
  });

  it("pairs $$ greedily before singles", () => {
    expect(countDollarFences("$$x$$")).toEqual({
      dollarPairs: 2,
      dollarSingles: 0,
    });
    expect(countDollarFences("$$$$")).toEqual({
      dollarPairs: 2,
      dollarSingles: 0,
    });
  });

  it("counts inline pair as 2 singles", () => {
    expect(countDollarFences("$x$")).toEqual({
      dollarPairs: 0,
      dollarSingles: 2,
    });
  });

  it("mixes pairs and singles", () => {
    expect(countDollarFences("$$a$$ then $b$ and $$c$$")).toEqual({
      dollarPairs: 4,
      dollarSingles: 2,
    });
  });

  it("odd singles flag inline-math imbalance", () => {
    expect(countDollarFences("oh $\\frac{1}{2")).toEqual({
      dollarPairs: 0,
      dollarSingles: 1,
    });
  });
});

describe("tallyMathFences", () => {
  it("counts \\( \\) \\[ \\] independently of dollar fences", () => {
    const t = tallyMathFences("\\(a\\) and $$b$$ and \\[c\\] and $d$");
    expect(t.parenOpen).toBe(1);
    expect(t.parenClose).toBe(1);
    expect(t.bracketOpen).toBe(1);
    expect(t.bracketClose).toBe(1);
    expect(t.dollarPairs).toBe(2);
    expect(t.dollarSingles).toBe(2);
  });

  it("does not count escaped \\\\frac as a paren fence", () => {
    const t = tallyMathFences("$\\\\frac{a}{b}$");
    expect(t.parenOpen).toBe(0);
    expect(t.parenClose).toBe(0);
  });
});

describe("hasUnclosedMathFence (mid-stream detector)", () => {
  it("false on balanced inline $...$", () => {
    expect(hasUnclosedMathFence("the answer is $x = 5$ done")).toBe(false);
  });

  it("false on balanced display $$...$$", () => {
    expect(
      hasUnclosedMathFence("solve: $$\\frac{a}{b} = c$$ which gives"),
    ).toBe(false);
  });

  it("false on balanced \\(...\\)", () => {
    expect(hasUnclosedMathFence("we use \\(\\sqrt{x}\\) here")).toBe(false);
  });

  it("false on balanced \\[...\\]", () => {
    expect(
      hasUnclosedMathFence("we display: \\[\\int_0^1 x\\,dx\\] above"),
    ).toBe(false);
  });

  it("true mid-stream when $ opener is alone", () => {
    expect(hasUnclosedMathFence("solve $\\frac{1}{2")).toBe(true);
  });

  it("true mid-stream when $$ opener has no closer yet", () => {
    expect(hasUnclosedMathFence("compute $$x = a + b ")).toBe(true);
  });

  it("true mid-stream when \\[ has no \\] yet", () => {
    expect(hasUnclosedMathFence("display: \\[\\sum_{i=1}^n a_i ")).toBe(true);
  });

  it("true mid-stream when \\( has no \\) yet", () => {
    expect(hasUnclosedMathFence("inline: \\(\\sqrt{2}")).toBe(true);
  });

  it("true on null/undefined? — defensive false (nothing to render)", () => {
    expect(hasUnclosedMathFence(null)).toBe(false);
    expect(hasUnclosedMathFence(undefined)).toBe(false);
    expect(hasUnclosedMathFence("")).toBe(false);
  });
});

describe("balanceMathFences (renderer-safe finalizer)", () => {
  it("idempotent on balanced input", () => {
    const cases = [
      "no math at all",
      "inline: $a$",
      "display: $$\\frac{a}{b}$$",
      "paren: \\(\\sqrt{2}\\)",
      "bracket: \\[\\int_0^\\pi \\sin x \\, dx\\]",
      "mix: $a$ and $$b$$ and \\(c\\) and \\[d\\]",
    ];
    for (const c of cases) {
      expect(balanceMathFences(c)).toBe(c);
    }
  });

  it("appends $ to close odd inline math", () => {
    expect(balanceMathFences("solve $\\frac{1}{2")).toBe("solve $\\frac{1}{2$");
  });

  it("appends $$ to close odd display math", () => {
    expect(balanceMathFences("display: $$\\sqrt{x}")).toBe(
      "display: $$\\sqrt{x}$$",
    );
  });

  it("appends \\) when \\( has no closer", () => {
    expect(balanceMathFences("inline: \\(\\sum_i a_i")).toBe(
      "inline: \\(\\sum_i a_i\\)",
    );
  });

  it("appends \\] when \\[ has no closer", () => {
    expect(balanceMathFences("display: \\[\\int x dx")).toBe(
      "display: \\[\\int x dx\\]",
    );
  });

  it("repeats \\) for multiple unclosed \\(", () => {
    expect(balanceMathFences("a\\(b\\(c")).toBe("a\\(b\\(c\\)\\)");
  });

  it("only appends — never reorders chars", () => {
    const input = "Шаг 1: $\\frac{a}{b";
    const out = balanceMathFences(input);
    expect(out.startsWith(input)).toBe(true);
  });

  it("handles mixed unclosed fences in a single chunk", () => {
    const out = balanceMathFences("$ open and \\[ also open");
    // Must close $ and \[ in a deterministic order ($, then \])
    expect(out).toBe("$ open and \\[ also open$\\]");
  });

  it("non-string inputs return empty string / passthrough", () => {
    expect(balanceMathFences(null)).toBe("");
    expect(balanceMathFences(undefined)).toBe("");
    expect(balanceMathFences("")).toBe("");
  });
});

describe("C6 golden — well-formed LaTeX payloads survive untouched", () => {
  it("\\frac in inline + display fences renders without rewrite", () => {
    const samples = [
      "$\\frac{1}{2}$",
      "$$\\frac{a+b}{c-d}$$",
      "\\(\\frac{x^2}{y}\\)",
      "\\[\\frac{\\partial f}{\\partial x}\\]",
    ];
    for (const s of samples) {
      expect(hasUnclosedMathFence(s)).toBe(false);
      expect(balanceMathFences(s)).toBe(s);
    }
  });

  it("\\sqrt in inline + display fences renders without rewrite", () => {
    const samples = [
      "$\\sqrt{2}$",
      "$$\\sqrt[3]{x+y}$$",
      "\\(\\sqrt{a^2+b^2}\\)",
      "\\[\\sqrt{\\frac{a}{b}}\\]",
    ];
    for (const s of samples) {
      expect(hasUnclosedMathFence(s)).toBe(false);
      expect(balanceMathFences(s)).toBe(s);
    }
  });

  it("multi-step solution mixing $...$, $$...$$, \\frac, \\sqrt is balanced", () => {
    const sample = [
      "Шаг 1: подставляем $x = 2$ в формулу",
      "",
      "Шаг 2: получаем $$\\sqrt{\\frac{x^2 + 1}{2}} = \\sqrt{2.5}$$",
      "",
      "Шаг 3: упрощаем и получаем $\\frac{\\sqrt{10}}{2}$",
    ].join("\n");
    expect(hasUnclosedMathFence(sample)).toBe(false);
    expect(balanceMathFences(sample)).toBe(sample);
  });
});
