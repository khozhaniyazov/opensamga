"""
Agent harness (s24, 2026-04-26): true tool-use loop for /api/chat.

Design contract — read this before editing.

Why
---
Production /api/chat is a one-shot dispatcher: server-side RAG prefetch,
ONE LLM call with tools, ONE LLM call without tools. The model gets a
single round of tool calls per user turn. It cannot:
  - retry consult_library with a refined query when the first miss
  - call get_university_data → check_grant_chance → recommend_universities
  - notice it forgot a citation and re-retrieve

This module implements the Anthropic / Claude Code / Codex CLI loop:

    while iteration < cap:
        response = model(messages, tools)
        if response has thinking → emit thinking event
        if response has tool_calls:
            run them (parallel where safe), append tool messages
            continue
        if response has text:
            yield text + done
            break

What it intentionally does NOT do
---------------------------------
- No streaming-of-text-deltas (yet). M1 ships a *progressive event log*
  where each iteration emits whole tool_call / tool_result / final_text
  events. Mid-token streaming inside a single LLM call lands in M2.
- No server-side RAG prefetch. The model must call consult_library
  itself if it wants library context.
- No CI-style sandboxing or destructive-action gating — every UNT tool
  is read-only.
- No persistence of <think> blocks.

What it DOES enforce
--------------------
- Iteration cap (settings.CHAT_AGENT_MAX_ITERATIONS, default 8).
- Citation validator: every "📚 Источник" / book_id=N page=M emitted by
  the model must have come from a consult_library result *this turn*.
- Per-iteration parallel tool dispatch via asyncio.gather.
- Idempotent stop: model returning content with no tool_calls = done.
- Loop budget telemetry (iteration count, total tool calls).

Public surface
--------------
- run_agent_loop(...) — async generator yielding typed event dicts.

Event taxonomy (the `kind` field):
    {kind: "thinking",          text: str}                 # routed <think>
    {kind: "tool_call_started", id, name, args}
    {kind: "tool_result",       id, name, content_preview, is_error}
    {kind: "tool_part",         part: dict}                # parts_shaper output
    {kind: "text_delta",        text: str}                 # M1: whole-final-text (one delta)
    {kind: "iteration",         n, max}                    # progress beacon
    {kind: "done",              content: str, parts, book_id, page_number, rag_query_log_id, iterations}
    {kind: "error",             message: str, recoverable: bool}
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.chat.memory_tools import (
    MEMORY_TOOL_NAMES,
    MEMORY_TOOLS,
    execute_memory_tool,
)
from app.services.chat.parts_shaper import shape_tool_part
from app.services.chat.tool_executor import execute_tool
from app.services.chat.tools_registry import tools as DOMAIN_TOOLS

logger = logging.getLogger(__name__)

# Tool description for the agent — the model sees this concatenated with
# DOMAIN_TOOLS and MEMORY_TOOLS. Kept here so the prompts module stays focused
# on language locks / persona.
AGENT_PROTOCOL_PROMPT = """\
================================================================
TOOL-USE PROTOCOL (agent mode)
================================================================
You operate as an autonomous tool-using agent, similar to Claude Code
or Codex CLI. The harness will run any tool you call and feed the
result back to you. You may call multiple tools in a single turn and
across multiple turns within one user message — keep going until you
have enough information, then write the final answer.

Strict rules:
1. ALWAYS call `consult_library` before answering an academic question
   (math, physics, chemistry, biology, history, geography, informatics,
   languages). If the first call returns 0 hits, retry with a translated
   or rephrased query (RU↔KZ) before falling back to general knowledge.
2. If the question is about the user's own progress, profile, mistakes,
   or recent test scores, call the appropriate `get_user_*` /
   `get_recent_*` tool first. Do not guess.
3. For grant / university advice, prefer the dedicated tools:
   `get_university_data`, `check_grant_chance`, `get_historical_data`,
   `recommend_universities`, etc. Combine them when the question warrants.
4. NEVER fabricate citations. If you write "📚 *Источник*" or
   "📚 *Дереккөз*", it MUST quote a book that consult_library actually
   returned this turn. The harness validates this and will strip
   hallucinated citations.
5. When you have nothing more to fetch, write the final answer in the
   user's language (RU or KZ) and stop. Do NOT call a tool just to
   call one — empty calls cost the user money.
6. Iteration budget is finite. If you've called 5+ tools and still
   don't know, summarise what you found and ask the user a clarifying
   question rather than looping forever.
