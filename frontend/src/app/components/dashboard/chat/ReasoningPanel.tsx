/**
 * s26 (2026-04-26 evening) — Phase 1 of the chat UX overhaul.
 *
 * The pre-answer "agent reasoning" panel. Replaces the prior stack of
 * 3–4 sibling cards (ThinkingBlock + ToolCallTimeline + raw cards)
 * inside a single assistant bubble — that stack visually stuttered
 * because every sub-component had its own border + radius.
 *
 * ReasoningPanel is a single rounded-2xl shell that holds:
 *   1. A live status header ("Размышляю · 2.4s" while streaming,
 *      "Готово · 3 шага · 7 инструментов · 4.1s" once done).
 *   2. A flat ThinkingTrack (no border).
 *   3. A flat, iteration-grouped ToolCallTimeline (no border).
 *
 * The whole panel collapses by default once the run is done so the
 * final answer is the focus. Auto-expanded while streaming so the
 * user sees liveness on every tool call.
 *
 * Cards (DreamUniProgressCard, GrantChanceGauge, etc.) live OUTSIDE
 * this panel — ChatTranscript renders them below the prose where
 * they have room to breathe.
 */

import { useEffect, useMemo, useState } from "react";
import { Brain, ChevronRight, Sparkles } from "lucide-react";
import { ThinkingTrack } from "./ThinkingBlock";
import { ToolCallTimeline } from "./ToolCallTimeline";
import type { MessagePart } from "./types";
import { useLang } from "../../LanguageContext";
import { useViewportMobile } from "./useViewportMobile";
import { buildReasoningHeader } from "./reasoningHeader";
import { reasoningPanelToggleAriaLabel } from "./reasoningPanelAria";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";
import { trackReasoningPanelToggled } from "../../../lib/telemetry";

/** s29 (D2, 2026-04-27): pure label helper for the streaming-only
 *  step subheader. Multi-pass agent runs (consult_library → analyse
 *  → recommend) emit `iteration` SSE frames; we surface the current
 *  step number while the run is live. Total iterations are unknown
 *  until the agent loop exits, so we render "Шаг N" (no denominator)
 *  during streaming and let the post-run summary header show the
 *  total. Returns null when there's nothing to render (e.g.
 *  zero-tool turns or non-streaming reload).
 *
 *  Exported for vitest so the bilingual copy contract is pinnable
 *  without a renderer. */
export function stepSubheaderLabel(args: {
  isStreaming: boolean;
  currentStep: number;
  lang: "ru" | "kz";
}): string | null {
  if (!args.isStreaming) return null;
  if (!Number.isFinite(args.currentStep) || args.currentStep < 1) return null;
  if (args.lang === "kz") return `${args.currentStep}-қадам`;
  return `Шаг ${args.currentStep}`;
}

interface Props {
  parts: MessagePart[];
  /** True while SSE stream is open — drives the live header. */
  isStreaming?: boolean;
}

