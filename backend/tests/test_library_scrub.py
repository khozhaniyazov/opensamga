"""Regression tests for `_strip_not_found_sentences` and
`apply_library_outcome_markers` in `app.routers.chat`.

These tests pin down BUG-11 and its escape-star regression: the scrub must
strip "not found in library" tails in every shape the LLM emits, including
the rare `*(\\*Не найдено в библиотеке — …)*` form where a provider inserts
a literal backslash-star inside the parens. Real evidence of the regression
was captured in
`tmp_scripts/session_2026-04-18/logs/chat2/geo-political-ru.json`.
"""

from __future__ import annotations

from app.routers.chat import (
    _strip_not_found_sentences,
    apply_library_outcome_markers,
)


def test_strip_removes_plain_star_paren_ru():
    content = "Пара абзацев текста.\n\n*(Не найдено в библиотеке)*"
    out = _strip_not_found_sentences(content)
    assert "Не найдено в библиотеке" not in out
    assert out.endswith("текста.")


def test_strip_removes_plain_star_paren_kz():
    content = "Бірнеше абзац мәтін.\n\n*(Кітапханада табылмады)*"
    out = _strip_not_found_sentences(content)
    assert "Кітапханада табылмады" not in out


def test_strip_removes_escaped_star_tail():
    """Real-world regression from geo-political-ru (2026-04-18):

        > *(\\*Не найдено в библиотеке — информация из базового курса географии)*

    The old regex matched only `*(` + literal text; the leading `\\*`
    inside the parens caused the entire tail to survive the scrub.
    """
    content = (
        "Страны, граничащие с Казахстаном: Россия, Китай, Кыргызстан, "
        "Узбекистан, Туркменистан.\n\n"
        r"> *(\*Не найдено в библиотеке — информация из базового курса географии)*"
    )
    out = _strip_not_found_sentences(content)
    assert "Не найдено в библиотеке" not in out
    assert "Туркменистан" in out


def test_strip_removes_tail_with_em_dash_clause():
    content = "Ответ по теме.\n\n*(Не найдено в библиотеке — ответ на основе общих знаний)*"
    out = _strip_not_found_sentences(content)
    assert "Не найдено в библиотеке" not in out
    assert "общих знаний" not in out


def test_strip_is_noop_when_nothing_to_remove():
    content = "📚 *Источник: Математика - Алгебра 8 (Grade 8), Page 52*\n\nДискриминант — это…"
    assert _strip_not_found_sentences(content) == content.strip()


def test_apply_library_outcome_markers_drops_contradiction_when_citation_present():
    """If the response already contains a trusted citation marker, any
    trailing "not found" sentence must be scrubbed so the user does not see
    two contradicting claims."""
    content = (
        "📚 *Источник: История Казахстана - История Казахстана 8 (Grade 8), Page 110*\n\n"
        "Казахстан граничит с пятью странами.\n\n"
        r"> *(\*Не найдено в библиотеке — информация из базового курса географии)*"
    )
    out = apply_library_outcome_markers(content, language="ru", citation=None)
    assert "Не найдено в библиотеке" not in out
    assert "Казахстан граничит" in out
    assert "Источник:" in out


def test_apply_library_outcome_markers_prepends_citation_when_trusted():
    content = "Ответ без явной цитаты."
    out = apply_library_outcome_markers(
        content,
        language="ru",
        citation="Mathematics - Algebra 8 (Grade 8), Page 52",
    )
    assert out.startswith("📚 *Источник: Mathematics - Algebra 8 (Grade 8), Page 52*")
    assert "Ответ без явной цитаты" in out


def test_apply_library_outcome_markers_adds_kz_missing_marker_on_no_results():
    content = "Жауап жалпы біліммен құрастырылды."
    out = apply_library_outcome_markers(content, language="kz", citation=None, no_results=True)
    assert "*(Кітапханада табылмады)*" in out


def test_strip_removes_kz_bare_paren_in_citation_line():
    """BUG-11 v3 follow-up: model places (Кітапханада табылмады) inline inside
    the *Дереккөз: …* span. The scrub must remove the parenthetical but keep
    the citation label intact."""
    content = "📚 *Дереккөз: математика оқулығы (Кітапханада табылмады)*\n\nЖауап..."
    out = _strip_not_found_sentences(content)
    assert "Кітапханада табылмады" not in out
    assert "📚 *Дереккөз: математика оқулығы*" in out
    assert "Жауап..." in out


