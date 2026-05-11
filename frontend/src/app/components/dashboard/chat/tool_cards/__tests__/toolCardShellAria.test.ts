import { describe, it, expect } from "vitest";
import { toolCardHeadingId } from "../toolCardShellAria";

describe("toolCardHeadingId (s35 wave 28a)", () => {
  it("simple ASCII title", () => {
    expect(toolCardHeadingId("Grant Chance")).toBe("tool-card-grant-chance");
  });

  it("Cyrillic title", () => {
    expect(toolCardHeadingId("Подходящие университеты")).toBe(
      "tool-card-подходящие-университеты",
    );
  });

  it("Kazakh-language title", () => {
    expect(toolCardHeadingId("Соңғы сұхбаттар")).toBe(
      "tool-card-соңғы-сұхбаттар",
    );
  });

  it("collapses repeated separators / punctuation", () => {
    expect(toolCardHeadingId("Foo --- Bar !!! Baz")).toBe(
      "tool-card-foo-bar-baz",
    );
  });

  it("trims surrounding whitespace and dashes", () => {
    expect(toolCardHeadingId("   Hello world   ")).toBe(
      "tool-card-hello-world",
    );
  });

  it("preserves digits", () => {
    expect(toolCardHeadingId("Top 5 unis 2026")).toBe(
      "tool-card-top-5-unis-2026",
    );
  });

  it("non-string inputs → fallback id", () => {
    // Function takes `unknown`; these intentionally exercise the
    // runtime guard branch.
    expect(toolCardHeadingId(null)).toBe("tool-card");
    expect(toolCardHeadingId(undefined)).toBe("tool-card");
    expect(toolCardHeadingId(123)).toBe("tool-card");
    expect(toolCardHeadingId({})).toBe("tool-card");
  });

  it("empty / whitespace-only string → fallback id", () => {
    expect(toolCardHeadingId("")).toBe("tool-card");
    expect(toolCardHeadingId("   ")).toBe("tool-card");
  });

  it("punctuation-only string → fallback id", () => {
    expect(toolCardHeadingId("!!!---???")).toBe("tool-card");
  });

  it("output always starts with the prefix", () => {
    for (const t of ["a", "Grant", "Подходящие", "  spaced  "]) {
      expect(toolCardHeadingId(t)).toMatch(/^tool-card-/);
    }
  });

  it("output never contains spaces or capitals", () => {
    for (const t of ["Grant Chance Gauge", "User Profile", "RECENT MISTAKES"]) {
      const id = toolCardHeadingId(t);
      expect(id).not.toMatch(/[A-Z\s]/);
    }
  });

  it("idempotent: same input same output", () => {
    expect(toolCardHeadingId("Foo Bar")).toBe(toolCardHeadingId("Foo Bar"));
    expect(toolCardHeadingId("Подходящие")).toBe(
      toolCardHeadingId("Подходящие"),
    );
  });

  it("multi-call purity (different inputs in between)", () => {
    const a1 = toolCardHeadingId("X");
    toolCardHeadingId("Y");
    toolCardHeadingId("");
    const a2 = toolCardHeadingId("X");
    expect(a1).toBe(a2);
  });

  it("mixed Cyrillic + ASCII", () => {
    expect(toolCardHeadingId("Top 5 университетов")).toBe(
      "tool-card-top-5-университетов",
    );
  });
});