export function ReasoningPanel({ parts, isStreaming = false }: Props) {
  const { lang } = useLang();
  // s34 wave 9 (G4, 2026-04-28): on narrow viewports we collapse the
  // header to a single short label so it never wraps on a 320–360px
  // phone. Reuses the existing 768px breakpoint hook so the shared
  // matchMedia listener doesn't multiply.
  const isMobile = useViewportMobile();
  // s34 wave 11 (G6): suppress brain-icon pulse + (in nested
  // ToolCallTimeline) the spinner when the user has asked for
  // reduced motion.
  const reduce = useReducedMotion();

  const thinkingText = useMemo(
    () =>
      parts
        .filter(
          (p): p is Extract<MessagePart, { kind: "thinking" }> =>
            p.kind === "thinking",
        )
        .map((p) => p.text)
        .join("\n\n"),
    [parts],
  );
  const toolCalls = useMemo(
    () =>
      parts.filter(
        (p): p is Extract<MessagePart, { kind: "tool_call" }> =>
          p.kind === "tool_call",
      ),
    [parts],
  );

  // Default-expanded while streaming, default-collapsed when done.
  // We track open state explicitly so the user can toggle.
  // (All hooks declared above the early-return so the hook order
  // stays stable across renders — react-hooks/rules-of-hooks.)
  const [open, setOpen] = useState<boolean>(isStreaming);
  // When streaming flips off (done), auto-collapse — but only once,
  // so the user can manually open it again post-completion without
  // it slamming closed on every re-render.
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  useEffect(() => {
    if (!isStreaming && !autoCollapsed) {
      setOpen(false);
      setAutoCollapsed(true);
    }
    if (isStreaming) {
      // Re-arm for the next turn.
      setAutoCollapsed(false);
    }
  }, [isStreaming, autoCollapsed]);

  // Elapsed timer (purely cosmetic). Starts at mount = first stream
  // event the parent has seen. Stops once not streaming.
  const [tick, setTick] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!isStreaming) {
      if (endedAt == null) setEndedAt(Date.now());
      return;
    }
    const i = window.setInterval(() => setTick((x) => x + 1), 200);
    return () => window.clearInterval(i);
  }, [isStreaming, endedAt]);
  void tick;

  // Iteration count = max iteration field on tool_calls, or 1 if any
  // tool calls exist with no iteration data.
  const iterationCount = useMemo(() => {
    if (toolCalls.length === 0) return 0;
    const max = toolCalls.reduce(
      (acc, c) => Math.max(acc, c.iteration ?? 0),
      0,
    );
    return max || 1;
  }, [toolCalls]);

  if (toolCalls.length === 0 && !thinkingText.trim() && !isStreaming) {
    return null;
  }

  const elapsed = isStreaming
    ? Date.now() - startedAt
    : (endedAt ?? Date.now()) - startedAt;

  // s34 wave 9 (G4): single source of truth for the header label —
  // pure helper that branches RU/KZ + full/compact internally. The
  // local `fmt` helper is retained only for any other timer-shaped
  // surfaces in this file (currently none); the elapsed string in
  // the header itself flows through buildReasoningHeader.
  const header = buildReasoningHeader({
    isStreaming,
    iterationCount,
    toolCount: toolCalls.length,
    elapsedMs: elapsed,
    lang: lang === "kz" ? "kz" : "ru",
    compact: isMobile,
  });
  // s29 (D2): step subheader. While streaming, render "Шаг N" /
  // "N-қадам" derived from the current iterationCount so multi-pass
  // turns read as "Шаг 2 / Размышляю · 3.4s" instead of just the
  // elapsed timer. Hidden post-run because doneLabel already
  // surfaces the total step count.
  const stepSubheader = stepSubheaderLabel({
    isStreaming,
    currentStep: iterationCount,
    lang: lang === "kz" ? "kz" : "ru",
  });

  return (
    <div
      className={
        "mb-3 overflow-hidden rounded-2xl border " +
        (isStreaming
          ? "border-amber-200/80 bg-gradient-to-br from-amber-50/60 via-white to-violet-50/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          : "border-zinc-200/80 bg-gradient-to-br from-zinc-50/80 via-white to-violet-50/20")
      }
    >
      <button
        type="button"
        onClick={() => {
          // s35 wave 57 (2026-04-28): emit the post-toggle state.
          // The setter callback gives us the right ordering — we
          // read the new value before React commits, so the
          // buffered event reflects the user-visible action.
          // is_streaming is captured at click time so a turn that
          // ends mid-click still reports the intent ("user opened
          // it while it was streaming").
          setOpen((v) => {
            const next = !v;
            trackReasoningPanelToggled({
              is_open: next,
              is_streaming: isStreaming,
              tool_count: toolCalls.length,
              iteration_count: iterationCount,
            });
            return next;
          });
        }}
        className={
          "group flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] font-medium transition-colors " +
          (isStreaming
            ? "text-amber-900 hover:bg-amber-50/40"
            : "text-zinc-700 hover:bg-zinc-50/60")
        }
        aria-expanded={open}
        aria-label={reasoningPanelToggleAriaLabel({
          open,
          isStreaming,
          headerText: stepSubheader ? `${header} · ${stepSubheader}` : header,
          lang: lang === "kz" ? "kz" : "ru",
        })}
      >
        <span
          className={
            "inline-flex h-6 w-6 items-center justify-center rounded-lg " +
            (isStreaming
              ? "bg-amber-100/80 text-amber-700"
              : "bg-violet-100/80 text-violet-700")
          }
        >
          {isStreaming ? (
            <Brain
              size={14}
              className={motionClass(reduce, "samga-anim-caret", "")}
            />
          ) : (
            <Sparkles size={14} />
          )}
        </span>
        <span className="tabular-nums">{header}</span>
        {stepSubheader ? (
          <span
            className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-100/70 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900"
            aria-live="polite"
          >
            {stepSubheader}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1 text-zinc-400">
          {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation
              via parent button's aria-expanded. ChevronRight at rest,
              rotates 90° down when open. */}
          <ChevronRight size={14} className="samga-anim-chevron-target" />
        </span>
      </button>
      <div
        className={
          "grid transition-[grid-template-rows] duration-300 ease-out " +
          (open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
        }
        aria-hidden={!open}
      >
        <div className="overflow-hidden">
          <div className="space-y-1.5 border-t border-zinc-200/60 bg-white/70 px-2.5 py-2.5">
            {(thinkingText.trim() || (isStreaming && toolCalls.length > 0)) && (
              <ThinkingTrack
                text={thinkingText}
                isStreaming={isStreaming && !thinkingText.trim()}
              />
            )}
            {toolCalls.length > 0 && (
              <ToolCallTimeline
                parts={parts}
                isStreaming={isStreaming}
                nested
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReasoningPanel;
