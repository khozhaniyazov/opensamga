"""s26 (2026-04-26): unit tests for pure-function pieces of the
agent-loop chat harness.

These tests do NOT require a running LLM — they exercise the parts
of `app.services.chat.agent_loop` that are pure functions:

  - `_validate_citations` drops `book_id=N page=M` hint pairs that
    were not seen in any consult_library result this turn.
  - `_extract_thinking` peels `<think>...</think>` blocks out of raw
    model content.
  - `_harvest_consulted_books` rebuilds the (book_id, page_number)
    allow-set from the consult_library response history.

We also pin the loop guards (`MAX_TOOLS_PER_ITERATION`,
`MAX_TOTAL_TOOL_CALLS`) so future refactors that bump them have to
update the test deliberately.

And we cover the s25 `_shape_dream_uni_progress` shaper which the
s26 frontend `DreamUniProgressCard` reads — the gap field, the row
truncation cap, and the empty-rows + null current_score guard that
suppresses the card.
"""

from __future__ import annotations

import json

import pytest

from app.services.chat.agent_loop import (
    _BOOK_PAGE_HINT_RE,
    _USER_DATA_TOOL_NAMES,
    _all_consult_library_zero_hit,
    _compute_is_general_knowledge,
    _extract_thinking,
    _harvest_consulted_books,
    _harvest_consulted_sources,
    _no_library_marker,
    _record_failed_tool_call,
    _redact_unverified_score_claims,
    _validate_citations,
)
from app.services.chat.parts_shaper import shape_tool_part

# ---------------------------------------------------------------------------
# _validate_citations
# ---------------------------------------------------------------------------


class TestValidateCitations:
    def test_keeps_allowed_pair(self) -> None:
        text = (
            "Второй закон Ньютона связывает силу и ускорение.\n\n"
            "<!-- samga-citation book_id=257 page=66 -->\n"
            "📚 Источник: Физика 9 — стр. 66"
        )
        cleaned, dropped = _validate_citations(text, {(257, 66)})
        assert dropped == 0
        assert "book_id=257" in cleaned
        # Visible citation line is left untouched.
        assert "📚 Источник" in cleaned

    def test_drops_hallucinated_pair(self) -> None:
        text = "Закон сохранения импульса.\n\n<!-- samga-citation book_id=999 page=42 -->"
        cleaned, dropped = _validate_citations(text, {(257, 66)})
        assert dropped == 1
        assert "book_id=999" not in cleaned
        # Visible body still intact.
        assert "Закон сохранения импульса." in cleaned

    def test_mixed_keeps_allowed_and_drops_fake(self) -> None:
        text = (
            "Часть 1. <!-- samga-citation book_id=257 page=66 -->\n"
            "Часть 2. <!-- samga-citation book_id=999 page=10 -->\n"
            "Часть 3. <!-- samga-citation book_id=257 page=67 -->"
        )
        cleaned, dropped = _validate_citations(text, {(257, 66), (257, 67)})
        assert dropped == 1
        assert "book_id=257 page=66" in cleaned
        assert "book_id=257 page=67" in cleaned
        assert "book_id=999" not in cleaned

    def test_empty_allow_set_drops_everything(self) -> None:
        text = (
            "Любая выдумка. "
            "<!-- samga-citation book_id=1 page=1 --> "
            "<!-- samga-citation book_id=2 page=2 -->"
        )
        cleaned, dropped = _validate_citations(text, set())
        assert dropped == 2
        assert "book_id=1" not in cleaned
        assert "book_id=2" not in cleaned

    def test_no_hints_is_noop(self) -> None:
        text = "Текст без hint-комментариев."
        cleaned, dropped = _validate_citations(text, {(1, 2)})
        assert cleaned == text
        assert dropped == 0

    def test_hint_regex_matches_canonical_form(self) -> None:
        # Sanity-check the regex itself so a future loosening doesn't
        # silently disable the dropper.
        m = _BOOK_PAGE_HINT_RE.search("book_id=42, page=7")
        assert m is not None
        assert int(m.group("book_id")) == 42
        assert int(m.group("page")) == 7


