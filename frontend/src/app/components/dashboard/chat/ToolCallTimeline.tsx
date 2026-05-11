/**
 * Phase D / s24 agent harness (2026-04-26): "show the thinking" UI
 * surface for autonomous tool calls. Renders a compact, collapsible
 * timeline of every tool the agent invoked while answering the
 * current turn — the equivalent of Claude Code / Codex CLI's
 * tool-call ribbon.
 *
 * s26 (2026-04-26 evening): Phase 1 of the chat UX overhaul.
 *   - Added `nested` prop. When true, the component drops its own
 *     border/background and is meant to live inside `<ReasoningPanel>`,
 *     which provides a single unified shell for thinking + tools +
 *     iteration markers.
 *   - Per-row timing chip on the right (`642 ms` / `1.4 s`), computed
 *     from `started_at`/`ended_at` (live stream) or `duration_ms`
 *     (replayed from `message_metadata.parts` after reload).
 *   - Iteration grouping: between tool_call rows whose `iteration`
 *     differs we render a thin "Шаг N · M инструментов" separator
 *     so multi-pass agent runs read as a real plan instead of a
 *     flat list.
 *   - Replaced the developer-coded JSON `<pre>` blocks in the
 *     expanded row body with a structured key/value list. The raw
 *     JSON is still available via a "Показать как JSON" toggle for
 *     the curious.
 *   - Status dot picks up an aria-label so it reads cleanly to
 *     screenreaders (the dot itself isn't sufficient).
 */

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Braces,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Library,
  ListChecks,
  Loader2,
  MapPin,
  MessagesSquare,
  Scale,
  Search,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  User2,
  Wrench,
  XCircle,
} from "lucide-react";
import type { MessagePart, ToolCallStatus } from "./types";
import { useLang } from "../../LanguageContext";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";
import {
  toolCallRowAriaLabel,
  toolCallIterationHeaderAriaLabel,
} from "./toolCallRowAria";
import { toolCountLabel } from "./toolCountLabel";

interface Props {
  parts: MessagePart[];
  /** True while the SSE stream is still open. Used to keep the running
   *  spinner alive even if the last call hasn't reported done yet. */
  isStreaming?: boolean;
  /** When true, render flat (no border/background) — caller is providing
   *  the shell. Default false for back-compat. */
  nested?: boolean;
}

type ToolCallPart = Extract<MessagePart, { kind: "tool_call" }>;

const TOOL_LABEL_OVERRIDES: Record<string, { ru: string; kz: string }> = {
  consult_library: { ru: "Поиск в библиотеке", kz: "Кітапханадан іздеу" },
  get_university_data: { ru: "Данные вуза", kz: "Жоғары оқу орны деректері" },
  check_grant_chance: { ru: "Шанс на грант", kz: "Грант мүмкіндігі" },
  get_historical_data: { ru: "История проходных", kz: "Өтпелі ұпайлар тарихы" },
  get_major_requirements: {
    ru: "Требования специальности",
    kz: "Мамандық талаптары",
  },
  recommend_universities: {
    ru: "Подбор вузов",
    kz: "Жоғары оқу орындарын таңдау",
  },
  get_majors_by_subjects: {
    ru: "Специальности по предметам",
    kz: "Пәндер бойынша мамандықтар",
  },
  compare_universities: {
    ru: "Сравнение вузов",
    kz: "Жоғары оқу орындарын салыстыру",
  },
  find_universities_by_region_and_features: {
    ru: "Поиск по региону",
    kz: "Аймақ бойынша іздеу",
  },
  get_detailed_grant_scores: { ru: "Гранты подробно", kz: "Гранттар толық" },
  find_universities_by_score: {
    ru: "Поиск по баллам",
    kz: "Ұпайлар бойынша іздеу",
  },
  get_user_profile: { ru: "Твой профиль", kz: "Сенің профилің" },
  get_recent_mistakes: { ru: "Твои ошибки", kz: "Сенің қателеріңі" },
  get_recent_test_attempts: { ru: "Твои попытки", kz: "Сенің әрекеттерің" },
  get_practice_summary: { ru: "Сводка практики", kz: "Тәжірибе қорытындысы" },
  get_dream_university_progress: {
    ru: "Цели поступления",
    kz: "Түсу мақсаттары",
  },
  get_chat_summary: { ru: "Прошлые диалоги", kz: "Бұрынғы диалогтар" },
};

