/**
 * s35 wave 51 (2026-04-28) — AssistantMessageRow pure-helper pins.
 *
 * Component-contract tests intentionally omitted: AssistantMessageRow
 * pulls in 11 child components (ReasoningPanel, AssistantMessage,
 * SkeletonBubble, BackpressureIndicator, 6 pills, ToolResultCard,
 * FeedbackButtons, MessageActions) — most of which read multiple
 * contexts (LanguageContext, MessagesContext, FeedbackContext) and
 * fire telemetry. A render-this-from-RTL test would either require
 * a 5-provider wrapper (high churn surface) or stub all 11 children
 * (defeats the purpose of an integration pin).
 *
 * The two pure helpers `assistantHasReasoning` and `assistantHasText`
 * cover the predicates that decide whether the row's three biggest
 * branches even render — that's the regression surface that matters
 * after a refactor. The composition itself is exercised by the
 * existing PR-level e2e flow + the live-verified streaming path.
 */

import { describe, expect, it } from "vitest";
import {
  assistantHasReasoning,
  assistantHasText,
} from "../AssistantMessageRow";
import type { MessagePart } from "../types";

describe("assistantHasReasoning", () => {
  it("returns true when at least one part is a tool_call", () => {
    const parts: MessagePart[] = [
      {
        kind: "tool_call",
        name: "consult_library",
        arguments: {},
        result: null,
      } as any,
    ];
    expect(assistantHasReasoning(parts, false)).toBe(true);
  });

  it("returns true when at least one thinking part has non-empty text", () => {
    const parts: MessagePart[] = [
      { kind: "thinking", text: "Let me check the textbook…" },
    ];
    expect(assistantHasReasoning(parts, false)).toBe(true);
  });

  it("returns false on a thinking part with whitespace-only text", () => {
    const parts: MessagePart[] = [{ kind: "thinking", text: "   \n\t  " }];
    expect(assistantHasReasoning(parts, false)).toBe(false);
  });

  it("returns true on the streaming tail with empty parts (panel shell)", () => {
    // While the bubble is still being built, the panel renders an
    // empty shell so its fade-in is visible the moment the first
    // part arrives.
    expect(assistantHasReasoning([], true)).toBe(true);
    expect(assistantHasReasoning(null, true)).toBe(true);
    expect(assistantHasReasoning(undefined, true)).toBe(true);
  });

  it("returns false on a non-streaming bubble with no reasoning parts", () => {
    expect(assistantHasReasoning([], false)).toBe(false);
    expect(assistantHasReasoning(null, false)).toBe(false);
    expect(assistantHasReasoning(undefined, false)).toBe(false);
  });

  it("returns false on a streaming tail that already has parts but none reasoning-shaped", () => {
    // Once parts have landed but they're all bare prose (e.g. a
    // legacy envelope), the panel shouldn't open the empty-shell
    // path — there's nothing to fade in to.
    const parts = [{ kind: "text", text: "Hello" } as unknown as MessagePart];
    expect(assistantHasReasoning(parts, true)).toBe(false);
  });

  it("ignores non-array parts defensively", () => {
    // Mid-migration we've seen `parts: null` and `parts` come back
    // as a stringified blob. Both should fall back to false unless
    // we're streaming the empty-shell case.
    expect(
      assistantHasReasoning("nope" as unknown as MessagePart[], false),
    ).toBe(false);
    expect(assistantHasReasoning({} as unknown as MessagePart[], false)).toBe(
      false,
    );
  });
});

describe("assistantHasText", () => {
  it("returns true on a non-empty trimmed string", () => {
    expect(assistantHasText("Hello")).toBe(true);
    expect(assistantHasText("  Hello world  ")).toBe(true);
  });

  it("returns false on empty / whitespace-only / non-string", () => {
    expect(assistantHasText("")).toBe(false);
    expect(assistantHasText("   ")).toBe(false);
    expect(assistantHasText("\n\t")).toBe(false);
    expect(assistantHasText(null)).toBe(false);
    expect(assistantHasText(undefined)).toBe(false);
    expect(assistantHasText(0 as unknown as string)).toBe(false);
    expect(assistantHasText({ length: 5 } as unknown as string)).toBe(false);
  });
});