# ---------------------------------------------------------------------------
# _extract_thinking
# ---------------------------------------------------------------------------


class TestExtractThinking:
    def test_strips_single_block(self) -> None:
        raw = "<think>step one</think>Видимый ответ."
        cleaned, blocks = _extract_thinking(raw)
        assert cleaned == "Видимый ответ."
        assert blocks == ["step one"]

    def test_strips_multiple_blocks(self) -> None:
        raw = "Pre<think>a</think>mid<think>b</think>post"
        cleaned, blocks = _extract_thinking(raw)
        # Whitespace-collapsed but content-preserving.
        assert "Pre" in cleaned
        assert "mid" in cleaned
        assert "post" in cleaned
        assert "<think>" not in cleaned
        assert blocks == ["a", "b"]

    def test_multiline_block_preserved_as_one(self) -> None:
        raw = "<think>line one\nline two\nline three</think>final."
        cleaned, blocks = _extract_thinking(raw)
        assert cleaned == "final."
        assert len(blocks) == 1
        assert "line one" in blocks[0] and "line three" in blocks[0]

    def test_empty_input_safe(self) -> None:
        cleaned, blocks = _extract_thinking("")
        assert cleaned == ""
        assert blocks == []

    def test_no_block_returns_unchanged(self) -> None:
        raw = "просто ответ без блоков"
        cleaned, blocks = _extract_thinking(raw)
        assert cleaned == raw
        assert blocks == []


# ---------------------------------------------------------------------------
# _harvest_consulted_books
# ---------------------------------------------------------------------------


class TestHarvestConsultedBooks:
    def _entry(self, citations: list[dict]) -> dict:
        # Mirrors how `_dispatch_one_tool` shapes the consult_history
        # entries the agent loop stashes.
        return {"raw": json.dumps({"citations": citations})}

    def test_collects_pairs(self) -> None:
        history = [
            self._entry(
                [
                    {"book_id": 257, "page_number": 66},
                    {"book_id": 257, "page_number": 67},
                ]
            ),
            self._entry([{"book_id": 215, "page_number": 149}]),
        ]
        out = _harvest_consulted_books(history)
        assert out == {(257, 66), (257, 67), (215, 149)}

    def test_skips_malformed_rows(self) -> None:
        history = [
            self._entry([{"book_id": "not-a-num", "page_number": 1}]),
            self._entry([{"book_id": 1}]),  # missing page_number
            self._entry([{"book_id": 7, "page_number": 8}]),
        ]
        out = _harvest_consulted_books(history)
        assert out == {(7, 8)}

    def test_skips_non_json_raw(self) -> None:
        history = [{"raw": "this is not json"}, {"raw": None}]
        out = _harvest_consulted_books(history)
        assert out == set()


# ---------------------------------------------------------------------------
# _harvest_consulted_sources (s29 A2)
# ---------------------------------------------------------------------------