/** Format a value into a friendly cell. Strings get truncated, arrays
 *  show their length, plain objects get `{…}`. The structured row
 *  list in the expanded body always falls back to this. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    if (v.length === 0) return "—";
    return v.length > 80 ? v.slice(0, 80) + "…" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => typeof x === "string" || typeof x === "number")) {
      const joined = v.slice(0, 4).map(String).join(", ");
      return v.length > 4 ? `${joined}, …(${v.length - 4})` : joined;
    }
    return `[${v.length}]`;
  }
  if (typeof v === "object") return "{…}";
  return String(v);
}

function summariseArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const parts = entries.slice(0, 3).map(([k, v]) => {
    let display: string;
    if (typeof v === "string") {
      display = v.length > 36 ? v.slice(0, 36) + "…" : v;
    } else if (Array.isArray(v)) {
      display = `[${v.length}]`;
    } else if (typeof v === "object") {
      display = "{…}";
    } else {
      display = String(v);
    }
    return `${k}=${display}`;
  });
  return parts.join(" · ");
}

/** Per-tool icon used as the leading glyph in each timeline row.
 *  Lucide icons are ForwardRefExoticComponent, not plain ComponentType,
 *  so we use LucideIcon (or a structural equivalent) to satisfy strict TS. */
type TimelineIconComponent = React.ComponentType<
  {
    size?: number | string;
    className?: string;
  } & React.RefAttributes<SVGSVGElement>
>;

const TOOL_ICONS: Record<string, TimelineIconComponent> = {
  consult_library: Library,
  get_university_data: GraduationCap,
  check_grant_chance: Star,
  get_historical_data: TrendingUp,
  get_major_requirements: BookOpen,
  recommend_universities: BarChart3,
  get_majors_by_subjects: Search,
  compare_universities: Scale,
  find_universities_by_region_and_features: MapPin,
  get_detailed_grant_scores: Target,
  find_universities_by_score: Search,
  get_user_profile: User2,
  get_recent_mistakes: AlertTriangle,
  get_recent_test_attempts: ListChecks,
  get_practice_summary: TrendingDown,
  get_dream_university_progress: Target,
  get_chat_summary: MessagesSquare,
};

function ToolIcon({ tool }: { tool: string }) {
  const Icon = TOOL_ICONS[tool] ?? Wrench;
  return <Icon size={14} className="text-zinc-500" />;
}

function StatusDot({
  status,
  label,
}: {
  status: ToolCallStatus;
  label: string;
}) {
  // s34 wave 11 (G6): the spinner is decorative — the colored
  // amber tint already conveys "in flight". When the user wants
  // reduced motion, freeze the icon (Loader2 still rendered, just
  // without animate-spin) so they don't lose the status signal.
  const reduce = useReducedMotion();
  if (status === "running") {
    return (
      <Loader2
        size={13}
        className={`${motionClass(reduce, "animate-spin", "")} text-amber-600`.trim()}
        aria-label={label}
      />
    );
  }
  if (status === "error") {
    return <XCircle size={13} className="text-rose-600" aria-label={label} />;
  }
  return (
    <CheckCircle2 size={13} className="text-emerald-600" aria-label={label} />
  );
}

/**
 * s26 phase 6 (TOOLCARD-LATEX): try to parse a tool result preview as
 * the consult_library JSON payload and surface the citations[] entries
 * as readable KaTeX-rendered cards instead of a raw <pre> dump.
 *
 * Returns null when the payload doesn't fit (we fall back to the plain
 * <pre> path). We deliberately accept a partially-truncated JSON tail
 * (the agent_loop preview clamps at 1200 chars + "…") by trying once
 * and bailing on parse failure.
 */
