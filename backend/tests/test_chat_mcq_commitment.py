"""Session 24 (2026-04-24): pin down the MCQ-commitment block added to the
chat system prompt to fight answer-synthesis over-refusal.

Background: the reliable-subset baseline (`_rag_eval_baseline_2026-04-24.md`)
showed that 5 of 8 residual failures on the 17-Q golden set were the same
shape — the model cited a library chunk with concrete numeric / factual
evidence but refused to commit to a specific option letter (6274, 8342,
3995, 2249, 12311). The fix is NOT retrieval, it is a new
`_MCQ_COMMITMENT_{RU,KZ}` block in `backend/app/services/chat/prompts.py`
that forces a terminal `**Ответ: <letter>**` / `**Жауап: <letter>**` line
on MCQ-shaped turns.

These tests validate the *prompt* (fast, deterministic) rather than the
*model* (slow, non-deterministic). They cover:
  1. RU prompt contains the commitment signature.
  2. KZ prompt contains the commitment signature.
  3. Commitment block is positioned after the library protocol.
  4. RU block does not leak into KZ prompt (no cross-lang bleed).
  5. KZ block does not leak into RU prompt.
  6. Each language-specific block appears exactly once (no drift).
  7. Commitment block forbids hedging when evidence exists.
  8. Commitment block tells the model NOT to append the answer line on
     open-ended (non-MCQ) questions.

The previous P0 sentinel regression suite
(`test_chat_empty_fallback_no_citation.py`) is unaffected by this change
and covered by the commit-gate pytest invocation.
"""

from __future__ import annotations

import pytest

from app.services.chat.prompts import (
    _LIBRARY_PROTOCOL_KZ,
    _LIBRARY_PROTOCOL_RU,
    _MCQ_COMMITMENT_KZ,
    _MCQ_COMMITMENT_RU,
    build_chat_system_prompt,
)


def test_ru_prompt_contains_mcq_commitment_signature():
    prompt = build_chat_system_prompt("ru")
    assert "**Ответ: <буква>**" in prompt, (
        "RU prompt must teach the model the exact terminal line format."
    )
    # Key behavioral directive: must not hedge when library gave evidence.
    assert "Запрещено хеджировать" in prompt


def test_kz_prompt_contains_mcq_commitment_signature():
    prompt = build_chat_system_prompt("kz")
    assert "**Жауап: <әріп>**" in prompt, (
        "KZ prompt must teach the model the exact terminal line format."
    )
    assert "хеджирлеуге тыйым салынады" in prompt


def test_mcq_commitment_follows_library_protocol_ru():
    """Ordering matters: the commitment block must come AFTER the library
    protocol so the model first decides whether it has evidence, then
    applies the commitment rule."""
    prompt = build_chat_system_prompt("ru")
    lib_start = prompt.find("АКАДЕМИЧЕСКИЕ ВОПРОСЫ")
    mcq_start = prompt.find("МНОГОВАРИАНТНЫЕ ВОПРОСЫ")
    assert lib_start != -1, "library protocol block missing"
    assert mcq_start != -1, "mcq commitment block missing"
    assert mcq_start > lib_start, (
        "MCQ block must come AFTER library protocol — the commitment "
        "depends on whether a library hit was found."
    )


def test_mcq_commitment_follows_library_protocol_kz():
    prompt = build_chat_system_prompt("kz")
    lib_start = prompt.find("АКАДЕМИЯЛЫҚ СҰРАҚТАР")
    mcq_start = prompt.find("КӨПВАРИАНТТЫ СҰРАҚТАР")
    assert lib_start != -1
    assert mcq_start != -1
    assert mcq_start > lib_start


def test_ru_block_absent_from_kz_prompt():
    """Guard against accidental cross-language bleed. The RU commitment
    block must not end up inside a KZ prompt, because that would
    contradict the 'reply in Kazakh only' rule upstream."""
    kz_prompt = build_chat_system_prompt("kz")
    # Pull a phrase unique to the RU commitment block.
    ru_marker = "МНОГОВАРИАНТНЫЕ ВОПРОСЫ"
    assert ru_marker not in kz_prompt


def test_kz_block_absent_from_ru_prompt():
    ru_prompt = build_chat_system_prompt("ru")
    kz_marker = "КӨПВАРИАНТТЫ СҰРАҚТАР"
    assert kz_marker not in ru_prompt


def test_each_commitment_block_appears_exactly_once():
    """Protect against future merge-drift re-introducing the block twice."""
    ru_prompt = build_chat_system_prompt("ru")
    kz_prompt = build_chat_system_prompt("kz")
    assert ru_prompt.count("МНОГОВАРИАНТНЫЕ ВОПРОСЫ") == 1
    assert kz_prompt.count("КӨПВАРИАНТТЫ СҰРАҚТАР") == 1


def test_mcq_block_forbids_answer_line_on_open_ended_questions_ru():
    """The negative rule matters: we do NOT want to start appending
    '**Ответ: <letter>**' on every conversational turn. The block must
    carve out open-ended questions explicitly."""
    assert "обычных открытых вопросов" in _MCQ_COMMITMENT_RU
    assert "НЕ добавляй" in _MCQ_COMMITMENT_RU


def test_mcq_block_forbids_answer_line_on_open_ended_questions_kz():
    assert "ашық сұрақтар" in _MCQ_COMMITMENT_KZ
    assert "ҚОСПА" in _MCQ_COMMITMENT_KZ


def test_mcq_block_requires_commitment_when_library_has_evidence():
    """Directly pins the anti-hedging rule that kills 6274/8342/3995 etc."""
    # RU: 'цитата уже закрыла неопределённость' is the phrase the baseline
    # residual analysis pointed at.
    assert "цитата уже закрыла неопределённость" in _MCQ_COMMITMENT_RU
    # KZ: 'цитата белгісіздікті жоя алды' is the mirror.
    assert "цитата белгісіздікті жоя алды" in _MCQ_COMMITMENT_KZ


def test_library_and_mcq_blocks_coexist_without_contradicting():
    """The library protocol allows '(Не найдено в библиотеке)' only when
    there is no citation. The MCQ block must still permit the commitment
    line on no-library MCQ turns — verify both instructions are present
    and internally consistent (no 'never commit' phrase in the library
    block)."""
    assert "Не найдено в библиотеке" in _LIBRARY_PROTOCOL_RU
    assert "Кітапханада табылмады" in _LIBRARY_PROTOCOL_KZ
    # No accidental 'do not commit' directive that would fight the MCQ block.
    assert "не выбирай" not in _LIBRARY_PROTOCOL_RU.lower()
    assert "таңдама" not in _LIBRARY_PROTOCOL_KZ.lower()
