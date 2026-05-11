/**
 * v3.9 (F4, 2026-04-30) — vitest pins for voiceInputState.
 * Pure FSM + helpers. No DOM.
 */

import { describe, expect, it } from "vitest";
import {
  appendTranscriptToDraft,
  classifyVoiceError,
  shouldApplyTranscript,
  voiceMicAriaLabel,
  voiceReducer,
  type VoiceState,
} from "../voiceInputState";

describe("classifyVoiceError", () => {
  it("not-allowed / service-not-allowed → denied", () => {
    expect(classifyVoiceError("not-allowed")).toBe("denied");
    expect(classifyVoiceError("service-not-allowed")).toBe("denied");
  });
  it("audio-capture → no-mic", () => {
    expect(classifyVoiceError("audio-capture")).toBe("no-mic");
  });
  it("language-not-supported → lang-unsupported", () => {
    expect(classifyVoiceError("language-not-supported")).toBe(
      "lang-unsupported",
    );
  });
  it("network → network", () => {
    expect(classifyVoiceError("network")).toBe("network");
  });
  it("anything else → generic", () => {
    expect(classifyVoiceError("aborted")).toBe("generic");
    expect(classifyVoiceError("bad-grammar")).toBe("generic");
    expect(classifyVoiceError("")).toBe("generic");
  });
  it("non-string input → generic (defensive)", () => {
    expect(classifyVoiceError(null)).toBe("generic");
    expect(classifyVoiceError(undefined)).toBe("generic");
    expect(classifyVoiceError(42)).toBe("generic");
    expect(classifyVoiceError({})).toBe("generic");
  });
});

describe("voiceReducer — happy path", () => {
  it("idle → tap → requesting", () => {
    expect(voiceReducer({ kind: "idle" }, { type: "tap" })).toEqual({
      kind: "requesting",
    });
  });
  it("requesting → started → listening", () => {
    expect(voiceReducer({ kind: "requesting" }, { type: "started" })).toEqual({
      kind: "listening",
    });
  });
  it("listening → tap → idle (user stops)", () => {
    expect(voiceReducer({ kind: "listening" }, { type: "tap" })).toEqual({
      kind: "idle",
    });
  });
  it("listening → stopped → idle (recognizer ended)", () => {
    expect(voiceReducer({ kind: "listening" }, { type: "stopped" })).toEqual({
      kind: "idle",
    });
  });
});

describe("voiceReducer — error transitions", () => {
  it("idle → error → error{denied}", () => {
    expect(
      voiceReducer({ kind: "idle" }, { type: "error", reason: "denied" }),
    ).toEqual({ kind: "error", reason: "denied" });
  });
  it("requesting → error{network}", () => {
    expect(
      voiceReducer(
        { kind: "requesting" },
        { type: "error", reason: "network" },
      ),
    ).toEqual({ kind: "error", reason: "network" });
  });
  it("listening → error{generic}", () => {
    expect(
      voiceReducer({ kind: "listening" }, { type: "error", reason: "generic" }),
    ).toEqual({ kind: "error", reason: "generic" });
  });
  it("error → tap → requesting (retry)", () => {
    expect(
      voiceReducer({ kind: "error", reason: "denied" }, { type: "tap" }),
    ).toEqual({ kind: "requesting" });
  });
  it("error → late onerror → unchanged (drop, don't lose retry state)", () => {
    const before: VoiceState = { kind: "error", reason: "denied" };
    expect(voiceReducer(before, { type: "error", reason: "network" })).toBe(
      before,
    );
  });
});

describe("voiceReducer — defensive", () => {
  it("requesting → stopped (rare: recognizer aborts before onstart) → idle", () => {
    expect(voiceReducer({ kind: "requesting" }, { type: "stopped" })).toEqual({
      kind: "idle",
    });
  });
  it("idle → started → unchanged (no-op)", () => {
    const s: VoiceState = { kind: "idle" };
    expect(voiceReducer(s, { type: "started" })).toBe(s);
  });
  it("listening → started → unchanged (no-op)", () => {
    const s: VoiceState = { kind: "listening" };
    expect(voiceReducer(s, { type: "started" })).toBe(s);
  });
});

