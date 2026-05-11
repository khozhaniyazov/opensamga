/**
 * s27 (2026-04-27): first vitest pin tests for the chat-message
 * normalization helpers in `../utils.ts`.
 *
 * These helpers ride between the SSE handler and the renderer; they
 * scrub `<think>...</think>` blocks, tool-call XML leaks, and
 * unwrapped English chain-of-thought paragraphs that some Qwen
 * variants leak as the first paragraph. They also re-inject the
 * structured citation hint when persisted history is reloaded.
 *
 * Why pin them:
 *   - The CoT-stripper is a 3-condition heuristic (opener / no
 *     Cyrillic / Cyrillic tail) and easy to over-tighten.
 *   - The reasoning-block stripper handles ~8 markup variants the
 *     backend has produced over time; a regression here puts raw XML
 *     in user-visible bubbles.
 *   - These are exactly the helpers the s26 phase 5 / s27 fixes
 *     touched, so future edits should fail tests, not the QA pass.
 */
import { describe, it, expect } from "vitest";
import {
  markdownToPlainText,
  reinjectCitationHint,
  stripLeadingEnglishCoT,
  stripReasoningBlocks,
} from "../utils";

describe("stripLeadingEnglishCoT", () => {
  it("strips a CoT opener paragraph followed by RU body", () => {
    const input =
      "The user is asking about Newton's second law.\n\n" +
      "Второй закон Ньютона связывает силу и ускорение: F = m·a.";
    const out = stripLeadingEnglishCoT(input);
    expect(out.startsWith("Второй закон Ньютона")).toBe(true);
    expect(out).not.toMatch(/The user is asking/i);
  });

  it("strips a CoT opener paragraph followed by KZ body", () => {
    const input =
      "Let me think about this carefully.\n\n" +
      "Ньютонның екінші заңы — F = m·a.";
    const out = stripLeadingEnglishCoT(input);
    expect(out).toMatch(/Ньютонның/);
    expect(out).not.toMatch(/Let me think/i);
  });

  it("preserves a legitimate English answer (no Cyrillic anywhere)", () => {
    // No Cyrillic tail → guard (c) blocks the strip.
    const input =
      "I should explain Newton's second law clearly.\n\n" +
      "Newton's second law states F = m·a.";
    const out = stripLeadingEnglishCoT(input);
    expect(out).toBe(input);
  });

  it("leaves text without a CoT opener untouched", () => {
    const input = "Hello there!\n\n" + "Привет, давай решим задачу.";
    const out = stripLeadingEnglishCoT(input);
    expect(out).toBe(input);
  });

  it("does not strip a paragraph that is itself in Cyrillic", () => {
    // Even if the opener regex matched, guard (b) needs zero Cyrillic.
    const input =
      "Я думаю, что the user wants help.\n\n" + "Конкретный ответ: 42.";
    const out = stripLeadingEnglishCoT(input);
    expect(out).toBe(input);
  });

  it("returns single-paragraph input unchanged", () => {
    expect(stripLeadingEnglishCoT("Just one paragraph.")).toBe(
      "Just one paragraph.",
    );
  });

  it("handles empty input safely", () => {
    expect(stripLeadingEnglishCoT("")).toBe("");
  });

  it("strips 'Okay, the student wants ...' opener", () => {
    const input =
      "Okay, the student wants to know about photosynthesis.\n\n" +
      "Фотосинтез — это процесс преобразования энергии света.";
    const out = stripLeadingEnglishCoT(input);
    expect(out.startsWith("Фотосинтез")).toBe(true);
  });
});

describe("stripReasoningBlocks", () => {
  it("removes <think>...</think> blocks", () => {
    const input =
      "<think>let me decide which tool to call</think>Видимый ответ.";
    expect(stripReasoningBlocks(input)).toBe("Видимый ответ.");
  });

  it("removes unclosed <think> blocks (truncated stream)", () => {
    const input = "<think>step one\nstep two\nstep three";
    // Whole opener block consumed; result is empty after trim.
    expect(stripReasoningBlocks(input)).toBe("");
  });

  it("removes provider:tool_call XML leaks", () => {
    const input =
      'Pre <function:tool_call><invoke name="x"><parameter name="y">z</parameter></invoke></function:tool_call> post.';
    const out = stripReasoningBlocks(input);
    expect(out).not.toMatch(/tool_call/);
    expect(out).not.toMatch(/invoke/);
    expect(out).toMatch(/^Pre/);
    expect(out).toMatch(/post\.$/);
  });

  it("removes literal <function_calls>...</function_calls> blocks", () => {
    const input = "Before <function_calls>{...}</function_calls> after.";
    const out = stripReasoningBlocks(input);
    expect(out).not.toMatch(/function_calls/);
    expect(out).toMatch(/Before/);
    expect(out).toMatch(/after/);
  });

  it("removes [TOOL_CALL] bracket blocks", () => {
    const input = "x [TOOL_CALL]payload[/TOOL_CALL] y";
    const out = stripReasoningBlocks(input);
    expect(out).not.toMatch(/TOOL_CALL/);
  });

  it("collapses 3+ blank lines to one paragraph break", () => {
    const input = "first\n\n\n\nsecond";
    expect(stripReasoningBlocks(input)).toBe("first\n\nsecond");
  });

  it("composes with stripLeadingEnglishCoT", () => {
    // Reasoning block first, then CoT-style English head, then real RU body.
    const input =
      "<think>hidden reasoning</think>" +
      "The user is asking about derivatives.\n\n" +
      "Производная функции — это предел отношения.";
    const out = stripReasoningBlocks(input);
    expect(out.startsWith("Производная")).toBe(true);
    expect(out).not.toMatch(/<think>/);
    expect(out).not.toMatch(/The user is asking/i);
  });
});