class TestHarvestConsultedSources:
    """The dedup'd citation list the FE SourcesDrawer renders. Pairs
    1:1 with `_harvest_consulted_books` for the same `consult_history`
    fixtures so the two stay in lockstep when the citation envelope
    changes."""

    def _entry(self, citations: list[dict]) -> dict:
        return {"raw": json.dumps({"citations": citations})}

    def test_emits_one_row_per_unique_pair(self) -> None:
        history = [
            self._entry(
                [
                    {
                        "book_id": 257,
                        "page_number": 66,
                        "book_name": "Физика 9",
                        "snippet": "Второй закон Ньютона: F = m·a.",
                        "score": 0.91,
                    },
                    {
                        "book_id": 257,
                        "page_number": 67,
                        "book_name": "Физика 9",
                    },
                ]
            ),
            self._entry(
                [
                    # Duplicate of the first — must NOT appear twice.
                    {"book_id": 257, "page_number": 66, "book_name": "Физика 9"},
                    {"book_id": 215, "page_number": 149},
                ]
            ),
        ]
        out = _harvest_consulted_sources(history)
        assert [(s["book_id"], s["page_number"]) for s in out] == [
            (257, 66),
            (257, 67),
            (215, 149),
        ]
        first = out[0]
        assert first["book_name"] == "Физика 9"
        assert first["snippet"] == "Второй закон Ньютона: F = m·a."
        assert first["score"] == pytest.approx(0.91)

    def test_skips_malformed_and_keeps_partial(self) -> None:
        history = [
            self._entry([{"book_id": "not-a-num", "page_number": 1}]),
            self._entry([{"book_id": 1}]),  # missing page_number
            self._entry([{"book_id": 7, "page_number": 8}]),
        ]
        out = _harvest_consulted_sources(history)
        assert len(out) == 1
        assert out[0]["book_id"] == 7
        assert out[0]["page_number"] == 8
        # Optional fields collapse to None when not provided — keeps
        # the FE typing happy without forcing legacy rows to carry
        # everything.
        assert out[0]["book_name"] is None
        assert out[0]["snippet"] is None
        assert out[0]["score"] is None

    def test_snippet_truncated_to_200_chars(self) -> None:
        long = "ы" * 500
        history = [self._entry([{"book_id": 1, "page_number": 1, "snippet": long}])]
        out = _harvest_consulted_sources(history)
        assert len(out[0]["snippet"]) == 200

    def test_empty_history_returns_empty_list(self) -> None:
        assert _harvest_consulted_sources([]) == []
        assert _harvest_consulted_sources([{"raw": "garbage"}]) == []

    def test_book_title_alias_resolves_for_production_citations(self) -> None:
        # s31 wave 2 (2026-04-27): production citations from
        # tool_executor.consult_library emit `book_title`, NOT
        # `book_name`. The harvester must read either key so the FE
        # SourcesDrawer doesn't silently render "Источник #N" for
        # every real-world citation. (Existing tests above pass
        # `book_name` directly — both must keep working.)
        history = [
            self._entry(
                [
                    {
                        "book_id": 257,
                        "page_number": 64,
                        "book_title": "Физика 9 (Туякова)",
                        "snippet": "Закон Ньютона",
                    }
                ]
            )
        ]
        out = _harvest_consulted_sources(history)
        assert len(out) == 1
        assert out[0]["book_name"] == "Физика 9 (Туякова)"

    def test_book_name_wins_over_book_title_when_both_present(self) -> None:
        # Defensive: if a payload carries both keys (e.g. a future
        # tool_executor change starts emitting both for analytics),
        # `book_name` is the canonical FE field — prefer it.
        history = [
            self._entry(
                [
                    {
                        "book_id": 1,
                        "page_number": 1,
                        "book_name": "canonical",
                        "book_title": "fallback",
                    }
                ]
            )
        ]
        out = _harvest_consulted_sources(history)
        assert out[0]["book_name"] == "canonical"

    def test_updated_at_iso_is_forwarded(self) -> None:
        # s32 (A5, 2026-04-27): textbook freshness must flow from the
        # tool_executor citation envelope into the harvested dict so
        # the FE OutdatedDataPill can render. The harvester must NOT
        # parse the timestamp itself — that's the FE's concern.
        history = [
            self._entry(
                [
                    {
                        "book_id": 257,
                        "page_number": 64,
                        "book_title": "Физика 9",
                        "updated_at": "2024-09-12T08:30:00+00:00",
                    }
                ]
            )
        ]
        out = _harvest_consulted_sources(history)
        assert out[0]["updated_at"] == "2024-09-12T08:30:00+00:00"

    def test_updated_at_missing_collapses_to_none(self) -> None:
        # Defensive: legacy snapshots / older citations don't carry
        # the freshness key. The dict must always include the field
        # (FE typing) but with None.
        history = [self._entry([{"book_id": 1, "page_number": 1}])]
        out = _harvest_consulted_sources(history)
        assert "updated_at" in out[0]
        assert out[0]["updated_at"] is None

    def test_updated_at_non_string_collapses_to_none(self) -> None:
        # Future-proofing: if a non-string slips through (e.g. a
        # datetime object that wasn't isoformatted), drop it rather
        # than serialising garbage to the FE.
        history = [
            self._entry(
                [
                    {
                        "book_id": 1,
                        "page_number": 1,
                        "updated_at": 12345,
                    }
                ]
            )
        ]
        out = _harvest_consulted_sources(history)
        assert out[0]["updated_at"] is None

    def test_dedupe_preserves_first_seen_order(self) -> None:
        # Most-relevant hits in `consult_library` come first; the
        # drawer should reflect that ordering.
        history = [
            self._entry(
                [
                    {"book_id": 5, "page_number": 5},
                    {"book_id": 1, "page_number": 1},
                    {"book_id": 3, "page_number": 3},
                ]
            ),
            self._entry([{"book_id": 1, "page_number": 1}]),  # duplicate, ignored
        ]
        out = _harvest_consulted_sources(history)
        assert [(s["book_id"], s["page_number"]) for s in out] == [
            (5, 5),
            (1, 1),
            (3, 3),
        ]


