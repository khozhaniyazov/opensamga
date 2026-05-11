/**
 * s34 wave 6 (E4, 2026-04-28): pure-helper pins for thread export.
 *
 * Pattern matches mathFence/tapTarget tests — vitest, no DOM, no
 * react-testing-library. We deliberately do NOT exercise
 * triggerThreadDownload here (DOM-dependent); it'll be covered by
 * the manual-verification step on the staging build.
 */

import { describe, expect, it } from "vitest";
import {
  THREAD_EXPORT_FALLBACK_TITLE,
  THREAD_EXPORT_JSON_MIME,
  THREAD_EXPORT_JSON_VERSION,
  THREAD_EXPORT_MARKDOWN_MIME,
  buildExportFilename,
  formatThreadAsJson,
  formatThreadAsJsonEnvelope,
  formatThreadAsMarkdown,
  resolveThreadTitle,
  sanitizeFilenameSegment,
} from "../threadExport";
import type { Message } from "../types";

const FIXED_NOW = new Date("2026-04-28T12:34:56.000Z");

const sampleThread = {
  id: 42,
  title: "UNT Math review",
  created_at: "2026-04-20T08:00:00Z",
  updated_at: "2026-04-28T11:00:00Z",
};

const sampleMessages: Message[] = [
  { id: "u1", role: "user", text: "Объясни производные" },
  {
    id: "a1",
    role: "assistant",
    text: "<think>plan</think>Производная — это...",
    ragQueryLogId: 7,
  },
];

describe("resolveThreadTitle", () => {
  it("returns trimmed title when present", () => {
    expect(resolveThreadTitle({ title: "  Hello  " })).toBe("Hello");
  });

  it("falls back when title is null", () => {
    expect(resolveThreadTitle({ title: null })).toBe(
      THREAD_EXPORT_FALLBACK_TITLE,
    );
  });

  it("falls back when title is whitespace-only", () => {
    expect(resolveThreadTitle({ title: "   " })).toBe(
      THREAD_EXPORT_FALLBACK_TITLE,
    );
  });
});

describe("sanitizeFilenameSegment", () => {
  it("replaces forbidden chars with underscore", () => {
    expect(sanitizeFilenameSegment('a/b\\c:d*e?f"g<h>i|j')).toBe(
      "a_b_c_d_e_f_g_h_i_j",
    );
  });

  it("collapses whitespace runs to single underscore", () => {
    expect(sanitizeFilenameSegment("hello   world")).toBe("hello_world");
  });

  it("trims trailing dots and spaces", () => {
    expect(sanitizeFilenameSegment("  test...   ")).toBe("test");
  });

  it("clamps to 80 characters", () => {
    const long = "x".repeat(200);
    expect(sanitizeFilenameSegment(long).length).toBe(80);
  });

  it("falls back to 'thread' when input becomes empty", () => {
    expect(sanitizeFilenameSegment("///")).toBe("thread");
    expect(sanitizeFilenameSegment("")).toBe("thread");
  });
});

describe("buildExportFilename", () => {
  it("produces the deterministic markdown shape", () => {
    expect(
      buildExportFilename({ title: "UNT Math review" }, "markdown", FIXED_NOW),
    ).toBe("samga-chat-UNT_Math_review-20260428.md");
  });

  it("produces the deterministic json shape", () => {
    expect(
      buildExportFilename({ title: "UNT Math review" }, "json", FIXED_NOW),
    ).toBe("samga-chat-UNT_Math_review-20260428.json");
  });

  it("uses fallback slug when title is empty", () => {
    expect(buildExportFilename({ title: null }, "markdown", FIXED_NOW)).toBe(
      "samga-chat-Untitled_thread-20260428.md",
    );
  });
});