describe("reinjectCitationHint", () => {
  it("prepends the hint when missing and metadata has both ids", () => {
    const out = reinjectCitationHint("Body of the answer.", {
      book_id: 257,
      page_number: 66,
    });
    expect(out).toBe(
      "<!-- samga-citation book_id=257 page=66 -->\nBody of the answer.",
    );
  });

  it("is idempotent when the hint is already present", () => {
    const content = "<!-- samga-citation book_id=257 page=66 -->\nBody.";
    const out = reinjectCitationHint(content, {
      book_id: 257,
      page_number: 66,
    });
    expect(out).toBe(content);
  });

  it("is a no-op when meta is null/undefined", () => {
    const content = "Body.";
    expect(reinjectCitationHint(content, null)).toBe(content);
    expect(reinjectCitationHint(content, undefined)).toBe(content);
  });

  it("is a no-op when book_id or page_number is missing", () => {
    const content = "Body.";
    expect(reinjectCitationHint(content, { book_id: 1 } as any)).toBe(content);
    expect(reinjectCitationHint(content, { page_number: 1 } as any)).toBe(
      content,
    );
  });

  it("is a no-op on empty content", () => {
    expect(reinjectCitationHint("", { book_id: 1, page_number: 1 })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// markdownToPlainText (s29 C2)
// ---------------------------------------------------------------------------

describe("markdownToPlainText", () => {
  it("strips bold/italic markers but keeps text", () => {
    expect(markdownToPlainText("**bold** and *italic*")).toBe(
      "bold and italic",
    );
  });
  it("strips ATX heading markers", () => {
    const md = "# H1\n\n## H2\n\n### H3\n\nbody";
    const out = markdownToPlainText(md);
    expect(out).toContain("H1");
    expect(out).toContain("H2");
    expect(out).toContain("H3");
    expect(out).not.toMatch(/^#/m);
  });
  it("rewrites links as text (url)", () => {
    expect(markdownToPlainText("[Samga](https://samga.kz)")).toBe(
      "Samga (https://samga.kz)",
    );
  });
  it("collapses bare-URL link to just the URL", () => {
    expect(markdownToPlainText("[https://x.io](https://x.io)")).toBe(
      "https://x.io",
    );
  });
  it("strips list markers but keeps order/lines", () => {
    const md = "- one\n- two\n- three";
    const out = markdownToPlainText(md);
    expect(out).toBe("one\ntwo\nthree");
  });
  it("strips ordered-list markers", () => {
    expect(markdownToPlainText("1. first\n2. second")).toBe("first\nsecond");
  });
  it("preserves fenced code body, drops the fences", () => {
    const md = "Before.\n\n```python\nprint('hi')\n```\n\nAfter.";
    const out = markdownToPlainText(md);
    expect(out).toContain("print('hi')");
    expect(out).not.toContain("```");
  });
  it("strips inline code backticks", () => {
    expect(markdownToPlainText("Use `foo()` here.")).toBe("Use foo() here.");
  });
  it("drops the samga-citation comment", () => {
    const md = "<!-- samga-citation book_id=1 page=1 -->\nBody.";
    expect(markdownToPlainText(md)).toBe("Body.");
  });
  it("collapses 3+ blank lines to 2", () => {
    expect(markdownToPlainText("a\n\n\n\nb")).toBe("a\n\nb");
  });
  it("empty input returns empty string", () => {
    expect(markdownToPlainText("")).toBe("");
  });
  it("strips blockquote markers", () => {
    expect(markdownToPlainText("> quoted line")).toBe("quoted line");
  });
});
