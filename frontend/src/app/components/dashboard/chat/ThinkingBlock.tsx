/**
 * Phase D / s24 agent harness (2026-04-26): collapsible "thinking"
 * surface. Renders the model's chain-of-thought (Qwen <think>...</think>
 * blocks routed by the backend agent loop) above the final answer.
 *
 * s26 (2026-04-26 evening): Phase 1 of the chat UX overhaul.
 *   - Adds `<ThinkingTrack>` (named export) — a flat, borderless
 *     variant designed to live inside `<ReasoningPanel>`. The legacy
 *     `<ThinkingBlock>` keeps its standalone violet shell for any
 *     surface that wants a one-off bubble.
 *   - Live header shows elapsed time + character count while
 *     streaming (`Думает · 4.2s · 312 знаков`) — the data is already
 *     on the SSE stream, just needs to be surfaced.
 *   - Body switches from monospace dev-log vibes to soft italic
 *     prose so it reads like reasoning, not console output.
 *   - Smooth grid-row reveal on expand instead of an instant DOM swap
 *     (the `grid-rows-[0fr]` ↔ `grid-rows-[1fr]` trick).
 *
 * Design rationale for default-collapsed: 11th-graders shouldn't be
 * forced to read the meta. It's a reassurance signal, with progressive
 * disclosure for the curious.
 */

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";
import { thinkingBlockToggleAriaLabel } from "./thinkingBlockAria";

interface Props {
  /** Concatenated thinking text from the agent loop. */
  text: string;
  /** Streaming = backend hasn't finalised the turn yet. */
  isStreaming?: boolean;
  /** When true, render flat (no border/background) — caller is providing
   *  the shell. Default false for back-compat. */
  nested?: boolean;
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

export function ThinkingBlock({
  text,
  isStreaming = false,
  nested = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const { lang } = useLang();
  // s34 wave 11 (G6): suppress the brain-icon pulse when reduced
  // motion is requested. Color stays the same so the streaming
  // signal is preserved.
  const reduce = useReducedMotion();
  const cleaned = (text || "").trim();

  // Track elapsed time while streaming. We start the clock on mount
  // (which corresponds to the first thinking event the parent has
  // seen) and tick every 200ms so the header reads as "live."
  const startRef = useRef<number>(Date.now());
  const [, force] = useState(0);
  useEffect(() => {
    if (!isStreaming) return;
    const i = window.setInterval(() => force((x) => x + 1), 200);
    return () => window.clearInterval(i);
  }, [isStreaming]);

  if (!cleaned && !isStreaming) return null;

  const elapsed = isStreaming ? Date.now() - startRef.current : 0;
  const charCount = cleaned.length;
  const labelLive =
    lang === "kz"
      ? `Ойлап жатыр${elapsed > 0 ? ` · ${fmtElapsed(elapsed)}` : "…"}`
      : `Думает${elapsed > 0 ? ` · ${fmtElapsed(elapsed)}` : "…"}`;
  const charsLabel =
    charCount > 0
      ? lang === "kz"
        ? ` · ${charCount} таңба`
        : ` · ${charCount} знаков`
      : "";
  const labelDone =
    lang === "kz"
      ? `Ойлау процесі · ${charCount} таңба`
      : `Процесс размышлений · ${charCount} знаков`;

  const headerLabel = isStreaming ? labelLive + charsLabel : labelDone;

  // Outer shell — flat when nested, violet bubble when standalone.
  const outerClass = nested
    ? "rounded-lg"
    : "mb-2 rounded-xl border border-violet-200/70 bg-violet-50/40";
  const headerClass = nested
    ? "flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-800 transition-colors hover:bg-violet-100/40 rounded-lg"
    : "flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-violet-800 transition-colors hover:bg-violet-100/60 rounded-xl";
  const bodyShellClass = nested
    ? "px-3"
    : "border-t border-violet-200/70 px-3 py-2";

  return (
    <div className={outerClass}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={headerClass}
        aria-expanded={open}
        aria-label={thinkingBlockToggleAriaLabel({
          open,
          isStreaming,
          headerText: headerLabel,
          lang: lang === "kz" ? "kz" : "ru",
        })}
      >
        <Brain
          size={13}
          className={
            isStreaming
              ? `${motionClass(reduce, "samga-anim-caret", "")} text-violet-700`.trim()
              : "text-violet-600"
          }
        />
        <span className="tabular-nums">{headerLabel}</span>
        {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation
            via parent button's aria-expanded. */}
        <ChevronRight
          size={13}
          className="ml-auto opacity-70 samga-anim-chevron-target"
        />
      </button>
      {/* Smooth grid-row reveal: the inner div carries the actual
       *  content, the wrapper animates `grid-template-rows` between
       *  `0fr` and `1fr`. This avoids the height-auto pitfall and
       *  keeps the animation accelerated. */}
      <div
        className={
          "grid transition-[grid-template-rows] duration-200 ease-out " +
          (open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
        }
        aria-hidden={!open}
      >
        <div className="overflow-hidden">
          <div className={bodyShellClass}>
            <p
              className={
                "whitespace-pre-wrap pb-2 italic text-[13px] leading-[1.65] text-violet-900/85"
              }
            >
              {cleaned ||
                (lang === "kz"
                  ? "(агент әлі ойлануда…)"
                  : "(агент ещё думает…)")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Flat variant for use inside ReasoningPanel. Identical behaviour
 *  to ThinkingBlock with `nested=true`. */
export function ThinkingTrack(props: Omit<Props, "nested">) {
  return <ThinkingBlock {...props} nested />;
}

export default ThinkingBlock;