describe("formatThreadAsMarkdown", () => {
  it("emits an H1 with the thread title", () => {
    const out = formatThreadAsMarkdown(sampleThread, sampleMessages, FIXED_NOW);
    expect(out.startsWith("# UNT Math review\n")).toBe(true);
  });

  it("includes thread metadata header lines", () => {
    const out = formatThreadAsMarkdown(sampleThread, sampleMessages, FIXED_NOW);
    expect(out).toContain("- Created: 2026-04-20T08:00:00Z");
    expect(out).toContain("- Updated: 2026-04-28T11:00:00Z");
    expect(out).toContain("- Exported: 2026-04-28T12:34:56.000Z");
    expect(out).toContain("- Messages: 2");
  });

  it("renders user and assistant headings", () => {
    const out = formatThreadAsMarkdown(sampleThread, sampleMessages, FIXED_NOW);
    expect(out).toContain("### You");
    expect(out).toContain("### Assistant");
  });

  it("strips internal think blocks from the body", () => {
    const out = formatThreadAsMarkdown(sampleThread, sampleMessages, FIXED_NOW);
    expect(out).not.toContain("<think>");
    expect(out).not.toContain("plan</think>");
    expect(out).toContain("Производная");
  });

  it("renders empty bodies as the placeholder", () => {
    const empty: Message[] = [{ id: "x", role: "assistant", text: "" }];
    const out = formatThreadAsMarkdown(sampleThread, empty, FIXED_NOW);
    expect(out).toContain("_(empty)_");
  });

  it("separates messages with a horizontal rule", () => {
    const out = formatThreadAsMarkdown(sampleThread, sampleMessages, FIXED_NOW);
    expect(out).toContain("\n\n---\n\n");
  });
});

describe("formatThreadAsJsonEnvelope", () => {
  it("stamps the wire-format version", () => {
    const env = formatThreadAsJsonEnvelope(
      sampleThread,
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.version).toBe(THREAD_EXPORT_JSON_VERSION);
    expect(env.version).toBe(1);
  });

  it("includes exported_at and thread metadata", () => {
    const env = formatThreadAsJsonEnvelope(
      sampleThread,
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.exported_at).toBe("2026-04-28T12:34:56.000Z");
    expect(env.thread.id).toBe(42);
    expect(env.thread.title).toBe("UNT Math review");
  });

  it("strips think blocks from message text", () => {
    const env = formatThreadAsJsonEnvelope(
      sampleThread,
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.messages[1].text).not.toContain("<think>");
    expect(env.messages[1].text).toContain("Производная");
  });

  it("preserves rag_query_log_id when present", () => {
    const env = formatThreadAsJsonEnvelope(
      sampleThread,
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.messages[1].rag_query_log_id).toBe(7);
  });

  it("defaults rag_query_log_id to null on user turns", () => {
    const env = formatThreadAsJsonEnvelope(
      sampleThread,
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.messages[0].rag_query_log_id).toBeNull();
  });

  it("handles a null thread.id", () => {
    const env = formatThreadAsJsonEnvelope(
      { ...sampleThread, id: null },
      sampleMessages,
      FIXED_NOW,
    );
    expect(env.thread.id).toBeNull();
  });
});

describe("formatThreadAsJson (string form)", () => {
  it("returns valid JSON that round-trips", () => {
    const out = formatThreadAsJson(sampleThread, sampleMessages, FIXED_NOW);
    expect(() => JSON.parse(out)).not.toThrow();
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(1);
    expect(parsed.messages).toHaveLength(2);
  });

  it("is pretty-printed with 2-space indent", () => {
    const out = formatThreadAsJson(sampleThread, sampleMessages, FIXED_NOW);
    expect(out).toContain('  "version": 1');
  });
});

describe("MIME constants", () => {
  it("markdown mime declares charset", () => {
    expect(THREAD_EXPORT_MARKDOWN_MIME).toContain("text/markdown");
    expect(THREAD_EXPORT_MARKDOWN_MIME).toContain("charset=utf-8");
  });

  it("json mime declares charset", () => {
    expect(THREAD_EXPORT_JSON_MIME).toContain("application/json");
    expect(THREAD_EXPORT_JSON_MIME).toContain("charset=utf-8");
  });
});