# ---------------------------------------------------------------------------
# _record_failed_tool_call (s30 A4)
# ---------------------------------------------------------------------------


class TestRecordFailedToolCall:
    """Pins the dedup contract for the FE tool-failure pill feed."""

    def test_appends_first_failure(self) -> None:
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        added = _record_failed_tool_call(rows, seen, "consult_library", "RAG retriever down")
        assert added is True
        assert rows == [{"name": "consult_library", "error_preview": "RAG retriever down"}]

    def test_dedupes_same_name_and_preview(self) -> None:
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        _record_failed_tool_call(rows, seen, "consult_library", "down")
        added2 = _record_failed_tool_call(rows, seen, "consult_library", "down")
        assert added2 is False
        assert len(rows) == 1

    def test_keeps_distinct_previews_for_same_name(self) -> None:
        # Same tool failing for two distinct reasons should produce
        # two rows so the FE can render both.
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        _record_failed_tool_call(rows, seen, "consult_library", "down")
        _record_failed_tool_call(rows, seen, "consult_library", "timeout")
        assert [r["error_preview"] for r in rows] == ["down", "timeout"]

    def test_truncates_to_160_chars(self) -> None:
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        long_err = "x" * 500
        _record_failed_tool_call(rows, seen, "get_user_profile", long_err)
        assert len(rows[0]["error_preview"]) == 160

    def test_empty_raw_falls_back_to_literal_error(self) -> None:
        # Empty/whitespace-only previews must map to the literal
        # string "error" so the FE never renders a blank tooltip.
        rows: list[dict] = []
        seen: set[tuple[str, str]] = set()
        _record_failed_tool_call(rows, seen, "tool_a", None)
        _record_failed_tool_call(rows, seen, "tool_b", "   ")
        assert [r["error_preview"] for r in rows] == ["error", "error"]


# ---------------------------------------------------------------------------
# _compute_is_general_knowledge (s30 A6)
# ---------------------------------------------------------------------------