type LibraryCitation = {
  book_id?: number | null;
  book_title?: string | null;
  subject?: string | null;
  grade?: number | null;
  page_number?: number | null;
  content?: string | null;
  citation?: string | null;
  similarity_score?: number | null;
};
function tryParseLibraryPreview(preview: string | null | undefined): {
  query: string | null;
  citations: LibraryCitation[];
  count: number;
} | null {
  if (!preview) return null;
  // First try a clean parse (history-replay path persists the whole preview
  // up to 1200 chars; live SSE path likewise stops at 1200 + "…"). Both
  // paths produce truncated JSON inside the last citation's `content`
  // string, so we attempt several progressively more aggressive recoveries
  // before giving up and falling through to the raw <pre>.
  const tryParse = (s: string) => {
    try {
      const p = JSON.parse(s);
      if (p && typeof p === "object" && Array.isArray(p.citations)) {
        return {
          query: typeof p.query === "string" ? p.query : null,
          citations: p.citations.slice(0, 4) as LibraryCitation[],
          count: typeof p.count === "number" ? p.count : p.citations.length,
        };
      }
    } catch {
      /* fallthrough */
    }
    return null;
  };
  const direct = tryParse(preview);
  if (direct) return direct;

  // Recovery path. Strip the trailing ellipsis, then walk back through
  // citation-entry separators (`}, {`) until we find a prefix where every
  // already-closed citation parses cleanly. We rebuild the outer envelope
  // (`...]}`) on each candidate.
  let trimmed = preview.replace(/…+\s*$/u, "");
  // Cut at "}, {" boundaries (citation separators in our payload shape).
  // Walk from the end, attempting each boundary in turn.
  while (true) {
    const idx = trimmed.lastIndexOf("}, {");
    if (idx < 0) break;
    const candidate = trimmed.slice(0, idx + 1) + "]}";
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
    trimmed = trimmed.slice(0, idx);
  }
  return null;
}

/**
 * Citation chunks come from the backend with double-escaped backslashes
 * (`\\frac` instead of `\frac`) because they passed through json.dumps.
 * Restore them so remark-math can tokenise the LaTeX commands.
 */
function unescapeLibraryContent(s: string): string {
  return s.replace(/\\\\/g, "\\");
}

