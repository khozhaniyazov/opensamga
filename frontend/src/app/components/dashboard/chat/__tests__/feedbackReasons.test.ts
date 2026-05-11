/**
 * s34 wave 7 (I3 closeout, 2026-04-28): vitest pins for
 * feedbackReasons.ts.
 *
 * The packer + parser is the contract that analytics will rely on
 * once I2 (weekly roll-up) lands next session. Pin every round-trip
 * shape so a future refactor can't silently break the analytics
 * extractor.
 */

import { describe, expect, it } from "vitest";
import {
  FEEDBACK_COMMENT_MAX_LEN,
  FEEDBACK_REASONS_KZ,
  FEEDBACK_REASONS_RU,
  isFeedbackReasonId,
  packFeedbackComment,
  parseFeedbackComment,
} from "../feedbackReasons";

describe("FEEDBACK_REASONS_RU / KZ", () => {
  it("ships exactly 4 canned reasons for RU", () => {
    expect(FEEDBACK_REASONS_RU).toHaveLength(4);
  });

  it("ships exactly 4 canned reasons for KZ", () => {
    expect(FEEDBACK_REASONS_KZ).toHaveLength(4);
  });

  it("KZ and RU lists share the same id ordering", () => {
    const ruIds = FEEDBACK_REASONS_RU.map((r) => r.id);
    const kzIds = FEEDBACK_REASONS_KZ.map((r) => r.id);
    expect(kzIds).toEqual(ruIds);
  });

  it("uses the canonical id set", () => {
    const ids = FEEDBACK_REASONS_RU.map((r) => r.id).sort();
    expect(ids).toEqual(["inaccurate", "incomplete", "off_topic", "rude"]);
  });
});

describe("FEEDBACK_COMMENT_MAX_LEN", () => {
  it("matches the textarea maxLength", () => {
    // Locked by contract — bump both this and the JSX in the same
    // commit if you ever need more.
    expect(FEEDBACK_COMMENT_MAX_LEN).toBe(400);
  });
});

describe("isFeedbackReasonId", () => {
  it("accepts all four canonical ids", () => {
    expect(isFeedbackReasonId("off_topic")).toBe(true);
    expect(isFeedbackReasonId("inaccurate")).toBe(true);
    expect(isFeedbackReasonId("incomplete")).toBe(true);
    expect(isFeedbackReasonId("rude")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isFeedbackReasonId("hallucinated")).toBe(false);
    expect(isFeedbackReasonId("")).toBe(false);
    expect(isFeedbackReasonId("OFF_TOPIC")).toBe(false);
  });
});

describe("packFeedbackComment", () => {
  it("returns null when both inputs are empty", () => {
    expect(packFeedbackComment(null, "")).toBeNull();
  });

  it("returns null when free text is whitespace-only", () => {
    expect(packFeedbackComment(null, "   \n  ")).toBeNull();
  });

  it("packs reason only", () => {
    expect(packFeedbackComment("off_topic", "")).toBe("reason=off_topic");
  });

  it("packs free text only", () => {
    expect(packFeedbackComment(null, "Это вообще не ответ")).toBe(
      "Это вообще не ответ",
    );
  });

  it("packs reason + free text with the documented separator", () => {
    expect(packFeedbackComment("inaccurate", "Дата неверна")).toBe(
      "reason=inaccurate; Дата неверна",
    );
  });

  it("trims free-text leading/trailing whitespace", () => {
    expect(packFeedbackComment("rude", "  rude reply  ")).toBe(
      "reason=rude; rude reply",
    );
  });
});

describe("parseFeedbackComment", () => {
  it("returns empty defaults for null/undefined", () => {
    expect(parseFeedbackComment(null)).toEqual({
      reason: null,
      freeText: "",
    });
    expect(parseFeedbackComment(undefined)).toEqual({
      reason: null,
      freeText: "",
    });
  });

  it("returns empty defaults for empty string", () => {
    expect(parseFeedbackComment("")).toEqual({ reason: null, freeText: "" });
  });

  it("recovers reason-only", () => {
    expect(parseFeedbackComment("reason=off_topic")).toEqual({
      reason: "off_topic",
      freeText: "",
    });
  });

  it("recovers reason + free text", () => {
    expect(parseFeedbackComment("reason=inaccurate; Дата неверна")).toEqual({
      reason: "inaccurate",
      freeText: "Дата неверна",
    });
  });

  it("treats legacy free-text-only rows as freeText", () => {
    expect(parseFeedbackComment("Это вообще не ответ")).toEqual({
      reason: null,
      freeText: "Это вообще не ответ",
    });
  });

  it("falls back to freeText for unknown reason ids", () => {
    // Unknown id ⇒ treat the whole packed string as freeText so
    // analytics can still see the raw blob.
    const packed = "reason=hallucinated; suspicious";
    expect(parseFeedbackComment(packed)).toEqual({
      reason: null,
      freeText: packed,
    });
  });

  it("round-trips for every documented shape", () => {
    const cases: Array<
      [
        ReturnType<typeof packFeedbackComment>,
        ReturnType<typeof parseFeedbackComment>,
      ]
    > = [
      [
        packFeedbackComment("off_topic", ""),
        { reason: "off_topic", freeText: "" },
      ],
      [
        packFeedbackComment("rude", "не надо так"),
        { reason: "rude", freeText: "не надо так" },
      ],
      [
        packFeedbackComment(null, "free text"),
        { reason: null, freeText: "free text" },
      ],
    ];
    for (const [packed, expected] of cases) {
      expect(packed).not.toBeNull();
      expect(parseFeedbackComment(packed)).toEqual(expected);
    }
  });

  it("handles multi-line free text after the separator", () => {
    expect(parseFeedbackComment("reason=incomplete; line1\nline2")).toEqual({
      reason: "incomplete",
      freeText: "line1\nline2",
    });
  });
});