class TestComputeIsGeneralKnowledge:
    """Pins the A6 'not personalised' pill predicate."""

    def test_true_when_prose_and_no_user_data_tool(self) -> None:
        # consult_library is NOT a user-data tool, so a RAG-only turn
        # is still considered general knowledge from the user-personalisation
        # perspective.
        assert _compute_is_general_knowledge("Some answer", {"consult_library"}) is True

    def test_false_when_user_data_tool_fired(self) -> None:
        # Any tool in _USER_DATA_TOOL_NAMES suppresses the pill.
        for tool in _USER_DATA_TOOL_NAMES:
            assert _compute_is_general_knowledge("Some answer", {tool}) is False, (
                f"{tool} should suppress general-knowledge pill"
            )

    def test_false_on_empty_prose(self) -> None:
        # No visible answer ⇒ no pill (the bubble will be empty / error).
        assert _compute_is_general_knowledge("", set()) is False
        assert _compute_is_general_knowledge(None, set()) is False  # type: ignore[arg-type]

    def test_true_on_no_tools_at_all(self) -> None:
        # Pure model answer with zero tool calls is the canonical
        # "general knowledge" case.
        assert _compute_is_general_knowledge("Hello", set()) is True


# ---------------------------------------------------------------------------
# Loop guards (sanity-pin)
# ---------------------------------------------------------------------------


class TestLoopGuardsPinned:
    """If somebody bumps these, the test should fail loudly so the
    bump is intentional and reflected in the QWEN.md memory note."""

    def test_max_tools_per_iteration_pinned(self) -> None:
        from app.services.chat import agent_loop as al

        src = open(al.__file__, encoding="utf-8").read()
        assert "MAX_TOOLS_PER_ITERATION = 6" in src

    def test_max_total_tool_calls_pinned(self) -> None:
        from app.services.chat import agent_loop as al

        src = open(al.__file__, encoding="utf-8").read()
        assert "MAX_TOTAL_TOOL_CALLS = 16" in src


# ---------------------------------------------------------------------------
# parts_shaper: dream_uni_progress (s25)
# ---------------------------------------------------------------------------


class TestDreamUniProgressShaper:
    def test_happy_path_carries_gap_per_row(self) -> None:
        raw = json.dumps(
            {
                "current_score": 130,
                "quota_type": "GENERAL",
                "target_universities": ["KBTU", "AITU"],
                "target_majors": ["B057"],
                "rows": [
                    {
                        "uni_name": "KBTU",
                        "major_code": "B057",
                        "year": 2025,
                        "threshold": 120,
                        "your_score": 130,
                        "gap": 10,
                    },
                    {
                        "uni_name": "AITU",
                        "major_code": "B057",
                        "year": 2025,
                        "threshold": 135,
                        "your_score": 130,
                        "gap": -5,
                    },
                ],
            },
            ensure_ascii=False,
        )
        out = shape_tool_part("get_dream_university_progress", {}, raw)
        assert out is not None
        assert out["tool"] == "get_dream_university_progress"
        envelope = out["result"]
        assert envelope["tool"] == "dream_university_progress"
        data = envelope["data"]
        assert data["current_score"] == 130
        assert data["quota_type"] == "GENERAL"
        rows = data["rows"]
        assert len(rows) == 2
        assert rows[0]["gap"] == 10
        assert rows[1]["gap"] == -5
        assert rows[0]["uni_name"] == "KBTU"

    def test_truncates_to_15_rows(self) -> None:
        rows = [
            {
                "uni_name": f"U{i}",
                "major_code": "B000",
                "year": 2025,
                "threshold": 100 + i,
                "your_score": 130,
                "gap": 30 - i,
            }
            for i in range(25)
        ]
        raw = json.dumps({"current_score": 130, "rows": rows})
        out = shape_tool_part("get_dream_university_progress", {}, raw)
        assert out is not None
        assert len(out["result"]["data"]["rows"]) == 15

    def test_empty_rows_and_null_score_drop_card(self) -> None:
        raw = json.dumps({"current_score": None, "rows": []})
        out = shape_tool_part("get_dream_university_progress", {}, raw)
        # Card is suppressed so the FE doesn't render an empty box.
        assert out is None

    def test_empty_rows_with_score_still_renders(self) -> None:
        # Edge: profile has score but no targets resolved → keep the
        # card so the user sees at least the quota / score header.
        raw = json.dumps({"current_score": 130, "rows": []})
        out = shape_tool_part("get_dream_university_progress", {}, raw)
        assert out is not None
        assert out["result"]["data"]["current_score"] == 130
        assert out["result"]["data"]["rows"] == []

    def test_error_payload_drops_card(self) -> None:
        raw = json.dumps({"error": "no profile"})
        out = shape_tool_part("get_dream_university_progress", {}, raw)
        assert out is None

    def test_non_json_raw_drops_card(self) -> None:
        out = shape_tool_part("get_dream_university_progress", {}, "Что-то пошло не так.")
        assert out is None