"""


# ---------------------------------------------------------------------------
# Citation validator
# ---------------------------------------------------------------------------

_CITATION_LINE_RE = re.compile(
    r"📚\s*\*?(?:Источник|Дереккөз|Source)\*?\s*:?\s*(?P<body>[^\n]+)",
    re.IGNORECASE,
)
_BOOK_PAGE_HINT_RE = re.compile(
    r"book_id\s*=\s*(?P<book_id>\d+)\s*[, ]\s*page\s*=\s*(?P<page>\d+)",
    re.IGNORECASE,
)


def _harvest_consulted_books(consult_history: list[dict]) -> set[tuple[int, int]]:
    """Set of (book_id, page) pairs the model legitimately retrieved
    via consult_library this turn. Used to validate citation chips."""
    out: set[tuple[int, int]] = set()
    for resp in consult_history:
        try:
            payload = json.loads(resp.get("raw") or "{}")
        except Exception:  # noqa: BLE001 — broad: malformed raw JSON envelope → skip this consult, keep harvest going
            continue
        for c in payload.get("citations", []) or []:
            try:
                bid = int(c.get("book_id"))
                pg = int(c.get("page_number"))
                out.add((bid, pg))
            except Exception:  # noqa: BLE001 — broad: malformed citation row (None/non-int) → skip row, continue
                continue
    return out


def _harvest_consulted_sources(consult_history: list[dict]) -> list[dict]:
    """s29 (2026-04-27, A2): build the dedup'd citation list the FE
    SourcesDrawer renders ("Used N sources" affordance below the
    bubble). One entry per unique (book_id, page_number) tuple, in
    the order of first encounter so the most-relevant hits stay
    visually adjacent to where the model cited them in the prose.

    Each entry carries everything the FE needs WITHOUT a follow-up
    network round-trip:
        {book_id, page_number, book_name, snippet, score}

    Defensive about missing/malformed citation rows — anything that
    can't be coerced to ints is silently skipped, matching
    `_harvest_consulted_books`. Snippet truncated to 200 chars to
    keep `chat_messages.message_metadata` JSON small.
    """
    seen: set[tuple[int, int]] = set()
    out: list[dict] = []
    for resp in consult_history:
        try:
            payload = json.loads(resp.get("raw") or "{}")
        except Exception:  # noqa: BLE001 — broad: malformed raw JSON envelope → skip this consult, keep harvest going
            continue
        for c in payload.get("citations", []) or []:
            try:
                bid = int(c.get("book_id"))
                pg = int(c.get("page_number"))
            except Exception:  # noqa: BLE001 — broad: malformed citation row (None/non-int) → skip row, continue
                continue
            key = (bid, pg)
            if key in seen:
                continue
            seen.add(key)
            snippet_raw = c.get("snippet") or c.get("content") or ""
            snippet = (
                str(snippet_raw)[:200].strip() if isinstance(snippet_raw, (str, bytes)) else ""
            )
            score_raw = c.get("score")
            try:
                score = float(score_raw) if score_raw is not None else None
            except Exception:  # noqa: BLE001 — broad: non-numeric score from upstream → drop the field, keep the citation
                score = None
            # s31 wave 2 (2026-04-27): production citations from
            # tool_executor's consult_library branch emit `book_title`,
            # NOT `book_name` — so the original `c.get("book_name")`
            # always resolved to None in real flows. The s26 unit test
            # happened to feed `book_name` directly so this drift was
            # invisible. Read both keys, prefer `book_name` for
            # back-compat with the existing tests + any consumer that
            # passes a normalised dict.
            name_raw = c.get("book_name") or c.get("book_title") or ""
            # s32 (A5, 2026-04-27): forward textbook freshness so the
            # FE OutdatedDataPill can flag citations from snapshots
            # older than the staleness threshold. Coerce to str (the
            # FE parses ISO-8601) and drop empties to None.
            updated_raw = c.get("updated_at")
            updated_iso = (
                str(updated_raw).strip() or None
                if isinstance(updated_raw, str) and updated_raw.strip()
                else None
            )
            out.append(
                {
                    "book_id": bid,
                    "page_number": pg,
                    "book_name": str(name_raw).strip() or None,
                    "snippet": snippet or None,
                    "score": score,
                    "updated_at": updated_iso,
                }
            )
    return out


def _all_consult_library_zero_hit(consult_history: list[dict]) -> bool:
    """True iff the model called consult_library at least once *this
    turn* AND every call returned 0 citations. Drives the no-library
    marker injection so the FE NoLibraryPill renders deterministically
    (vs. trusting the model to remember the marker convention)."""
    if not consult_history:
        return False
    for resp in consult_history:
        try:
            payload = json.loads(resp.get("raw") or "{}")
        except Exception:  # noqa: BLE001 — broad: malformed envelope; conservative answer is "we may have hits" → False
            # Malformed envelope — be conservative, don't claim "no hits".
            return False
        if (payload.get("citations") or []) or (payload.get("count") or 0):
            return False
    return True


def _no_library_marker(language: str) -> str:
    """Match the literal markers the legacy chat path emits (and that
    AssistantMessage.tsx strips + promotes to the amber pill)."""
    return "*(Кітапханада табылмады)*" if language == "kz" else "*(Не найдено в библиотеке)*"


# --- s27 (2026-04-27, C1 from QA report): unverified-score redaction ---
#
# Headline trust bug: the model invented "Ты сейчас набрала 101 из 140
# баллов..." in the very first reply, before any tool call, by summing
# self-declared onboarding scores from the system profile block. The
# system prompt forbids this (`_USER_DATA_FIDELITY_RU/KZ`) but the
# model still fell through. This regex-gated post-pass strips any
# sentence that pairs a 2nd-person pronoun WITH a score-shaped number,
# UNLESS one of the user-data tools fired this turn (in which case the
# numbers are presumed grounded).
#
# The regexes are deliberately conservative:
#   - score shape must look UNT-ish (X из 140 / X/140 / N баллов / N%)
#   - user marker must be a 2nd-person pronoun or possessive, not just
#     a verb form, so generic answers like "нужно набрать 75 баллов"
#     stay intact.


# Names of tools that, when fired, ground a user-specific score claim.
# These return the user's actual score / mistake / attempt history.
def _record_failed_tool_call(
    failed_tool_calls: list[dict],
    seen_keys: set[tuple[str, str]],
    name: str,
    raw: str | None,
) -> bool:
    """Append a (name, error_preview) row when not already seen.

    s30 (A4, 2026-04-27). Helper extracted so the dedup contract is
    unit-pinnable without driving the full agent loop.

    Returns True iff a new row was appended.

    Contract:
      * preview is the first 160 chars of `raw`, stripped; empty falls
        back to the literal string ``"error"``.
      * (name, preview) is the dedup key. Two failures from the same
        tool with the SAME preview collapse to one row; same tool with
        different previews keep both rows.
      * Mutates `failed_tool_calls` and `seen_keys` in place.
    """
    err_preview = (raw or "")[:160].strip() or "error"
    key = (name, err_preview)
    if key in seen_keys:
        return False
    seen_keys.add(key)
    failed_tool_calls.append({"name": name, "error_preview": err_preview})
    return True


def _compute_is_general_knowledge(
    cleaned_final: str | None,
    fired_tool_names: set[str] | frozenset[str],
) -> bool:
    """Return True iff visible prose was produced WITHOUT firing any
    user-data tool.

    s30 (A6, 2026-04-27). The FE renders a "not personalised" pill on
    True; the RedactionPill (A3) covers the case where the model TRIED
    to personalise and got redacted.
    """
    if not cleaned_final:
        return False
    return not bool(set(fired_tool_names) & _USER_DATA_TOOL_NAMES)


_USER_DATA_TOOL_NAMES = frozenset(
    {
        "get_user_profile",
        "get_recent_mistakes",
        "get_recent_test_attempts",
        "get_dream_university_progress",
    }
)

# 2nd-person pronouns / possessives in RU + KZ. Matches ты/вы/тебя/
# твой/у тебя/etc and KZ сен/сенің/сенде/нәтижең/etc. Word-boundaries
# on both sides so we don't catch substrings.
_USER_PRONOUN_RE = re.compile(
    r"(?ix)"
    # RU 2nd-person + possessives + dative/genitive forms
    r"\b(?:"
    r"ты|тебя|тебе|тобой|"
    r"тво[йяёе]|твои|твоих|твое[йю]|твоего|твоему|твоим|твоими|"
    r"вы|вас|вам|вами|"
    r"ваш(?:а|и|е|их|ему|ими|ей)?"
    r")\b"
    r"|"
    # KZ 2nd-person markers (informal сен + formal сіз) + possessive
    # endings on балл/нәтиже. -ың / -ің is the 2sg possessive.
    r"(?:^|[^\w\u0400-\u04FF])(?:"
    r"сен|сені|сенің|сенде|сенен|саған|"
    r"сіз|сізді|сіздің|сізде|сізден|сізге|"
    r"нәтижең|нәтижеңіз|"
    r"бал(?:ың|ыңыз|дарың|дарыңыз)|"
    r"ұпай(?:ың|ыңыз)"
    r")(?=[^\w\u0400-\u04FF]|$)"
)

# Score-shaped numbers in UNT context.
_USER_SCORE_RE = re.compile(
    r"(?ix)"
    r"\b\d{1,3}\s*(?:из|/|\\\\)\s*140\b"  # X из 140 / X/140
    r"|\b\d{1,3}\s*из\s*\d{1,3}\s*балл"  # X из Y баллов
    r"|\b\d{1,3}\s*балл"  # N баллов / балл / балла
    r"|\b\d{1,3}\s*ұпай"  # KZ
    r"|\b\d{1,3}\s*%"  # N%
    r"|\b\d{1,3}\s*/\s*\d{1,3}\b"  # bare X/Y
)


def _redact_unverified_score_claims(text: str, language: str) -> tuple[str, int]:
    """Drop sentences that pair a 2nd-person pronoun with a score-shaped
    number. Used by the agent loop after the loop ends and ONLY when no
    user-data tool fired this turn. Returns (cleaned_text, n_redacted).

    The clip granularity is per-sentence (split on `.!?` + linebreaks)
    so the surrounding answer survives. If at least one sentence was
    redacted we append a brief italic notice telling the user the
    real number is one tool call away."""
    if not text:
        return text, 0

    # Split on sentence boundaries — keep linebreak boundaries too so
    # we don't span paragraphs in the regex window.
    pieces = re.split(r"(?<=[.!?])\s+|\n+", text)
    redacted = 0
    keep: list[str] = []
    for s in pieces:
        body = s.strip()
        if not body:
            keep.append(s)
            continue
        if _USER_PRONOUN_RE.search(body) and _USER_SCORE_RE.search(body):
            redacted += 1
            continue  # drop
        keep.append(s)

    if redacted == 0:
        return text, 0

    cleaned = " ".join(p for p in keep if p.strip()).strip()
    notice = (
        "_(нақты балыңды `get_recent_test_attempts` арқылы алғаннан кейін ғана айта аламын)_"
        if language == "kz"
        else "_(точные цифры по твоему результату могу назвать "
        "только после вызова `get_recent_test_attempts`)_"
    )
    cleaned = f"{cleaned}\n\n{notice}".strip() if cleaned else notice
    return cleaned, redacted


def _validate_citations(final_text: str, allowed: set[tuple[int, int]]) -> tuple[str, int]:
    """Strip hallucinated `book_id=N page=M` hint comments where the
    pair was NOT seen in any consult_library result this turn. Returns
    (cleaned_text, dropped_count). Visible 📚 lines are left alone —
    the FE renders them as text — but the structured hint pair, which
    drives the deep-link chip, is what we gate on."""
    dropped = 0

    def _replace(match: re.Match) -> str:
        nonlocal dropped
        bid = int(match.group("book_id"))
        pg = int(match.group("page"))
        if (bid, pg) in allowed:
            return match.group(0)
        dropped += 1
        return ""  # drop the hallucinated hint

    cleaned = _BOOK_PAGE_HINT_RE.sub(_replace, final_text)
    return cleaned, dropped


# ---------------------------------------------------------------------------
# Thinking-block routing (Qwen / DeepSeek-style <think>...</think>)
# ---------------------------------------------------------------------------

_THINK_BLOCK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)


def _extract_thinking(raw_content: str) -> tuple[str, list[str]]:
    """Pull <think>...</think> blocks out of raw model content.
    Returns (cleaned_text, [thinking_blocks])."""
    if not raw_content:
        return raw_content or "", []
    blocks = [m.strip() for m in _THINK_BLOCK_RE.findall(raw_content) if m.strip()]
    cleaned = _THINK_BLOCK_RE.sub("", raw_content).strip()
    return cleaned, blocks


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------


def _build_full_toolset() -> list[dict]:
    """Domain tools + memory tools, in the order the model sees them."""
    return list(DOMAIN_TOOLS) + list(MEMORY_TOOLS)


async def _dispatch_one_tool(
    *,
    tool_call: Any,
    db: AsyncSession,
    language: str,
    user_id: int | None,
    preferred_grade: int | None,
) -> dict[str, Any]:
    """Run a single tool call. Always returns a dict with the OpenAI
    tool-message envelope plus our own bookkeeping."""
    function_name = tool_call.function.name
    raw_args = tool_call.function.arguments or "{}"
    try:
        function_args = json.loads(raw_args)
    except json.JSONDecodeError:
        return {
            "tool_call_id": tool_call.id,
            "name": function_name,
            "raw": json.dumps({"error": "invalid_arguments_json"}),
            "args": {},
            "is_error": True,
            "shaped_part": None,
        }

    is_error = False
    # s35 wave A1 (2026-04-28): wrap every tool dispatch in
    # asyncio.wait_for so a single hung tool can't burn the whole
    # iteration cap. Timeout surfaces as a normal tool-error envelope
    # (`{"error":"timeout: …"}`) so the existing FailedToolPill /
    # is_error path lights up uniformly. The settings knob keeps the
    # value tunable without re-deploying.
    timeout_sec = float(getattr(settings, "CHAT_AGENT_TOOL_TIMEOUT_SEC", 30.0))
    try:
        if function_name in MEMORY_TOOL_NAMES:
            content = await asyncio.wait_for(
                execute_memory_tool(function_name, function_args, db, user_id),
                timeout=timeout_sec,
            )
        else:
            content = await asyncio.wait_for(
                execute_tool(
                    function_name,
                    function_args,
                    db,
                    language,
                    preferred_grade=preferred_grade,
                    user_id=user_id,
                ),
                timeout=timeout_sec,
            )
        # tool_executor returns plain strings sometimes ("Данные не найдены.")
        # not JSON. Wrap if needed so the model gets a uniform envelope.
        if not content:
            content = json.dumps({"error": "empty_tool_response"})
        elif not (content.lstrip().startswith("{") or content.lstrip().startswith("[")):
            content = json.dumps({"text": content}, ensure_ascii=False)
    except TimeoutError:
        logger.warning("tool %s timed out after %.1fs", function_name, timeout_sec)
        is_error = True
        content = json.dumps(
            {"error": f"timeout: tool exceeded {timeout_sec:.0f}s"},
            ensure_ascii=False,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("tool %s raised", function_name)
        is_error = True
        content = json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)

    shaped_part = None
    try:
        shaped_part = shape_tool_part(function_name, function_args, content)
    except Exception:  # noqa: BLE001 — broad: shape_tool_part is best-effort cosmetic FE shaping; never abort the turn over it
        shaped_part = None

    return {
        "tool_call_id": tool_call.id,
        "name": function_name,
        "raw": content,
        "args": function_args,
        "is_error": is_error,
        "shaped_part": shaped_part,
    }


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def run_agent_loop(
    *,
    client: Any,
    model_name: str,
    base_messages: list[dict],
    db: AsyncSession,
    language: str,
    user_id: int | None,
    preferred_grade: int | None,
    max_iterations: int | None = None,
) -> AsyncGenerator[dict, None]:
    """Async generator. Yields event dicts (see module docstring).

    The caller is responsible for:
      - building `base_messages` (system + history + final user turn)
      - persisting the final assistant content + parts after `done`
      - quota accounting (it ticks per user turn, not per iteration —
        a single user message yields exactly one `done`)
    """
    cap = max_iterations or settings.CHAT_AGENT_MAX_ITERATIONS
    cap = max(1, min(cap, 25))  # clamp; nobody benefits from cap=200

    # Inject the agent protocol into the system message if not already there.
    messages = list(base_messages)
    if messages and messages[0].get("role") == "system":
        sys_content = messages[0]["content"] or ""
        if "TOOL-USE PROTOCOL (agent mode)" not in sys_content:
            messages[0] = {
                **messages[0],
                "content": sys_content + "\n\n" + AGENT_PROTOCOL_PROMPT,
            }
    else:
        messages = [{"role": "system", "content": AGENT_PROTOCOL_PROMPT}] + messages

    full_tools = _build_full_toolset()
    consult_library_history: list[dict] = []
    # s27 (C1, 2026-04-27): track which tool names fired this turn so the
    # post-loop redaction pass can decide whether unverified score claims
    # should survive. The set is checked against _USER_DATA_TOOL_NAMES.
    fired_tool_names: set[str] = set()
    # s30 (A4, 2026-04-27): tool failures the FE needs to surface as a
    # "data fetch failed; falling back to general knowledge" pill below
    # the bubble. We record name + a short preview of the error so the
    # FE can render a per-tool reason. Multiple failures from the same
    # tool name are deduped by their preview to avoid n× spam.
    failed_tool_calls: list[dict] = []
    _seen_failure_keys: set[tuple[str, str]] = set()
    accumulated_parts: list[dict] = []
    last_book_id: int | None = None
    last_page_number: int | None = None
    last_rag_query_log_id: int | None = None

    iteration = 0
    final_content = ""
    final_was_streamed = False
    # === Loop guards (s24 hardening) ====================================
    # Track every (name, args_signature) pair the model has called this
    # turn. If it tries to repeat the SAME tool with SAME args twice,
    # something has gone wrong (most likely the model didn't notice the
    # first result). We allow the dup once (model self-correction), but
    # break the loop on the second repeat.
    seen_call_signatures: dict[tuple[str, str], int] = {}
    # Hard ceiling on parallel tool calls per iteration. The model can
    # ask for arbitrary many; we cap at 6 so a runaway dispatch can't
    # nuke the DB or OpenAI quota in a single turn.
    MAX_TOOLS_PER_ITERATION = 6
    # Cumulative tool-call budget across all iterations. Beyond this we
    # stop dispatching and force the model to summarise.
    MAX_TOTAL_TOOL_CALLS = 16
    total_tool_calls = 0

    # s35 wave A2 (2026-04-28): per-iteration timing + cumulative LLM
    # token usage. These get added to the iteration log line at end of
    # turn so boss can grep slow turns and quota burn without standing
    # up formal metrics. NOT surfaced to the user — `done` envelope is
    # unchanged user-side, but adds an internal `usage` block keyed by
    # `prompt_tokens`/`completion_tokens`/`total_tokens`/`turn_ms`.
    turn_start_monotonic = time.monotonic()
    usage_totals: dict[str, int] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }

    def _accumulate_usage(usage_obj: Any) -> None:
        if usage_obj is None:
            return
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            try:
                v = getattr(usage_obj, key, None)
                if v is None and isinstance(usage_obj, dict):
                    v = usage_obj.get(key)
                if v is None:
                    continue
                usage_totals[key] = int(usage_totals.get(key, 0)) + int(v)
            except Exception:  # noqa: BLE001 — broad: usage object shape varies per provider; skip key, telemetry is best-effort
                continue

    def _arg_signature(name: str, args: dict[str, Any]) -> tuple[str, str]:
        try:
            sig = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
        except Exception:  # noqa: BLE001 — broad: non-JSON-serialisable args (rare) → fall back to repr for the dedup key
            sig = repr(args)
        return (name, sig)

    while iteration < cap:
        iteration += 1
        yield {"kind": "iteration", "n": iteration, "max": cap}

        # Decide whether to stream this iteration. We stream the FINAL
        # answer (when we expect no more tools) so it types out, but we
        # do NOT stream intermediate iterations because we need the
        # complete tool_calls payload before we can dispatch. Heuristic:
        # if we've already used at least one tool, the next call is very
        # likely the final answer, so try streaming. Worst case: the
        # model wants more tools, we collect tool_calls from the stream
        # and proceed normally.
        try_stream = total_tool_calls > 0
        raw_content = ""
        tool_calls_list: list[Any] = []
        try:
            if try_stream:
                # === STREAMING PATH ============================================
                # s35 wave A2: opt into stream_options.include_usage so
                # OpenAI returns the cumulative usage block on the final
                # chunk. _accumulate_usage tolerates missing usage so this
                # is safe against providers that ignore the option.
                stream = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    tools=full_tools,
                    tool_choice="auto",
                    stream=True,
                    stream_options={"include_usage": True},
                )
                # Accumulator for tool_calls emitted as deltas.
                # Keyed by index → {id, name, arguments-so-far}.
                tc_accum: dict[int, dict[str, str]] = {}
                visible_buffer = ""  # for in-flight thinking-block detection
                in_think = False
                async for chunk in stream:
                    # OpenAI's final usage chunk has empty .choices.
                    chunk_usage = getattr(chunk, "usage", None)
                    if chunk_usage is not None:
                        _accumulate_usage(chunk_usage)
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    if not delta:
                        continue
                    # Text content delta.
                    piece = getattr(delta, "content", None) or ""
                    if piece:
                        raw_content += piece
                        # Stream visible (non-thinking) tokens to the FE
                        # immediately. We track <think>...</think> state
                        # across chunks so we never leak reasoning to the
                        # text channel.
                        visible_buffer += piece
                        # Process visible_buffer chunk-by-chunk to split
                        # thinking vs. visible.
                        out_visible = ""
                        out_thinking = ""
                        i = 0
                        while i < len(visible_buffer):
                            if not in_think:
                                idx = visible_buffer.find("<think>", i)
                                if idx == -1:
                                    out_visible += visible_buffer[i:]
                                    i = len(visible_buffer)
                                else:
                                    out_visible += visible_buffer[i:idx]
                                    i = idx + len("<think>")
                                    in_think = True
                            else:
                                idx = visible_buffer.find("</think>", i)
                                if idx == -1:
                                    out_thinking += visible_buffer[i:]
                                    i = len(visible_buffer)
                                else:
                                    out_thinking += visible_buffer[i:idx]
                                    i = idx + len("</think>")
                                    in_think = False
                        visible_buffer = ""
                        if out_thinking and settings.CHAT_AGENT_THINKING_VISIBLE:
                            yield {"kind": "thinking_delta", "text": out_thinking}
                        if out_visible:
                            yield {"kind": "text_delta", "text": out_visible}
                    # Tool-call deltas.
                    deltas = getattr(delta, "tool_calls", None) or []
                    for tcd in deltas:
                        idx = getattr(tcd, "index", 0) or 0
                        slot = tc_accum.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                        if getattr(tcd, "id", None):
                            slot["id"] = tcd.id
                        fn = getattr(tcd, "function", None)
                        if fn is not None:
                            if getattr(fn, "name", None):
                                slot["name"] = fn.name
                            if getattr(fn, "arguments", None):
                                slot["arguments"] += fn.arguments

                # Materialise tool_calls into the same shape the
                # non-streaming path produced.
                if tc_accum:

                    class _FakeFn:
                        def __init__(self, name: str, args: str):
                            self.name = name
                            self.arguments = args

                    class _FakeTC:
                        def __init__(
                            self,
                            id_: str,
                            name: str,
                            args: str,
                            iteration: int = iteration,  # noqa: B008  bound at class-def time
                        ):
                            self.id = id_ or f"call_{name}_{iteration}"
                            self.type = "function"
                            self.function = _FakeFn(name, args)

                    for idx in sorted(tc_accum.keys()):
                        slot = tc_accum[idx]
                        if not slot["name"]:
                            continue
                        tool_calls_list.append(
                            _FakeTC(slot["id"], slot["name"], slot["arguments"] or "{}")
                        )
            else:
                # === NON-STREAMING PATH (first iteration / pre-tool) ==========
                response = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    tools=full_tools,
                    tool_choice="auto",
                )
                _accumulate_usage(getattr(response, "usage", None))
                if not response.choices:
                    yield {
                        "kind": "error",
                        "message": "Model returned no choices.",
                        "recoverable": False,
                    }
                    return
                msg = response.choices[0].message
                raw_content = msg.content or ""
                tool_calls_list = list(getattr(msg, "tool_calls", None) or [])
        except Exception as exc:
            logger.exception("agent loop iteration %d: model call failed", iteration)
            yield {
                "kind": "error",
                "message": f"{type(exc).__name__}: {exc}",
                "recoverable": False,
            }
            return

        tool_calls = tool_calls_list or None

        # Route any thinking blocks out before showing the user.
        # (Streaming path already emitted them as deltas. Non-streaming
        # path needs the post-hoc extraction here.)
        cleaned_text, thinking_blocks = _extract_thinking(raw_content)
        if not try_stream and settings.CHAT_AGENT_THINKING_VISIBLE:
            for tb in thinking_blocks:
                yield {"kind": "thinking", "text": tb}

        # If the model returned tool_calls, dispatch them and loop.
        if tool_calls:
            # === LOOP GUARDS =================================================
            # Cap parallel calls per iteration. If the model asked for more,
            # truncate and warn — the truncated calls won't appear, so the
            # model will probably re-request them on the next iteration if
            # they were really needed.
            if len(tool_calls) > MAX_TOOLS_PER_ITERATION:
                logger.warning(
                    "agent loop: iter %d requested %d tools; capping to %d",
                    iteration,
                    len(tool_calls),
                    MAX_TOOLS_PER_ITERATION,
                )
                tool_calls = tool_calls[:MAX_TOOLS_PER_ITERATION]

            # Total budget enforcement. If we've already burned the
            # cumulative budget, refuse to dispatch and force a final
            # answer by re-prompting with no tools available.
            if total_tool_calls + len(tool_calls) > MAX_TOTAL_TOOL_CALLS:
                logger.warning(
                    "agent loop: hit MAX_TOTAL_TOOL_CALLS=%d; forcing summary",
                    MAX_TOTAL_TOOL_CALLS,
                )
                yield {
                    "kind": "error",
                    "message": "tool_budget_exhausted",
                    "recoverable": True,
                }
                # Append a system nudge so the next turn is final.
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "TOOL BUDGET EXHAUSTED. You have used the maximum "
                            "number of tool calls for this turn. Write the final "
                            "answer now using only the information you've gathered. "
                            "Do NOT call any more tools."
                        ),
                    }
                )
                # Loop one more time without tools to force a textual reply.
                try:
                    response = await client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                    )
                    _accumulate_usage(getattr(response, "usage", None))
                    if response.choices:
                        forced = response.choices[0].message.content or ""
                        forced_clean, _ = _extract_thinking(forced)
                        final_content = forced_clean
                except Exception:
                    logger.exception("budget-exhausted summary failed")
                    final_content = (
                        "⚠️ Достигнут лимит инструментов. Сформулируйте вопрос точнее."
                        if language != "kz"
                        else "⚠️ Құралдар лимитіне жетті. Сұрағыңызды нақтыласаңыз."
                    )
                break

            # Identical-call dedup. If the model asks for the SAME
            # (name, args) it has already called this turn AND received a
            # response for, that's a sign of looping. Allow once for
            # transient errors, break on the second repeat.
            problem_dups: list[tuple[str, dict]] = []
            for tc in tool_calls:
                try:
                    parsed = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    parsed = {}
                sig = _arg_signature(tc.function.name, parsed)
                count = seen_call_signatures.get(sig, 0)
                if count >= 1:
                    problem_dups.append((tc.function.name, parsed))
            if problem_dups and len(problem_dups) == len(tool_calls):
                # Every tool call this iteration is a duplicate → break.
                logger.warning(
                    "agent loop: all %d tool calls are duplicates; breaking",
                    len(tool_calls),
                )
                # Force a summary turn without tools.
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "DUPLICATE TOOL CALLS DETECTED. You have already called "
                            "these tools with these exact arguments. Use the existing "
                            "results to answer now — do NOT re-call them."
                        ),
                    }
                )
                try:
                    response = await client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                    )
                    _accumulate_usage(getattr(response, "usage", None))
                    if response.choices:
                        forced = response.choices[0].message.content or ""
                        forced_clean, _ = _extract_thinking(forced)
                        final_content = forced_clean
                except Exception:
                    logger.exception("dup-break summary failed")
                break

            total_tool_calls += len(tool_calls)
            # Mark all signatures seen.
            for tc in tool_calls:
                try:
                    parsed = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    parsed = {}
                sig = _arg_signature(tc.function.name, parsed)
                seen_call_signatures[sig] = seen_call_signatures.get(sig, 0) + 1
            # =================================================================

            # Append the assistant's tool-call message to history.
            messages.append(
                {
                    "role": "assistant",
                    "content": cleaned_text,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": tc.type,
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments or "{}",
                            },
                        }
                        for tc in tool_calls
                    ],
                }
            )

            # Emit a "tool_call_started" event for each, then dispatch in parallel.
            for tc in tool_calls:
                try:
                    parsed_args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    parsed_args = {"_raw": tc.function.arguments}
                yield {
                    "kind": "tool_call_started",
                    "id": tc.id,
                    "name": tc.function.name,
                    "args": parsed_args,
                }

            results = await asyncio.gather(
                *[
                    _dispatch_one_tool(
                        tool_call=tc,
                        db=db,
                        language=language,
                        user_id=user_id,
                        preferred_grade=preferred_grade,
                    )
                    for tc in tool_calls
                ]
            )

            for r in results:
                # Append to conversation for the next iteration.
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": r["tool_call_id"],
                        "name": r["name"],
                        "content": r["raw"],
                    }
                )
                # s27 (C1): record EVERY successful tool call so the
                # post-loop redaction can spare grounded-numeric replies.
                # Errors are deliberately NOT counted as grounding —
                # if the data fetch failed, anything numeric the model
                # writes is still unverified.
                if not r["is_error"]:
                    fired_tool_names.add(r["name"])
                else:
                    # s30 (A4, 2026-04-27): record per-tool failures
                    # for the FE pill via the dedup'd helper.
                    _record_failed_tool_call(
                        failed_tool_calls,
                        _seen_failure_keys,
                        r["name"],
                        r["raw"],
                    )

                # Bookkeeping: track consult_library results for the
                # citation validator + envelope deep-link metadata.
                if r["name"] == "consult_library" and not r["is_error"]:
                    consult_library_history.append(r)
                    try:
                        payload = json.loads(r["raw"] or "{}")
                        cits = payload.get("citations") or []
                        if cits:
                            top = cits[0]
                            try:
                                last_book_id = int(top.get("book_id"))
                            except Exception:  # noqa: BLE001 — broad: malformed citation row → leave last_book_id unchanged
                                pass
                            try:
                                last_page_number = int(top.get("page_number"))
                            except Exception:  # noqa: BLE001 — broad: malformed citation row → leave last_page_number unchanged
                                pass
                        rqli = payload.get("rag_query_log_id")
                        if rqli is not None:
                            last_rag_query_log_id = int(rqli)
                    except Exception:  # noqa: BLE001 — broad: malformed JSON envelope; keep iterating, citation tail is best-effort
                        pass

                # Emit a compact tool_result event (truncated for the FE log).
                preview = r["raw"]
                if len(preview) > 1200:
                    preview = preview[:1200] + "…"
                yield {
                    "kind": "tool_result",
                    "id": r["tool_call_id"],
                    "name": r["name"],
                    "content_preview": preview,
                    "is_error": r["is_error"],
                }

                if r["shaped_part"] is not None:
                    accumulated_parts.append(r["shaped_part"])
                    yield {"kind": "tool_part", "part": r["shaped_part"]}

            # Loop again — model now has tool results.
            continue

        # No tool_calls → this is the final answer.
        # If we streamed this iteration, the text was already emitted as
        # text_delta chunks; mark that so the post-loop block doesn't
        # double-emit it.
        final_content = cleaned_text or raw_content
        final_was_streamed = try_stream
        break
    else:
        final_was_streamed = False

    if iteration >= cap and not final_content:
        # Hit the cap mid-tool-call. Surface what we have so the user
        # at least sees that the agent stopped, not a silent truncation.
        final_content = (
            "⚠️ Достигнут лимит шагов агента. "
            "Вот что я успел собрать выше — попробуйте уточнить вопрос."
            if language != "kz"
            else "⚠️ Агенттің қадамдар лимитіне жетті. "
            "Жоғарыдағы дерек негізінде сұрауды нақтылаңыз."
        )

    # Citation validation pass.
    allowed = _harvest_consulted_books(consult_library_history)
    consulted_sources = _harvest_consulted_sources(consult_library_history)
    cleaned_final, dropped = _validate_citations(final_content, allowed)
    if dropped:
        logger.warning("agent loop: dropped %d hallucinated citation hint(s)", dropped)

    # s27 (2026-04-27, C1 from QA report): redact unverified score claims.
    # If the model emitted a sentence pairing a 2nd-person pronoun with
    # an UNT-ish score number AND no user-data tool fired this turn, the
    # number is by definition unverified — strip the sentence.
    score_redacted = 0
    if cleaned_final and not (fired_tool_names & _USER_DATA_TOOL_NAMES):
        cleaned_final, score_redacted = _redact_unverified_score_claims(cleaned_final, language)
        if score_redacted:
            logger.warning(
                "agent loop: redacted %d unverified user-score claim(s)",
                score_redacted,
            )

    # s27 (2026-04-27, B2 from QA report): when the model used
    # consult_library at least once *and every call returned 0 hits*,
    # the answer is by definition not citation-backed. The legacy chat
    # path injects a literal marker via inject_citation_into_response;
    # the agent_loop path was leaving it to the model, which forgets.
    # Force-append the marker so AssistantMessage's NoLibraryPill can
    # surface the amber "не нашёл в учебниках" hint deterministically.
    no_library_appended = False
    if cleaned_final and _all_consult_library_zero_hit(consult_library_history):
        marker = _no_library_marker(language)
        if marker not in cleaned_final:
            cleaned_final = f"{cleaned_final.rstrip()}\n\n{marker}"
            no_library_appended = True

    # If the final iteration was streamed, the FE already received the
    # text token-by-token. We still emit a synthetic text_delta with
    # JUST the citation-validator delta (if any tokens were dropped),
    # but otherwise only the `done` event lands.
    if cleaned_final and not final_was_streamed:
        yield {"kind": "text_delta", "text": cleaned_final}
    elif final_was_streamed and (dropped > 0 or no_library_appended or score_redacted > 0):
        # The streamed text contained hallucinated citation hints OR we
        # appended the no-library marker post-stream OR we redacted
        # unverified score claims. Send a `text_replace` with the
        # canonical version so the FE can swap what it rendered.
        yield {"kind": "text_replace", "text": cleaned_final}

    # Lightweight telemetry — visible in backend logs, no DB writes.
    # Boss can grep these to see how the loop actually behaved in prod
    # before we wire formal metrics. s35 wave A2 (2026-04-28) added
    # `turn_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens` so
    # slow-turn / quota-burn diagnosis doesn't need OpenAI dashboards.
    turn_ms = int((time.monotonic() - turn_start_monotonic) * 1000)
    logger.info(
        "agent_loop.done iters=%d tool_calls=%d dropped_citations=%d "
        "streamed=%s len=%d turn_ms=%d ptok=%d ctok=%d ttok=%d user_id=%s",
        iteration,
        total_tool_calls,
        dropped,
        final_was_streamed,
        len(cleaned_final or ""),
        turn_ms,
        usage_totals.get("prompt_tokens", 0),
        usage_totals.get("completion_tokens", 0),
        usage_totals.get("total_tokens", 0),
        user_id,
    )

    # s30 (A6, 2026-04-27): "general knowledge" signal. See
    # _compute_is_general_knowledge for the contract — extracted
    # so vitest-style pinning is possible without standing up
    # the whole agent loop.
    is_general_knowledge = _compute_is_general_knowledge(cleaned_final, fired_tool_names)

    yield {
        "kind": "done",
        "content": cleaned_final,
        "parts": accumulated_parts or None,
        "book_id": last_book_id,
        "page_number": last_page_number,
        "rag_query_log_id": last_rag_query_log_id,
        "iterations": iteration,
        "tool_calls_total": total_tool_calls,
        "hallucinated_citations_dropped": dropped,
        "unverified_score_claims_redacted": score_redacted,
        "consulted_sources": consulted_sources,
        # s30 (A4): per-tool failure list for the FE banner. Empty list
        # ⇒ no banner. Always included on the envelope (even when empty)
        # so the FE doesn't need to default-undefined the field.
        "failed_tool_calls": failed_tool_calls,
        # s30 (A6): "general knowledge" flag. See discussion above.
        "is_general_knowledge": is_general_knowledge,
        "streamed": final_was_streamed,
    }
