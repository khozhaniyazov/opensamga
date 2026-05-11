/**
 * s29 (D1, 2026-04-27) — SkeletonBubble.
 *
 * Shimmer placeholder rendered inside the assistant bubble during
 * the gap between "stream started" and "first non-empty delta".
 *
 * Today the chat already shows ThinkingStatus before any assistant
 * message exists. Once the first SSE event lands, useSendMessage
 * appends an empty assistant Message and the bubble switches over
 * to AssistantMessage(text=""), which renders a literal "..." until
 * the first prose token arrives. On slow first-token (cold backend,
 * tool calls, model warmup) that "..." stays for 1-3 seconds and
 * looks broken.
 *
 * SkeletonBubble fills that gap with three shimmer lines that match
 * the bubble's prose width. It mounts AFTER a 300 ms grace so fast
 * turns (where the first prose token arrives in <300 ms) never see
 * a flash. The grace is enforced inside the component itself so the
 * caller can render <SkeletonBubble /> unconditionally whenever the
 * tail bubble is empty during streaming.
 *
 * Pure helpers `shouldShowSkeleton` and `skeletonGraceMs` are
 * exported for vitest, mirroring the convention from RedactionPill /
 * SourcesDrawer / AnchoredToc.
 */

import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";
import { chatAnimationClass } from "./chatAnimationClasses";

/** Pure predicate — exported for vitest. The component delegates
 *  to this, so the gating contract is testable without a renderer.
 *
 *  We render the skeleton iff:
 *    - the parent reports the bubble is currently streaming, AND
 *    - the visible prose is empty / whitespace-only, AND
 *    - we have NOT yet received any tool_call parts that ReasoningPanel
 *      would already be rendering on its own.
 *
 *  Once any of these flip false the skeleton unmounts. */
export function shouldShowSkeleton(args: {
  isStreaming: boolean;
  hasText: boolean;
  hasReasoning: boolean;
}): boolean {
  if (!args.isStreaming) return false;
  if (args.hasText) return false;
  if (args.hasReasoning) return false;
  return true;
}

/** Pure constant — exported for vitest. Pinning this lets a future
 *  bump (e.g. to 250 ms because the boss says it feels too slow) be
 *  intentional rather than accidental. */
export const skeletonGraceMs = 300;

interface Props {
  /** Whether the parent thinks the bubble is currently streaming —
   *  i.e. it's the tail message and isSending is true. */
  isStreaming: boolean;
  /** Whether visible prose has landed for the bubble. When this
   *  flips true we tear down. */
  hasText: boolean;
  /** Whether ReasoningPanel is already rendering tool_call /
   *  thinking content for this bubble — if so the user already
   *  sees activity and the skeleton would be visual noise. */
  hasReasoning: boolean;
}

export function SkeletonBubble({ isStreaming, hasText, hasReasoning }: Props) {
  const [pastGrace, setPastGrace] = useState(false);
  // s34 wave 11 (G6): suppress the shimmer animation when the user
  // has asked their OS / app for reduced motion. The skeleton bars
  // still render so the user sees liveness, just statically.
  // s35 wave 34d (2026-04-28): swap tailwind's harsh `animate-pulse`
  // (1s ease-in-out 0→0.5 opacity) for the softer `samga-anim-caret`
  // (1.4s 1→0.4) that matches the streaming-caret cadence and is
  // already double-gated for reduced-motion at the CSS layer.
  const reduce = useReducedMotion();
  const pulseClass = motionClass(reduce, "samga-anim-caret", "");
  // s35 wave 35b (2026-04-28): a real shimmer sweep on top of the
  // pulse — Material-3-style modern skeleton. Helper handles the
  // reduce-motion gate; CSS layer also strips the gradient when the
  // OS preference is set, so we keep the bar rectangle static but
  // visible as a placeholder.
  const shimmerClass = chatAnimationClass({
    token: "skeletonShimmer",
    reduce,
  });

  // Reset the grace timer whenever streaming starts; tear down on
  // unmount so a fast turn doesn't leak a render after-the-fact.
  useEffect(() => {
    if (!isStreaming) {
      setPastGrace(false);
      return;
    }
    setPastGrace(false);
    const t = window.setTimeout(() => setPastGrace(true), skeletonGraceMs);
    return () => window.clearTimeout(t);
  }, [isStreaming]);

  if (!shouldShowSkeleton({ isStreaming, hasText, hasReasoning })) return null;
  if (!pastGrace) return null;

  return (
    <div
      className="my-1.5 flex flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-label="Загрузка ответа"
    >
      <span
        className={`block h-3 w-[92%] rounded bg-zinc-200 ${pulseClass} ${shimmerClass}`}
      />
      <span
        className={`block h-3 w-[78%] rounded bg-zinc-200 ${pulseClass} ${shimmerClass}`}
      />
      <span
        className={`block h-3 w-[64%] rounded bg-zinc-200 ${pulseClass} ${shimmerClass}`}
      />
    </div>
  );
}

export default SkeletonBubble;
