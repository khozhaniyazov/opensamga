import { describe, it, expect } from "vitest";
import { chatAnimationClass } from "../chatAnimationClasses";

describe("chatAnimationClass — happy paths", () => {
  it("messageEnter", () => {
    expect(chatAnimationClass({ token: "messageEnter", reduce: false })).toBe(
      "samga-anim-msg-enter",
    );
  });

  it("disclosureExpand", () => {
    expect(
      chatAnimationClass({ token: "disclosureExpand", reduce: false }),
    ).toBe("samga-anim-disclosure-expand");
  });

  it("chipHoverLift", () => {
    expect(chatAnimationClass({ token: "chipHoverLift", reduce: false })).toBe(
      "samga-anim-chip-hover",
    );
  });

  it("sendPress", () => {
    expect(chatAnimationClass({ token: "sendPress", reduce: false })).toBe(
      "samga-anim-send-press",
    );
  });

  it("threadRowHover", () => {
    expect(chatAnimationClass({ token: "threadRowHover", reduce: false })).toBe(
      "samga-anim-thread-row",
    );
  });

  it("toolCardMount", () => {
    expect(chatAnimationClass({ token: "toolCardMount", reduce: false })).toBe(
      "samga-anim-tool-card",
    );
  });

  it("streamingCaret", () => {
    expect(chatAnimationClass({ token: "streamingCaret", reduce: false })).toBe(
      "samga-anim-caret",
    );
  });

  it("pillMount", () => {
    expect(chatAnimationClass({ token: "pillMount", reduce: false })).toBe(
      "samga-anim-pill",
    );
  });

  it("composerFocusGlow (s35 wave 34e)", () => {
    expect(
      chatAnimationClass({ token: "composerFocusGlow", reduce: false }),
    ).toBe("samga-anim-composer-glow");
  });

  it("popoverMount (s35 wave 34f)", () => {
    expect(chatAnimationClass({ token: "popoverMount", reduce: false })).toBe(
      "samga-anim-popover",
    );
  });

  it("modalScrim (s35 wave 34g)", () => {
    expect(chatAnimationClass({ token: "modalScrim", reduce: false })).toBe(
      "samga-anim-modal-scrim",
    );
  });

  it("modalEnter (s35 wave 34g)", () => {
    expect(chatAnimationClass({ token: "modalEnter", reduce: false })).toBe(
      "samga-anim-modal",
    );
  });

  it("chevronRotate (s35 wave 35a)", () => {
    expect(chatAnimationClass({ token: "chevronRotate", reduce: false })).toBe(
      "samga-anim-chevron",
    );
  });

  it("skeletonShimmer (s35 wave 35b)", () => {
    expect(
      chatAnimationClass({ token: "skeletonShimmer", reduce: false }),
    ).toBe("samga-anim-skeleton");
  });

  it("copySuccess (s35 wave 35c)", () => {
    expect(chatAnimationClass({ token: "copySuccess", reduce: false })).toBe(
      "samga-anim-copy-success",
    );
  });

  it("usagePulse (s35 wave 35d)", () => {
    expect(chatAnimationClass({ token: "usagePulse", reduce: false })).toBe(
      "samga-anim-usage-pulse",
    );
  });

  it("actionsReveal (s35 wave 35e)", () => {
    expect(chatAnimationClass({ token: "actionsReveal", reduce: false })).toBe(
      "samga-anim-actions-reveal",
    );
  });

  it("scrimBlur (s35 wave 35f)", () => {
    expect(chatAnimationClass({ token: "scrimBlur", reduce: false })).toBe(
      "samga-anim-scrim-blur",
    );
  });

  it("feedbackThanks (s35 wave 36e)", () => {
    expect(chatAnimationClass({ token: "feedbackThanks", reduce: false })).toBe(
      "samga-anim-feedback-thanks",
    );
  });

  it("cardHoverLift (s35 wave 36f)", () => {
    expect(chatAnimationClass({ token: "cardHoverLift", reduce: false })).toBe(
      "samga-anim-card-lift",
    );
  });

  it("tapRipple (s35 wave 36g)", () => {
    expect(chatAnimationClass({ token: "tapRipple", reduce: false })).toBe(
      "samga-anim-tap-ripple",
    );
  });
});

describe("chatAnimationClass — reduced-motion gate", () => {
  it("reduce=true returns empty string regardless of token", () => {
    expect(chatAnimationClass({ token: "messageEnter", reduce: true })).toBe(
      "",
    );
    expect(
      chatAnimationClass({ token: "disclosureExpand", reduce: true }),
    ).toBe("");
    expect(chatAnimationClass({ token: "sendPress", reduce: true })).toBe("");
    expect(chatAnimationClass({ token: "toolCardMount", reduce: true })).toBe(
      "",
    );
  });

  it("reduce=truthy non-true does NOT trigger gate (strict equality)", () => {
    expect(chatAnimationClass({ token: "messageEnter", reduce: 1 })).toBe(
      "samga-anim-msg-enter",
    );
    expect(chatAnimationClass({ token: "messageEnter", reduce: "yes" })).toBe(
      "samga-anim-msg-enter",
    );
  });
});

describe("chatAnimationClass — defensive", () => {
  it("unknown token → empty", () => {
    expect(chatAnimationClass({ token: "frobnicate", reduce: false })).toBe("");
  });

  it("non-string token → empty", () => {
    expect(chatAnimationClass({ token: 42, reduce: false })).toBe("");
    expect(chatAnimationClass({ token: null, reduce: false })).toBe("");
    expect(chatAnimationClass({ token: undefined, reduce: false })).toBe("");
  });

  it("purity", () => {
    const a = chatAnimationClass({ token: "messageEnter", reduce: false });
    chatAnimationClass({ token: "sendPress", reduce: true });
    const b = chatAnimationClass({ token: "messageEnter", reduce: false });
    expect(a).toBe(b);
  });

  it("all 21 tokens have unique class names (s35 wave 36)", () => {
    const tokens = [
      "messageEnter",
      "disclosureExpand",
      "chipHoverLift",
      "sendPress",
      "threadRowHover",
      "toolCardMount",
      "streamingCaret",
      "pillMount",
      "composerFocusGlow",
      "popoverMount",
      "modalScrim",
      "modalEnter",
      "chevronRotate",
      "skeletonShimmer",
      "copySuccess",
      "usagePulse",
      "actionsReveal",
      "scrimBlur",
      "feedbackThanks",
      "cardHoverLift",
      "tapRipple",
    ];
    const cls = tokens.map((t) =>
      chatAnimationClass({ token: t, reduce: false }),
    );
    expect(new Set(cls).size).toBe(21);
  });
});