# ---------------------------------------------------------------------------
# Frontend ReasoningPanel persistence shape — backend contract sanity
# ---------------------------------------------------------------------------


class TestPersistenceShapeContract:
    """The s26 frontend ReasoningPanel relies on each persisted
    tool_call part carrying both `iteration` and `duration_ms`. The
    SSE handler in `app/routers/chat.py` is responsible for stamping
    them. This test pins the source so a refactor that drops either
    field gets caught."""

    def test_chat_router_stamps_iteration_and_duration_ms(self) -> None:
        from app.routers import chat as chat_router

        src = open(chat_router.__file__, encoding="utf-8").read()
        # The two field names must appear in the SSE event_stream
        # path; we don't pin the surrounding code shape, just the
        # contract.
        assert '"iteration"' in src or "'iteration'" in src or "iteration =" in src
        assert "duration_ms" in src
        # And the timing source — wall clock — needs to be there.
        assert "time.time()" in src or "time.monotonic()" in src


# ---------------------------------------------------------------------------
# s27 (2026-04-27, B2 from QA): no-library marker injection
# ---------------------------------------------------------------------------


class TestNoLibraryMarker:
    """When the agent consulted the library and every call returned 0
    hits, the agent_loop should append a literal marker that the FE's
    AssistantMessage strips & promotes to the amber NoLibraryPill.
    Pinning the predicate + marker so the contract with the FE doesn't
    drift silently."""

    def _entry(self, citations: list[dict], count: int | None = None) -> dict:
        payload: dict = {"citations": citations}
        if count is not None:
            payload["count"] = count
        return {"raw": json.dumps(payload)}

    def test_marker_strings_match_frontend(self) -> None:
        # AssistantMessage.tsx checks for these literal strings.
        assert _no_library_marker("ru") == "*(Не найдено в библиотеке)*"
        assert _no_library_marker("kz") == "*(Кітапханада табылмады)*"
        # Default / unknown language → RU.
        assert _no_library_marker("en") == "*(Не найдено в библиотеке)*"

    def test_zero_hit_predicate_true_when_all_empty(self) -> None:
        history = [
            self._entry([], count=0),
            self._entry([], count=0),
        ]
        assert _all_consult_library_zero_hit(history) is True

    def test_zero_hit_predicate_false_with_any_citation(self) -> None:
        history = [
            self._entry([], count=0),
            self._entry([{"book_id": 1, "page_number": 1}], count=1),
        ]
        assert _all_consult_library_zero_hit(history) is False

    def test_zero_hit_predicate_false_on_empty_history(self) -> None:
        # Model never called consult_library — we don't claim no-hit.
        assert _all_consult_library_zero_hit([]) is False

    def test_zero_hit_predicate_false_on_nonzero_count_without_citations(
        self,
    ) -> None:
        # Defensive: count>0 with empty citations is ambiguous, treat as a hit.
        history = [self._entry([], count=3)]
        assert _all_consult_library_zero_hit(history) is False

    def test_zero_hit_predicate_conservative_on_malformed(self) -> None:
        history = [{"raw": "not-json"}, self._entry([], count=0)]
        assert _all_consult_library_zero_hit(history) is False


# ---------------------------------------------------------------------------
# s27 (2026-04-27, C1 from QA): unverified-score redaction
# ---------------------------------------------------------------------------