describe("voiceMicAriaLabel — RU/KZ + state-aware", () => {
  it("idle RU mentions диктовку", () => {
    expect(
      voiceMicAriaLabel({ state: { kind: "idle" }, lang: "ru" }),
    ).toContain("диктов");
  });
  it("idle KZ mentions басыңыз", () => {
    expect(
      voiceMicAriaLabel({ state: { kind: "idle" }, lang: "kz" }),
    ).toContain("басыңыз");
  });
  it("listening tells user the click stops", () => {
    expect(
      voiceMicAriaLabel({ state: { kind: "listening" }, lang: "ru" }),
    ).toContain("остановить");
  });
  it("error{denied} explains permission RU", () => {
    expect(
      voiceMicAriaLabel({
        state: { kind: "error", reason: "denied" },
        lang: "ru",
      }),
    ).toContain("микрофону");
  });
  it("error{denied} explains permission KZ", () => {
    expect(
      voiceMicAriaLabel({
        state: { kind: "error", reason: "denied" },
        lang: "kz",
      }),
    ).toContain("Микрофон");
  });
  it("error{lang-unsupported} both languages", () => {
    expect(
      voiceMicAriaLabel({
        state: { kind: "error", reason: "lang-unsupported" },
        lang: "ru",
      }),
    ).toContain("языка");
    expect(
      voiceMicAriaLabel({
        state: { kind: "error", reason: "lang-unsupported" },
        lang: "kz",
      }),
    ).toContain("тілге");
  });
  it("unknown lang treated as RU", () => {
    const fromUnknown = voiceMicAriaLabel({
      state: { kind: "idle" },
      lang: "en",
    });
    const fromRu = voiceMicAriaLabel({
      state: { kind: "idle" },
      lang: "ru",
    });
    expect(fromUnknown).toBe(fromRu);
  });
});

describe("shouldApplyTranscript", () => {
  it("non-empty string → true", () => {
    expect(shouldApplyTranscript("hello")).toBe(true);
  });
  it("empty string → false", () => {
    expect(shouldApplyTranscript("")).toBe(false);
  });
  it("whitespace-only → false", () => {
    expect(shouldApplyTranscript("   ")).toBe(false);
    expect(shouldApplyTranscript("\n\t")).toBe(false);
  });
  it("non-string → false", () => {
    expect(shouldApplyTranscript(null)).toBe(false);
    expect(shouldApplyTranscript(undefined)).toBe(false);
    expect(shouldApplyTranscript(42)).toBe(false);
  });
});

describe("appendTranscriptToDraft", () => {
  it("empty draft → transcript replaces (no leading space)", () => {
    expect(appendTranscriptToDraft("", "hello")).toBe("hello");
  });
  it("draft + transcript → space-joined", () => {
    expect(appendTranscriptToDraft("hello", "world")).toBe("hello world");
  });
  it("draft already ends in whitespace → no double space", () => {
    expect(appendTranscriptToDraft("hello ", "world")).toBe("hello world");
    expect(appendTranscriptToDraft("hello\n", "world")).toBe("hello\nworld");
  });
  it("transcript trimmed before appending", () => {
    expect(appendTranscriptToDraft("hello", "   world   ")).toBe("hello world");
  });
  it("empty transcript → draft unchanged", () => {
    expect(appendTranscriptToDraft("hello", "")).toBe("hello");
    expect(appendTranscriptToDraft("hello", "   ")).toBe("hello");
  });
  it("non-string draft → treated as empty", () => {
    expect(appendTranscriptToDraft(null as unknown, "hi")).toBe("hi");
    expect(appendTranscriptToDraft(42 as unknown, "hi")).toBe("hi");
  });
  it("non-string transcript → draft unchanged", () => {
    expect(appendTranscriptToDraft("hello", null as unknown)).toBe("hello");
    expect(appendTranscriptToDraft("hello", 42 as unknown)).toBe("hello");
  });
});

describe("purity", () => {
  it("voiceReducer is pure", () => {
    const s: VoiceState = { kind: "idle" };
    voiceReducer(s, { type: "tap" });
    voiceReducer(s, { type: "tap" });
    expect(s).toEqual({ kind: "idle" });
  });
  it("appendTranscriptToDraft does not mutate inputs", () => {
    const draft = "hello";
    const t = "world";
    appendTranscriptToDraft(draft, t);
    expect(draft).toBe("hello");
    expect(t).toBe("world");
  });
});
