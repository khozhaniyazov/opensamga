/**
 * s35 wave 37 (2026-04-28) — vitest pin tests for
 * `imeCompositionState`. Pure-FSM helpers, no DOM.
 */

import { describe, expect, it } from "vitest";
import {
  nextImeComposing,
  shouldSuppressEnterForIme,
} from "../imeCompositionState";

describe("nextImeComposing — happy path", () => {
  it("compositionstart → true (from false)", () => {
    expect(
      nextImeComposing({ eventType: "compositionstart", prev: false }),
    ).toBe(true);
  });

  it("compositionend → false (from true)", () => {
    expect(nextImeComposing({ eventType: "compositionend", prev: true })).toBe(
      false,
    );
  });

  it("compositionupdate → unchanged (true stays true)", () => {
    expect(
      nextImeComposing({ eventType: "compositionupdate", prev: true }),
    ).toBe(true);
  });

  it("compositionupdate → unchanged (false stays false)", () => {
    expect(
      nextImeComposing({ eventType: "compositionupdate", prev: false }),
    ).toBe(false);
  });
});

describe("nextImeComposing — defensive", () => {
  it("unknown event type → unchanged", () => {
    expect(nextImeComposing({ eventType: "blur", prev: true })).toBe(true);
    expect(nextImeComposing({ eventType: "input", prev: false })).toBe(false);
  });

  it("undefined / null event type → unchanged", () => {
    expect(nextImeComposing({ eventType: undefined, prev: true })).toBe(true);
    expect(nextImeComposing({ eventType: null, prev: false })).toBe(false);
  });

  it("non-string event type → unchanged", () => {
    expect(nextImeComposing({ eventType: 42, prev: true })).toBe(true);
    expect(nextImeComposing({ eventType: {}, prev: false })).toBe(false);
  });

  it("non-boolean prev coerced to strict boolean", () => {
    // Non-true `prev` is treated as false; on update we return that
    // coerced false rather than echoing the truthy garbage.
    expect(nextImeComposing({ eventType: "compositionupdate", prev: 1 })).toBe(
      false,
    );
    expect(
      nextImeComposing({ eventType: "compositionupdate", prev: "yes" }),
    ).toBe(false);
  });

  it("compositionstart still wins regardless of prev", () => {
    expect(nextImeComposing({ eventType: "compositionstart", prev: 0 })).toBe(
      true,
    );
    expect(
      nextImeComposing({ eventType: "compositionstart", prev: undefined }),
    ).toBe(true);
  });

  it("compositionend still wins regardless of prev", () => {
    expect(nextImeComposing({ eventType: "compositionend", prev: 1 })).toBe(
      false,
    );
    expect(
      nextImeComposing({ eventType: "compositionend", prev: "active" }),
    ).toBe(false);
  });
});

describe("nextImeComposing — purity", () => {
  it("same input → same output, no hidden state", () => {
    const a = nextImeComposing({ eventType: "compositionstart", prev: false });
    nextImeComposing({ eventType: "compositionend", prev: true });
    nextImeComposing({ eventType: "compositionupdate", prev: true });
    const b = nextImeComposing({ eventType: "compositionstart", prev: false });
    expect(a).toBe(b);
  });
});

describe("shouldSuppressEnterForIme", () => {
  it("react-side flag true → suppress", () => {
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: true,
        trackedComposing: false,
      }),
    ).toBe(true);
  });

  it("tracked-side flag true → suppress", () => {
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: false,
        trackedComposing: true,
      }),
    ).toBe(true);
  });

  it("both true → suppress", () => {
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: true,
        trackedComposing: true,
      }),
    ).toBe(true);
  });

  it("both false → do NOT suppress", () => {
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: false,
        trackedComposing: false,
      }),
    ).toBe(false);
  });

  it("non-boolean inputs → strict false unless explicitly true", () => {
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: 1,
        trackedComposing: "yes",
      }),
    ).toBe(false);
    expect(
      shouldSuppressEnterForIme({
        reactIsComposing: undefined,
        trackedComposing: null,
      }),
    ).toBe(false);
  });

  it("purity: same input → same output", () => {
    const a = shouldSuppressEnterForIme({
      reactIsComposing: false,
      trackedComposing: true,
    });
    shouldSuppressEnterForIme({
      reactIsComposing: true,
      trackedComposing: true,
    });
    const b = shouldSuppressEnterForIme({
      reactIsComposing: false,
      trackedComposing: true,
    });
    expect(a).toBe(b);
  });
});
