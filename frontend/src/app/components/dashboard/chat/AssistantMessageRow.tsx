/**
 * s35 wave 51 (2026-04-28) — AssistantMessageRow.
 *
 * Companion to UserMessageRow (wave 50). Pulls the
 * successful-assistant-bubble interior out of ChatTranscript into a
 * focused module: ReasoningPanel + skeleton + prose + caret +
 * backpressure + pill stack + tool-result cards + actions row.
 *
 * The split is INTERNAL — only ChatTranscript renders this. The
 * transcript still owns:
 *   - the per-bubble <div role="article"> + posinset/setsize aria,
 *   - the avatar column,
 *   - the bubble chrome classes (border / shadow / streaming ring),
 *   - the virtualization style,
 *   - the ERROR-branch (rose-tinted bubble + Retry button) — it has
 *     its own JSX shape and would split awkwardly here.
 *
 * Behavioural invariants preserved exactly:
 *   - ReasoningPanel renders only when there is a tool_call OR a
 *     non-empty thinking part, OR when this is the streaming tail
 *     and parts is empty (so the panel has somewhere to fade in).
 *   - SkeletonBubble owns the placeholder slot only while
 *     streamingNow && !hasText. Once any prose lands the real
 *     AssistantMessage takes over.
 *   - The amber caret renders only on the streaming tail with prose.
 *   - BackpressureIndicator renders only on the tail.
 *   - Pills render in declaration order: Redaction → Sources →
 *     Outdated → FailedTool → GeneralKnowledge → Interrupted →
 *     Retry. Each is self-gating on its predicate.
 *   - Tool-result cards filter to `kind === "tool_call"` parts with
 *     a non-null `result` carrying a `tool` discriminator.
 *   - The actions row (FeedbackButtons + MessageActions) renders
 *     only when the bubble has prose, hidden until hover/focus on
 *     sm+ widths via Tailwind opacity classes (s22 polish).
 *
 * The component is a thin presentational layer — it does not read
 * MessagesContext directly. Parent threads the handlers
 * (`onAskFollowUp`, `onRegenerate`) and the per-row derived state
 * (`isLast`, `isSending`, `priorUserText`) so this module stays
 * trivially testable and the split is byte-equivalent.
 */

import type { Message, MessagePart } from "./types";
import { AssistantMessage } from "./AssistantMessage";
import { BackpressureIndicator } from "./BackpressureIndicator";
import { FailedToolPill } from "./FailedToolPill";
import { FeedbackButtons } from "./FeedbackButtons";
import { GeneralKnowledgePill } from "./GeneralKnowledgePill";
import { InterruptedPill } from "./InterruptedPill";
import { MessageActions } from "./MessageActions";
import { OutdatedDataPill } from "./OutdatedDataPill";
import { ReasoningPanel } from "./ReasoningPanel";
import { RedactionPill } from "./RedactionPill";
import { RetryPill } from "./RetryPill";
import { SkeletonBubble } from "./SkeletonBubble";
import { SourcesDrawer } from "./SourcesDrawer";
import { ToolResultCard } from "./tool_cards/ToolResultCard";

interface Props {
  message: Message;
  /** Prior user-turn text — wired up to the "Ask follow-up" hint
   *  inside AssistantMessage. */
  priorUserText?: string;
  /** True when this row is the last message in the transcript. */
  isLast: boolean;
  /** True while a send is in flight. Combined with `isLast` to
   *  derive the streaming-tail state. */
  isSending: boolean;
  /** Tailwind class for the caret animation, threaded down from the
   *  reduced-motion gate in ChatTranscript. */
  caretMotionClass: string;
  /** Forwarded to AssistantMessage so cited follow-up suggestions
   *  flow back into the composer. */
  onAskFollowUp: (prompt: string) => void;
  /** Called when the user clicks "Regenerate" on the actions row.
   *  Receives the prior user-turn text. */
  onRegenerate: (priorUserText: string) => void;
  /** Drops this assistant message from the transcript — used by
   *  Regenerate to make room for the new turn. */
  onRemoveSelf: () => void;
}

/** Pure helper — does the assistant bubble have anything worth
 *  rendering inside the ReasoningPanel? Mirrors the predicate
 *  inlined in ChatTranscript pre-split. Exported for vitest. */