class TestRedactUnverifiedScoreClaims:
    """Headline trust bug from the s26 e2e: model invented "Ты сейчас
    набрала 101 из 140 баллов" before any tool call.
    `_redact_unverified_score_claims` is the post-loop guard that strips
    sentences pairing a 2nd-person pronoun with a UNT-shaped score
    number. The agent_loop only invokes it when no user-data tool fired
    this turn, so all tests here verify the helper itself, not the gate."""

    def test_known_user_data_tools_pinned(self) -> None:
        # If somebody adds a new memory tool that returns score data,
        # they need to add it here so the gate lets through grounded
        # numbers. Forces the conversation.
        assert "get_user_profile" in _USER_DATA_TOOL_NAMES
        assert "get_recent_test_attempts" in _USER_DATA_TOOL_NAMES
        assert "get_recent_mistakes" in _USER_DATA_TOOL_NAMES
        assert "get_dream_university_progress" in _USER_DATA_TOOL_NAMES
        # consult_library is NOT in here — it grounds citations, not scores.
        assert "consult_library" not in _USER_DATA_TOOL_NAMES

    def test_strips_invented_score_in_first_turn_ru(self) -> None:
        text = (
            "Привет! Ты сейчас набрала 101 из 140 баллов — это хороший старт.\n\n"
            "Давай разберёмся, как улучшить математику."
        )
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 1
        assert "101 из 140" not in out
        # Surrounding answer survives.
        assert "Давай разберёмся" in out
        # Notice is appended.
        assert "get_recent_test_attempts" in out

    def test_strips_percent_form(self) -> None:
        text = "Твой результат 75% — нужно подтянуть физику."
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 1
        assert "75%" not in out

    def test_strips_short_form(self) -> None:
        text = "У тебя 18 баллов по математике. Это нужно исправить."
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 1
        assert "18 балл" not in out
        assert "Это нужно" in out

    def test_strips_kz_personal_score(self) -> None:
        text = "Сенің нәтижең 85 ұпай. Бұл тамаша.\n\nАлгебраға көп көңіл бөл."
        out, n = _redact_unverified_score_claims(text, "kz")
        assert n == 1
        assert "85 ұпай" not in out
        assert "Алгебраға" in out
        # KZ-locale notice.
        assert "нақты балыңды" in out

    def test_preserves_generic_score_advice(self) -> None:
        # No 2nd-person marker → no redaction. Generic guidance about
        # the threshold is fine.
        text = (
            "Чтобы поступить на грант в КБТУ нужно набрать 75 баллов.\n"
            "Минимальный порог по математике — 50."
        )
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 0
        assert out == text

    def test_preserves_generic_kz_advice(self) -> None:
        text = "Грантқа түсу үшін 90 ұпай қажет. Математика 50-ден жоғары болу керек."
        out, n = _redact_unverified_score_claims(text, "kz")
        assert n == 0
        assert out == text

    def test_empty_input_safe(self) -> None:
        assert _redact_unverified_score_claims("", "ru") == ("", 0)
        assert _redact_unverified_score_claims(None, "ru") == (None, 0)  # type: ignore[arg-type]

    def test_redacts_only_offending_sentence_keeps_rest(self) -> None:
        text = (
            "Это твой первый пробник. У тебя 101 из 140. "
            "Будем работать с математикой и физикой. "
            "Минимальный порог для гранта — 75."
        )
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 1
        # The "101 из 140" sentence is gone.
        assert "101 из 140" not in out
        # But the generic threshold survives even though it has "75".
        assert "Минимальный порог" in out
        # And the unrelated "first probnik" sentence survives.
        assert "первый пробник" in out

    def test_appends_notice_only_once_even_with_multiple_redactions(
        self,
    ) -> None:
        text = "Ты набрала 18 из 140. У тебя 50% правильных. Иди исправлять ошибки."
        out, n = _redact_unverified_score_claims(text, "ru")
        assert n == 2
        # Notice appended exactly once.
        assert out.count("get_recent_test_attempts") == 1