def test_strip_removes_ru_bare_paren_in_citation_line():
    content = "📚 *Источник: Алгебра 8 (Не найдено в библиотеке)*\n\nРешение..."
    out = _strip_not_found_sentences(content)
    assert "Не найдено в библиотеке" not in out
    assert "📚 *Источник: Алгебра 8*" in out


def test_strip_removes_spurious_second_header_kz():
    content = "📚 *Дереккөз: Физика 9, стр. 12*\n\nЖауап\n\n📚 *Кітапханада табылмады*"
    out = apply_library_outcome_markers(content, language="kz", citation=None, no_results=False)
    # The second spurious 📚 header should be gone; the real citation survives.
    assert out.count("📚") == 1
    assert "Кітапханада табылмады" not in out
    assert "Физика 9" in out


def test_strip_preserves_answer_after_kz_apology():
    """Regression: KZ apology preambles must be scrubbed without eating the
    real answer that follows on the same sentence."""
    content = (
        "Кешіріңіз, бұл тақырыпты кітапханада таба алмадым. "
        "Дегенмен, физика бойынша жауап беремін: g = 9.8 м/с²."
    )
    out = _strip_not_found_sentences(content)
    assert "Кешіріңіз" not in out
    assert "таба алма" not in out
    assert "физика бойынша жауап" in out
    assert "9.8" in out


def test_strip_preserves_answer_after_kz_self_narrated_miss():
    content = (
        "Кітапханада бұл тақырып табылмады, бірақ меншікті біліміммен "
        "түсіндіремін:\n\nКвадраттық теңдеу — ах²+bx+c=0."
    )
    out = _strip_not_found_sentences(content)
    assert "табылмады" not in out
    assert "Квадраттық теңдеу" in out


# ---------------------------------------------------------------------------
# Phase A (s20c): book_id + page_number hint via HTML comment.
#
# Goal: when the backend knows the exact top-hit textbook that served this
# turn, embed a structured marker the FE can prefer over its fuzzy resolver,
# eliminating mis-attribution between editions that share words (e.g.
# "Algebra 10" vs "Algebra 11").
# ---------------------------------------------------------------------------


def test_apply_library_outcome_markers_embeds_book_id_hint_when_trusted():
    content = "Казахское ханство было образовано в 1465 году."
    out = apply_library_outcome_markers(
        content,
        language="ru",
        citation="История Казахстана (Grade 10), Page 142",
        book_id=21,
        page_number=142,
    )
    # Structured hint must be present, on its own line, before the prose
    # citation marker so Markdown rendering treats it as a comment.
    assert "<!-- samga-citation book_id=21 page=142 -->" in out
    assert "📚 *Источник: История Казахстана" in out
    assert "1465" in out


def test_apply_library_outcome_markers_embeds_hint_without_inline_citation():
    content = "📚 *Источник: Алгебра 8 (Grade 8), Page 52*\n\nДискриминант…"
    out = apply_library_outcome_markers(
        content,
        language="ru",
        citation="Алгебра 8 (Grade 8), Page 52",
        book_id=5,
        page_number=52,
    )
    # Already-present marker path: no second citation, single hint.
    assert out.count("📚") == 1
    assert "<!-- samga-citation book_id=5 page=52 -->" in out


def test_apply_library_outcome_markers_omits_hint_when_no_book_id():
    content = "Ответ без резолвинга."
    out = apply_library_outcome_markers(
        content,
        language="ru",
        citation="Mathematics - Algebra 8 (Grade 8), Page 52",
    )
    # Legacy call signature must still work and must NOT emit a stray
    # "book_id=None" token.
    assert "samga-citation" not in out
    assert "book_id" not in out
    assert "📚 *Источник: Mathematics" in out


def test_apply_library_outcome_markers_hint_requires_both_fields():
    """Defensive: if only one of book_id / page_number is known, don't
    emit a half-formed hint the FE parser might misread."""
    out1 = apply_library_outcome_markers(
        "Прозаичный ответ.",
        language="ru",
        citation="Ист. Каз.",
        book_id=21,
        page_number=None,
    )
    assert "samga-citation" not in out1

    out2 = apply_library_outcome_markers(
        "Прозаичный ответ.",
        language="ru",
        citation="Ист. Каз.",
        book_id=None,
        page_number=142,
    )
    assert "samga-citation" not in out2