/** Compute a friendly duration string for the timing chip. */
function formatDuration(ms: number | undefined): string | null {
  if (ms == null || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

function callDuration(call: ToolCallPart): number | undefined {
  if (call.duration_ms != null) return call.duration_ms;
  if (call.started_at != null && call.ended_at != null) {
    return Math.max(0, call.ended_at - call.started_at);
  }
  return undefined;
}

export function ToolCallTimeline({
  parts,
  isStreaming = false,
  nested = false,
}: Props) {
  const { lang } = useLang();
  const calls = useMemo(
    () => parts.filter((p): p is ToolCallPart => p.kind === "tool_call"),
    [parts],
  );

  const initialExpanded = useMemo(() => {
    const lastRunningIdx = [...calls]
      .reverse()
      .findIndex((c) => (c.status ?? "done") === "running");
    if (lastRunningIdx < 0) return null;
    return calls.length - 1 - lastRunningIdx;
  }, [calls]);
  const [expanded, setExpanded] = useState<number | null>(initialExpanded);
  const [showRaw, setShowRaw] = useState<Record<number, boolean>>({});

  // Group calls by iteration so we can render "Шаг N" separators. We
  // also count tools per iteration to surface the parallel-execution
  // shape of the agent loop ("Шаг 1 · 3 инструмента параллельно").
  // (Computed before the early-return so the hook order stays stable
  // across renders — react-hooks/rules-of-hooks.)
  const callsByIteration = useMemo(() => {
    const out: { iteration: number; indices: number[] }[] = [];
    let bucket: { iteration: number; indices: number[] } | null = null;
    calls.forEach((call, idx) => {
      const iter = call.iteration ?? 0;
      if (!bucket || bucket.iteration !== iter) {
        bucket = { iteration: iter, indices: [] };
        out.push(bucket);
      }
      bucket.indices.push(idx);
    });
    return out;
  }, [calls]);

  if (calls.length === 0) return null;

  const headerLabel = isStreaming
    ? lang === "kz"
      ? `Құралдар (${calls.length})`
      : `Инструменты (${calls.length})`
    : lang === "kz"
      ? `Қолданылған құралдар: ${calls.length}`
      : `Использовано инструментов: ${calls.length}`;

  const allDone = calls.every((c) => (c.status ?? "done") === "done");

  const showIterations = callsByIteration.some(
    (g, _i, arr) => g.iteration > 0 && arr.length > 1,
  );

  const statusLabel = (s: ToolCallStatus) =>
    s === "running"
      ? lang === "kz"
        ? "орындалуда"
        : "выполняется"
      : s === "error"
        ? lang === "kz"
          ? "қате"
          : "ошибка"
        : lang === "kz"
          ? "дайын"
          : "готово";

  const shellClass = nested
    ? ""
    : "mb-2 rounded-xl border " +
      (isStreaming && !allDone
        ? "border-amber-200 bg-amber-50/50"
        : "border-zinc-200 bg-zinc-50/70");

  return (
    <div className={shellClass}>
      {!nested && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-zinc-700">
          <Wrench size={13} className="text-zinc-500" />
          <span>{headerLabel}</span>
        </div>
      )}
      <ul className={nested ? "" : "divide-y divide-zinc-100"}>
        {callsByIteration.map((group, groupIdx) => (
          <li key={`grp-${groupIdx}`} className="list-none">
            {showIterations && group.iteration > 0 && (
              <div
                className={
                  "flex items-center gap-2 px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-zinc-500"
                }
                // s35 wave 31a (2026-04-28): canonical accessible
                // name with full RU pluralisation + parallel-exec
                // hint. Visible chrome unchanged — three decorative
                // spans now read as one utterance to SR.
                role="group"
                aria-label={toolCallIterationHeaderAriaLabel({
                  iteration: group.iteration,
                  toolCount: group.indices.length,
                  lang: lang === "kz" ? "kz" : "ru",
                })}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-zinc-200/80 px-1.5 font-semibold text-zinc-700"
                >
                  {group.iteration}
                </span>
                <span aria-hidden="true" className="font-medium">
                  {lang === "kz"
                    ? `Қадам ${group.iteration}`
                    : `Шаг ${group.iteration}`}
                </span>
                <span aria-hidden="true" className="opacity-70">
                  {/* s35 wave 44 (2026-04-28): the inline n===1
                      check + bare "инструментов" otherwise was
                      wrong for n=2/3/4 (correct paucal is
                      "инструмента"). `toolCountLabel` applies the
                      full RU paucal table; KZ stays uninflected. */}
                  ·{" "}
                  {toolCountLabel({
                    count: group.indices.length,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                </span>
              </div>
            )}
            <ul
              className={
                nested
                  ? "divide-y divide-zinc-200/60"
                  : "divide-y divide-zinc-100"
              }
            >
              {group.indices.map((idx) => {
                const call = calls[idx];
                if (!call) return null;
                const status: ToolCallStatus = call.status ?? "done";
                const isOpen = expanded === idx;
                const labelMap = TOOL_LABEL_OVERRIDES[call.tool];
                const friendlyLabel =
                  labelMap?.[lang === "kz" ? "kz" : "ru"] || call.tool;
                const argSummary = summariseArgs(call.args);
                const dur = formatDuration(callDuration(call));
                const argEntries = Object.entries(call.args || {}).filter(
                  ([, v]) => v !== undefined && v !== null && v !== "",
                );
                const raw = showRaw[idx] ?? false;

                return (
                  <li key={`${call.id ?? call.tool}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : idx)}
                      className="group/row flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-white/70"
                      aria-expanded={isOpen}
                      title={statusLabel(status)}
                      // s35 wave 31a (2026-04-28): canonical
                      // accessible name combining the action verb
                      // (state-aware) with friendly tool label,
                      // status, optional duration and arg summary.
                      // Pre-wave SR users heard concatenated visible
                      // spans without semantic glue.
                      aria-label={toolCallRowAriaLabel({
                        open: isOpen,
                        toolLabel: friendlyLabel,
                        status,
                        durationLabel: dur,
                        argSummary,
                        lang: lang === "kz" ? "kz" : "ru",
                      })}
                    >
                      <StatusDot status={status} label={statusLabel(status)} />
                      <ToolIcon tool={call.tool} />
                      <span className="font-semibold text-zinc-800">
                        {friendlyLabel}
                      </span>
                      {argSummary ? (
                        <span className="truncate text-[11.5px] text-zinc-500">
                          {argSummary}
                        </span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-2 text-zinc-400">
                        {dur ? (
                          <span
                            className={
                              "rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums " +
                              (status === "error"
                                ? "bg-rose-50 text-rose-600"
                                : status === "running"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-zinc-100 text-zinc-600")
                            }
                          >
                            {dur}
                          </span>
                        ) : null}
                        {/* s35 wave 35a (2026-04-28): single chevron
                            + CSS rotation via the parent button's
                            aria-expanded; ChevronRight at rest
                            rotates 90° down when open. */}
                        <ChevronRight
                          size={14}
                          className="samga-anim-chevron-target"
                        />
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="space-y-2 border-t border-zinc-100 bg-white/80 px-3 py-2.5 samga-anim-disclosure-expand">
                        {argEntries.length > 0 ? (
                          <div>
                            <div className="mb-1 flex items-center justify-between">
                              <div className="text-[10.5px] uppercase tracking-wide text-zinc-500">
                                {lang === "kz" ? "Аргументтер" : "Аргументы"}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowRaw((s) => ({
                                    ...s,
                                    [idx]: !raw,
                                  }));
                                }}
                                className={
                                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors " +
                                  (raw
                                    ? "bg-zinc-900 text-white"
                                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700")
                                }
                              >
                                <Braces size={11} />
                                {lang === "kz" ? "JSON" : "JSON"}
                              </button>
                            </div>
                            {raw ? (
                              <pre
                                className="mt-1 overflow-x-auto rounded-lg bg-zinc-950/95 px-2 py-1.5 text-[11px] leading-[1.5] text-zinc-100"
                                style={{
                                  fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                                }}
                              >
                                {JSON.stringify(call.args, null, 2)}
                              </pre>
                            ) : (
                              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                                {argEntries.map(([k, v]) => (
                                  <div key={k} className="contents">
                                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
                                      {k}
                                    </dt>
                                    <dd className="text-[12px] text-zinc-700 break-words">
                                      {formatValue(v)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        ) : null}
                        {call.preview ? (
                          <div>
                            <div className="text-[10.5px] uppercase tracking-wide text-zinc-500">
                              {lang === "kz" ? "Нәтиже" : "Результат"}
                            </div>
                            {(() => {
                              // s26 phase 6 (TOOLCARD-LATEX): library tool's
                              // preview is JSON whose citation `content` may
                              // contain LaTeX. Render those chunks through
                              // remark-math so $...$ shows as KaTeX instead
                              // of "fracab" raw text.
                              const lib =
                                call.tool === "consult_library" ||
                                call.tool === "search_textbook"
                                  ? tryParseLibraryPreview(call.preview)
                                  : null;
                              if (lib && lib.citations.length > 0) {
                                return (
                                  <div className="mt-1 max-h-72 space-y-2 overflow-auto rounded-lg bg-zinc-50 px-2 py-2">
                                    {lib.query ? (
                                      <div className="text-[11px] text-zinc-600">
                                        <span className="text-zinc-400">
                                          query:
                                        </span>{" "}
                                        <span className="font-medium">
                                          {lib.query}
                                        </span>
                                      </div>
                                    ) : null}
                                    {lib.citations.map((c, ci) => {
                                      const sim =
                                        c.similarity_score != null
                                          ? Math.round(c.similarity_score * 100)
                                          : null;
                                      return (
                                        <div
                                          key={ci}
                                          className="rounded-md border border-zinc-200/70 bg-white px-2 py-1.5"
                                        >
                                          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
                                            <span className="font-semibold text-zinc-800">
                                              {c.book_title ||
                                                `book ${c.book_id ?? "?"}`}
                                            </span>
                                            {c.grade != null && (
                                              <span className="text-zinc-400">
                                                ·{" "}
                                                {lang === "kz"
                                                  ? `${c.grade}-сынып`
                                                  : `${c.grade} класс`}
                                              </span>
                                            )}
                                            {c.page_number != null && (
                                              <span className="text-zinc-400">
                                                ·{" "}
                                                {lang === "kz"
                                                  ? `${c.page_number}-бет`
                                                  : `с. ${c.page_number}`}
                                              </span>
                                            )}
                                            {sim != null && (
                                              <span className="ml-auto rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                {sim}%
                                              </span>
                                            )}
                                          </div>
                                          <div className="prose prose-sm max-w-none text-[12px] leading-[1.55] text-zinc-700 [&_p]:my-1 [&_.katex]:text-[12.5px]">
                                            <ReactMarkdown
                                              remarkPlugins={[remarkMath]}
                                              rehypePlugins={[rehypeKatex]}
                                            >
                                              {unescapeLibraryContent(
                                                c.content || "",
                                              )}
                                            </ReactMarkdown>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {lib.count > lib.citations.length && (
                                      <div className="text-[10.5px] italic text-zinc-400">
                                        {lang === "kz"
                                          ? `+${lib.count - lib.citations.length} тағы`
                                          : `+${lib.count - lib.citations.length} ещё`}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <pre
                                  className="mt-1 max-h-48 overflow-auto rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] leading-[1.5] text-zinc-700"
                                  style={{
                                    fontFamily:
                                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                                  }}
                                >
                                  {call.preview}
                                </pre>
                              );
                            })()}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ToolCallTimeline;