export function assistantHasReasoning(
  parts: MessagePart[] | null | undefined,
  isStreamingTail: boolean,
): boolean {
  const list = Array.isArray(parts) ? parts : [];
  if (
    list.some(
      (p) =>
        p.kind === "tool_call" ||
        (p.kind === "thinking" &&
          typeof p.text === "string" &&
          p.text.trim().length > 0),
    )
  ) {
    return true;
  }
  // While the tail bubble is still being built and parts haven't
  // landed yet, render the panel's empty shell so its fade-in is
  // visible the moment the first part arrives.
  return isStreamingTail && list.length === 0;
}

/** Pure helper — does the prose body have any non-whitespace text?
 *  Used to gate the skeleton placeholder, the streaming caret, and
 *  the actions row. Exported for vitest. */
export function assistantHasText(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

export function AssistantMessageRow({
  message,
  priorUserText,
  isLast,
  isSending,
  caretMotionClass,
  onAskFollowUp,
  onRegenerate,
  onRemoveSelf,
}: Props) {
  const parts = message.parts || [];
  const streamingNow = isSending && isLast;
  const hasReasoning = assistantHasReasoning(parts, streamingNow);
  const hasText = assistantHasText(message.text);

  return (
    <>
      {hasReasoning ? (
        <ReasoningPanel parts={parts} isStreaming={streamingNow} />
      ) : null}

      <div className="relative">
        <SkeletonBubble
          isStreaming={streamingNow}
          hasText={hasText}
          hasReasoning={parts.some(
            (p) =>
              p.kind === "tool_call" ||
              (p.kind === "thinking" &&
                typeof p.text === "string" &&
                p.text.trim().length > 0),
          )}
        />
        {streamingNow && !hasText ? null : (
          <AssistantMessage
            text={message.text || "..."}
            priorUserText={priorUserText}
            onAskFollowUp={onAskFollowUp}
          />
        )}
        {streamingNow && hasText ? (
          <span
            aria-hidden="true"
            className={`ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[2px] bg-amber-500/70 align-middle ${caretMotionClass}`.trim()}
          />
        ) : null}
      </div>

      {isLast ? (
        <div className="mt-2">
          <BackpressureIndicator
            isSending={isSending}
            streamingText={message.text || ""}
          />
        </div>
      ) : null}

      {message.unverifiedScoreClaimsRedacted &&
      message.unverifiedScoreClaimsRedacted > 0 ? (
        <RedactionPill count={message.unverifiedScoreClaimsRedacted} />
      ) : null}

      {message.consultedSources && message.consultedSources.length > 0 ? (
        <SourcesDrawer sources={message.consultedSources} />
      ) : null}

      {message.consultedSources && message.consultedSources.length > 0 ? (
        <OutdatedDataPill sources={message.consultedSources} />
      ) : null}

      {message.failedToolCalls && message.failedToolCalls.length > 0 ? (
        <FailedToolPill failures={message.failedToolCalls} />
      ) : null}

      <GeneralKnowledgePill isGeneralKnowledge={message.isGeneralKnowledge} />

      <InterruptedPill wasInterrupted={message.wasInterrupted} />

      <RetryPill isRetrying={message.isRetrying} />

      {parts
        .filter(
          (p): p is Extract<MessagePart, { kind: "tool_call" }> =>
            p.kind === "tool_call",
        )
        .map((p, i) => {
          if (!p.result || typeof p.result !== "object") return null;
          const anyResult = p.result as { tool?: string; data?: unknown };
          if (!anyResult.tool) return null;
          // ToolResultCard narrows the union internally.

          return (
            <ToolResultCard
              key={`tc-${message.id}-${i}`}
              result={anyResult as any}
            />
          );
        })}

      {hasText ? (
        <div className="mt-2.5 border-t border-zinc-100/80 pt-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 samga-anim-actions-reveal-target">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FeedbackButtons
              messageId={message.id}
              ragQueryLogId={message.ragQueryLogId ?? null}
            />
            <MessageActions
              message={message}
              onRegenerate={(priorUserTextArg) => {
                onRemoveSelf();
                onRegenerate(priorUserTextArg);
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export default AssistantMessageRow;
