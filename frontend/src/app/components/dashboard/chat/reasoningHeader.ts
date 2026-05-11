/**
 * s34 wave 9 (G4, 2026-04-28): pure helper for the ReasoningPanel
 * collapsed-header label.
 *
 * Boss ask (chat UI/UX roadmap §G4): "ReasoningPanel collapses to a
 * single line on mobile (`Готово · 4 шага`)." Today the panel
 * already renders a single-line header, but on narrow viewports the
 * full RU plural ("Готово · 3 шага · 7 инструментов · 4.1s") wraps
 * onto two lines on 320–360px screens, defeating the "scan-able
 * one-liner" intent.
 *
 * This helper keeps the bilingual copy contract and the
 * compact/full split in one source of truth so the renderer can
 * branch via a viewport hook without re-implementing pluralization.
 *
 * Pure (no React, no DOM) so it's vitest-pinnable and reusable. The
 * format intentionally returns a STRING — not React nodes — so we
 * can pin output character-for-character.
 *
 * Compact mode rules:
 *   - Streaming:    "Размышляю" / "Ойлап жатырмын" only (drop elapsed)
 *   - Done, no work: "Готово" / "Дайын" only
 *   - Done, with N steps: "Готово · N шагов" / "Дайын · N қадам" only
 *     (drop tool count + elapsed; the user can expand the panel for
 *     details)
 *   - Done, with tool calls but no multi-step: "Готово · N инструментов"
 *     / "Дайын · N құрал" (less common but covered for symmetry)
 *
 * Full mode mirrors the existing ReasoningPanel behaviour exactly so
 * a future caller can swap the inline string-building for this
 * helper without a behavioural change.
 */

export type ReasoningHeaderLang = "ru" | "kz";

export interface ReasoningHeaderArgs {
  /** True while the SSE stream is open. */
  isStreaming: boolean;
  /** Max iteration index seen on tool_call parts (or 0 / 1 fallback). */
  iterationCount: number;
  /** Total number of tool_call parts. */
  toolCount: number;
  /** Wall-clock elapsed since the panel mounted. Milliseconds. */
  elapsedMs: number;
  /** UI language. */
  lang: ReasoningHeaderLang;
  /** True on narrow viewports — drop elapsed + tool count when done. */
  compact?: boolean;
}

/** Format a duration the same way ReasoningPanel does today. Kept
 *  here so the helper is self-contained. */
export function formatReasoningElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Russian-style integer pluralization for "шаг" and "инструмент".
 *  Returns the noun form (no count). Mirrors the inline logic in
 *  ReasoningPanel pre-extraction so existing copy stays byte-identical. */
function pluralRuSteps(n: number): string {
  return n === 1 ? "шаг" : "шагов";
}
function pluralRuTools(n: number): string {
  if (n === 1) return "инструмент";
  if (n < 5) return "инструмента";
  return "инструментов";
}

/** Build the streaming-mode "live" label. */
export function buildLiveLabel(args: ReasoningHeaderArgs): string {
  if (args.compact) {
    return args.lang === "kz" ? "Ойлап жатырмын" : "Размышляю";
  }
  const elapsed = formatReasoningElapsed(args.elapsedMs);
  return args.lang === "kz"
    ? `Ойлап жатырмын · ${elapsed}`
    : `Размышляю · ${elapsed}`;
}

/** Build the "done" / completed label. */
export function buildDoneLabel(args: ReasoningHeaderArgs): string {
  const prefix = args.lang === "kz" ? "Дайын" : "Готово";
  const parts: string[] = [];
  if (args.iterationCount > 1) {
    parts.push(
      args.lang === "kz"
        ? `${args.iterationCount} қадам`
        : `${args.iterationCount} ${pluralRuSteps(args.iterationCount)}`,
    );
  }
  if (!args.compact && args.toolCount > 0) {
    parts.push(
      args.lang === "kz"
        ? `${args.toolCount} құрал`
        : `${args.toolCount} ${pluralRuTools(args.toolCount)}`,
    );
  }
  if (!args.compact && args.elapsedMs > 0) {
    parts.push(formatReasoningElapsed(args.elapsedMs));
  }
  // Compact-mode fallback: when there are no iterations OR tools to
  // show we'd still want the "тестировано на N инструментах" hint
  // rather than just "Готово". So if we're compact + iterationCount<=1
  // + toolCount>0, swap in the tool count.
  if (
    args.compact &&
    args.iterationCount <= 1 &&
    args.toolCount > 0 &&
    parts.length === 0
  ) {
    parts.push(
      args.lang === "kz"
        ? `${args.toolCount} құрал`
        : `${args.toolCount} ${pluralRuTools(args.toolCount)}`,
    );
  }
  return parts.length > 0 ? `${prefix} · ${parts.join(" · ")}` : prefix;
}

/** Top-level builder. Branches on isStreaming. */
export function buildReasoningHeader(args: ReasoningHeaderArgs): string {
  return args.isStreaming ? buildLiveLabel(args) : buildDoneLabel(args);
}
