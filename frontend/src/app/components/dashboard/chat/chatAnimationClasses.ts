/**
 * s35 wave 33b (2026-04-28) — pure helper to look up modern
 * chat-surface animation class names.
 *
 * The animations themselves live as raw CSS in
 * `styles/index.css` under the `samga-anim-*` namespace; this
 * helper is the single source of truth components import to
 * pick the right token for a given motion role.
 *
 * Reduced-motion handling is embedded: when the caller passes
 * `reduce: true` (already resolved by `useReducedMotion`), the
 * helper returns the empty string instead of the animated
 * class — so all chat-surface animations fall away in one
 * place rather than each component re-implementing the gate.
 *
 * Pure: no DOM, no React, no Intl.
 */

export type ChatAnimationToken =
  /** Assistant/user message bubble entrance — slide-up + fade. */
  | "messageEnter"
  /** ToolCallTimeline / ReasoningPanel body opening from a
   *  collapsed disclosure — soft slide-down + fade. */
  | "disclosureExpand"
  /** Citation chip hover lift (transform, not animation, but we
   *  let the helper own the convention). */
  | "chipHoverLift"
  /** Send-button press — scale-down then settle. */
  | "sendPress"
  /** ThreadRail row hover — slight x-translate to telegraph
   *  selectability without thrashing layout. */
  | "threadRowHover"
  /** Tool-card mount — fade + scale-up from 0.97. */
  | "toolCardMount"
  /** Streaming caret pulse used by SkeletonBubble. */
  | "streamingCaret"
  /** Pill / status mount — fade + slide-down a few px. */
  | "pillMount"
  /** Composer shell focus-within glow — soft amber 2px ring
   *  fade-in to telegraph the active textarea. (s35 wave 34e) */
  | "composerFocusGlow"
  /** Generic popover mount — fade + small slide. Used by
   *  SlashMenuPopover, FeedbackButtons reason popover, citation
   *  preview, sources drawer header. (s35 wave 34f) */
  | "popoverMount"
  /** Modal scrim fade-in. (s35 wave 34g) */
  | "modalScrim"
  /** Modal dialog mount — fade + scale-up from 0.96. (s35 wave 34g) */
  | "modalEnter"
  /** Chevron rotation on disclosure widgets — 0deg collapsed,
   *  90deg expanded. Caller must also pass `rotated={open}` to
   *  the wrapping element via `aria-expanded` or a data attr.
   *  (s35 wave 35a) */
  | "chevronRotate"
  /** Skeleton shimmer — modern gradient sweep replacing the
   *  pulse. Used by SkeletonBubble bars. (s35 wave 35b) */
  | "skeletonShimmer"
  /** Copy-success ✓ pop — scale + fade celebrating a copied
   *  block. Used by CodeBlock + MessageActions copy buttons.
   *  (s35 wave 35c) */
  | "copySuccess"
  /** Header usage-pill near-limit pulse — gentle bg pulse when
   *  user is at ≥80% daily quota. (s35 wave 35d) */
  | "usagePulse"
  /** MessageActions toolbar reveal — fade + slide-up on
   *  group-hover. (s35 wave 35e) */
  | "actionsReveal"
  /** Backdrop blur intensification on modal scrim — adds a
   *  blur(8px) layer for a Material-3 / iOS-17 feel. (s35
   *  wave 35f) */
  | "scrimBlur"
  /** FeedbackButtons "thank you" chip — slides in from the LEFT
   *  + fades after the up/down vote lands, replacing the ad-hoc
   *  tailwind `animate-in fade-in slide-in-from-left-1`. (s35
   *  wave 36e) */
  | "feedbackThanks"
  /** Empty-state and template card hover-lift — translateY(-1px)
   *  + soft shadow growth on :hover, transition-only. Wired on
   *  ChatEmptyState quick-prompt cards and the "open templates"
   *  pills. (s35 wave 36f) */
  | "cardHoverLift"
  /** Material-style tap ripple on primary buttons — scale-down
   *  on :active without a separate ripple element, paired with
   *  a soft brightness bump. Wired on send / new-thread / slash
   *  menu items. (s35 wave 36g) */
  | "tapRipple";

const TABLE: Record<ChatAnimationToken, string> = {
  messageEnter: "samga-anim-msg-enter",
  disclosureExpand: "samga-anim-disclosure-expand",
  chipHoverLift: "samga-anim-chip-hover",
  sendPress: "samga-anim-send-press",
  threadRowHover: "samga-anim-thread-row",
  toolCardMount: "samga-anim-tool-card",
  streamingCaret: "samga-anim-caret",
  pillMount: "samga-anim-pill",
  composerFocusGlow: "samga-anim-composer-glow",
  popoverMount: "samga-anim-popover",
  modalScrim: "samga-anim-modal-scrim",
  modalEnter: "samga-anim-modal",
  chevronRotate: "samga-anim-chevron",
  skeletonShimmer: "samga-anim-skeleton",
  copySuccess: "samga-anim-copy-success",
  usagePulse: "samga-anim-usage-pulse",
  actionsReveal: "samga-anim-actions-reveal",
  scrimBlur: "samga-anim-scrim-blur",
  feedbackThanks: "samga-anim-feedback-thanks",
  cardHoverLift: "samga-anim-card-lift",
  tapRipple: "samga-anim-tap-ripple",
};

interface Args {
  token: unknown;
  reduce: unknown;
}

export function chatAnimationClass({ token, reduce }: Args): string {
  if (reduce === true) return "";
  if (typeof token !== "string") return "";
  if (!(token in TABLE)) return "";
  return TABLE[token as ChatAnimationToken];
}
