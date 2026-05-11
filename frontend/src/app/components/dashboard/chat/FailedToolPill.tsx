/**
 * s30 (A4, 2026-04-27) — FailedToolPill.
 *
 * Amber/red pill below the assistant bubble that fires when one or
 * more tool calls failed during this turn. Sibling to NoLibraryPill
 * (s26 phase 5), RedactionPill (s28 A3), and SourcesDrawer (s29 A2).
 *
 * Why it exists: today, when `consult_library` 5xx's or
 * `get_user_profile` errors out, the agent loop falls back to general
 * knowledge but the user has no way to know — they just see a normal
 * answer and assume it's grounded. This pill tells them
 * "data fetch failed for {tool}; this answer is from general
 * knowledge" so they can re-ask later or treat numeric claims with
 * caution.
 *
 * BE feed: `agent_loop` records each non-deduped (name, error_preview)
 * via `_record_failed_tool_call` and yields the list as
 * `done.failed_tool_calls`. Persisted into
 * `chat_messages.message_metadata.failed_tool_calls` only when
 * non-empty.
 *
 * The pure helpers `shouldShowFailedToolPill`, `failedToolPillLabel`,
 * and `prettyToolName` are exported so vitest can pin the contracts
 * without standing up a DOM renderer.
 */

import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { FailedToolCall } from "./types";
import { useLang } from "../../LanguageContext";

interface Props {
  /** Failure rows from the agent loop. Undefined / empty ⇒ no pill. */
  failures?: FailedToolCall[] | null;
}

/** Pure predicate — exported for vitest. Empty list ⇒ no pill. */
export function shouldShowFailedToolPill(
  failures?: FailedToolCall[] | null,
): boolean {
  return Array.isArray(failures) && failures.length > 0;
}

/** Pure label helper — bilingual count copy. Exported for vitest.
 *
 *  s35 wave B1 (2026-04-28): when there is exactly ONE failed tool we
 *  surface its pretty name in the collapsed summary (e.g.
 *  "Сбой: библиотека"), so users learn whether the failed call was the
 *  RAG retriever (rephrase the question) or a profile lookup (sign-in /
 *  profile-completion). For ≥2 failures we fall back to the count copy
 *  since multiple distinct tool names won't fit in the pill chrome —
 *  the expanded list still shows everything.
 */
export function failedToolPillLabel(
  count: number,
  lang: "ru" | "kz",
  singleToolName?: string | null,
): string {
  if (count === 1 && singleToolName) {
    const pretty = prettyToolName(singleToolName, lang);
    return lang === "kz" ? `Сәтсіз: ${pretty}` : `Сбой: ${pretty}`;
  }
  if (lang === "kz") {
    return count === 1
      ? "Дерек алу сәтсіз: 1 құрал"
      : `Дерек алу сәтсіз: ${count} құрал`;
  }
  return count === 1
    ? "Не удалось получить данные: 1 инструмент"
    : `Не удалось получить данные: ${count} инструмента`;
}

/** Map raw tool names to a readable label.  Falls back to the
 *  raw name (snake_case becomes Title Case) when not in the
 *  curated map.  Exported for vitest. */
export function prettyToolName(name: string, lang: "ru" | "kz"): string {
  const ruMap: Record<string, string> = {
    consult_library: "библиотека",
    get_user_profile: "профиль",
    get_recent_mistakes: "ошибки",
    get_recent_test_attempts: "результаты тестов",
    get_user_progress: "прогресс",
  };
  const kzMap: Record<string, string> = {
    consult_library: "кітапхана",
    get_user_profile: "профиль",
    get_recent_mistakes: "қателер",
    get_recent_test_attempts: "тест нәтижелері",
    get_user_progress: "прогресс",
  };
  const map = lang === "kz" ? kzMap : ruMap;
  if (map[name]) return map[name];
  // Fallback: turn `some_tool_name` into `Some Tool Name`.
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function FailedToolPill({ failures }: Props) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  if (!shouldShowFailedToolPill(failures)) return null;
  const list = failures as FailedToolCall[];
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  // s35 wave B1: pass the single tool name when there is exactly one
  // failure so the collapsed summary surfaces "Сбой: библиотека"
  // instead of the generic "1 инструмент".
  const singleToolName = list.length === 1 && list[0] ? list[0].name : null;
  const summary = failedToolPillLabel(list.length, langSafe, singleToolName);
  const expandAria =
    langSafe === "kz"
      ? open
        ? "Қателер тізімін жасыру"
        : "Қателер тізімін ашу"
      : open
        ? "Скрыть детали ошибок"
        : "Раскрыть детали ошибок";

  return (
    <div className="mt-2 w-full max-w-full" role="status" aria-live="polite">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={expandAria}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400 samga-anim-pill"
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        <span>{summary}</span>
        {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation. */}
        <ChevronRight
          className="h-3 w-3 samga-anim-chevron-target"
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          role="list"
          className="mt-2 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/60 p-2 samga-anim-disclosure-expand"
        >
          {list.map((row, idx) => (
            <li
              key={`${row.name}-${idx}`}
              className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[12px] text-amber-900"
            >
              <span className="font-semibold">
                {prettyToolName(row.name, langSafe)}
              </span>
              <span className="text-[11px] italic text-amber-800">
                {row.error_preview}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FailedToolPill;
