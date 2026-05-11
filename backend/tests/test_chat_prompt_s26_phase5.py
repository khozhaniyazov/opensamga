"""Session 26 phase 5 (2026-04-27): pin the two new system-prompt blocks
added in response to the e2e QA report (`_session26_e2e_qa_report.md`).

Two P1 trust bugs fed into this:

  1. Headline fabrication on greeting reply — the model summed onboarding
     scores from the system context (16+7+8+32+38=101) and asserted
     "ты сейчас набрала 101 из 140" before any tool call. Real recent
     attempt was 18/140. Fix: `_USER_DATA_FIDELITY_{RU,KZ}` forbids
     restating user-specific numeric performance without a memory tool
     call this turn.

  2. LaTeX renders as raw `fracab` text — the chat ships react-markdown +
     remark-math + rehype-katex, but the model emits `\\frac{a}{b}` with
     no `$...$` fences, so the markdown layer drops it. Fix:
     `_MATH_RENDERING_{RU,KZ}` directs the model to wrap every
     command-bearing formula in `$...$` (inline) or `$$...$$` (block).

These tests validate the *prompt* (fast, deterministic) rather than the
model output (slow, non-deterministic).
"""

from __future__ import annotations

from app.services.chat.prompts import (
    _MATH_RENDERING_KZ,
    _MATH_RENDERING_RU,
    _USER_DATA_FIDELITY_KZ,
    _USER_DATA_FIDELITY_RU,
    build_chat_system_prompt,
)

# ---------------------------------------------------------------------------
# Math rendering directive
# ---------------------------------------------------------------------------


def test_ru_prompt_contains_math_rendering_block():
    prompt = build_chat_system_prompt("ru")
    assert "МАТЕМАТИКА И ФОРМУЛЫ" in prompt
    # Must teach the dollar-fence convention specifically.
    assert "`$...$`" in prompt
    assert "`$$...$$`" in prompt
    # Must mention at least one canonical LaTeX command in the directive
    # (so the model knows which class of formulas to wrap).
    assert "\\frac" in prompt
    # Must explain the failure mode the user would see, so the rule
    # sticks beyond a "do this" instruction.
    assert "fracab" in prompt


def test_kz_prompt_contains_math_rendering_block():
    prompt = build_chat_system_prompt("kz")
    assert "МАТЕМАТИКА ЖӘНЕ ФОРМУЛАЛАР" in prompt
    assert "`$...$`" in prompt
    assert "`$$...$$`" in prompt
    assert "\\frac" in prompt
    assert "fracab" in prompt


def test_math_block_does_not_cross_languages():
    """The KZ block must not leak into the RU prompt and vice versa —
    same cross-language guard we apply to the other prompt blocks."""
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    assert "МАТЕМАТИКА ЖӘНЕ ФОРМУЛАЛАР" not in ru
    assert "МАТЕМАТИКА И ФОРМУЛЫ" not in kz


def test_math_block_appears_exactly_once_per_language():
    """Drift guard — adding the block twice on a future merge would
    bloat the prompt without changing behaviour and would mask later
    edits."""
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    assert ru.count("МАТЕМАТИКА И ФОРМУЛЫ") == 1
    assert kz.count("МАТЕМАТИКА ЖӘНЕ ФОРМУЛАЛАР") == 1


def test_math_block_does_not_force_dollars_on_plain_ascii():
    """We deliberately do NOT want the model fencing every `F = m * a`
    or `x^2 + 2x - 3 = 0` — that would produce ugly italicised math
    blocks for trivially readable formulas. Make sure the block carves
    out the simple-ASCII case."""
    assert "F = m * a" in _MATH_RENDERING_RU
    assert "F = m * a" in _MATH_RENDERING_KZ


# ---------------------------------------------------------------------------
# User-data fidelity directive
# ---------------------------------------------------------------------------


def test_ru_prompt_forbids_unverified_score_claims():
    prompt = build_chat_system_prompt("ru")
    assert "ДАННЫЕ ПОЛЬЗОВАТЕЛЯ" in prompt
    # The names of the memory tools are the load-bearing part — if
    # someone renames the tool we want this test to fail loudly so the
    # prompt is updated in lockstep.
    assert "get_recent_test_attempts" in prompt
    assert "get_user_profile" in prompt
    # Must call out that the profile-block numbers in the system
    # context are NOT a fresh attempt result.
    assert "ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ" in _USER_DATA_FIDELITY_RU


def test_kz_prompt_forbids_unverified_score_claims():
    prompt = build_chat_system_prompt("kz")
    assert "ПАЙДАЛАНУШЫ ДЕРЕКТЕРІ" in prompt
    assert "get_recent_test_attempts" in prompt
    assert "get_user_profile" in prompt
    assert "ПАЙДАЛАНУШЫ ПРОФИЛІ" in _USER_DATA_FIDELITY_KZ


def test_fidelity_block_appears_before_data_year_block_ru():
    """Ordering: fidelity goes near the top of the rules so the model
    sees 'don't fabricate' before it sees the looser data-year section.
    `_DATA_YEAR_RU` talks about reporting numbers — the fidelity block
    is the gate it has to pass first."""
    prompt = build_chat_system_prompt("ru")
    fidelity = prompt.find("ДАННЫЕ ПОЛЬЗОВАТЕЛЯ")
    data_year = prompt.find("ГОД ДАННЫХ")
    assert fidelity != -1
    assert data_year != -1
    assert fidelity < data_year


def test_fidelity_block_appears_before_data_year_block_kz():
    prompt = build_chat_system_prompt("kz")
    fidelity = prompt.find("ПАЙДАЛАНУШЫ ДЕРЕКТЕРІ")
    data_year = prompt.find("ДЕРЕКТЕР ЖЫЛЫ")
    assert fidelity != -1
    assert data_year != -1
    assert fidelity < data_year


def test_fidelity_block_does_not_cross_languages():
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    assert "ПАЙДАЛАНУШЫ ДЕРЕКТЕРІ" not in ru
    assert "ДАННЫЕ ПОЛЬЗОВАТЕЛЯ" not in kz


def test_fidelity_block_appears_exactly_once_per_language():
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    assert ru.count("ДАННЫЕ ПОЛЬЗОВАТЕЛЯ") == 1
    assert kz.count("ПАЙДАЛАНУШЫ ДЕРЕКТЕРІ") == 1


def test_existing_mcq_and_library_blocks_still_present():
    """Smoke check: adding two new blocks must not have displaced the
    earlier P1 prompt sections. If this regresses, the new prompt is
    landing in production missing core directives."""
    ru = build_chat_system_prompt("ru")
    kz = build_chat_system_prompt("kz")
    assert "АКАДЕМИЧЕСКИЕ ВОПРОСЫ" in ru
    assert "МНОГОВАРИАНТНЫЕ ВОПРОСЫ" in ru
    assert "АКАДЕМИЯЛЫҚ СҰРАҚТАР" in kz
    assert "КӨПВАРИАНТТЫ СҰРАҚТАР" in kz
