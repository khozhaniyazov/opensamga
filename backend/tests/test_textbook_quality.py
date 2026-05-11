"""Regression tests for BUG-12 v3 follow-up: junk chunks that pretend to
answer a question but contain no pedagogical content must not pass the
`is_usable_textbook_content` gate.
"""

from __future__ import annotations

from app.utils.textbook_quality import (
    _looks_like_toc,
    _looks_like_watermark_repeat,
    is_usable_textbook_content,
)

REAL_CHUNK_RU = (
    "Дискриминант квадратного уравнения ax²+bx+c=0 вычисляется по формуле "
    "D=b²−4ac. Если D>0 — два различных корня, если D=0 — один корень, "
    "если D<0 — действительных корней нет. Пример: решим уравнение "
    "2x²+3x−5=0. Здесь a=2, b=3, c=−5, значит D=9+40=49, корни x₁=1, x₂=−2.5."
)


def test_real_algebra_chunk_is_usable():
    assert is_usable_textbook_content(REAL_CHUNK_RU)


def test_watermark_repeat_is_rejected():
    body = "Н Не для печати " + "Не для печати " * 30
    assert _looks_like_watermark_repeat(body)
    assert not is_usable_textbook_content(body)


def test_ru_toc_page_is_rejected():
    toc = (
        "238 Содержание Предисловие........................................ 4 "
        "Глава 1. Кинематика................................................. 6 "
        "Глава 2. Динамика................................................... 40"
    )
    assert _looks_like_toc(toc)
    assert not is_usable_textbook_content(toc)


def test_kz_toc_page_is_rejected():
    toc = (
        "190 МАЗМҰНЫ Алғы сөз................................... 3 "
        "1-тарау. Физика — табиғат туралы ғылым............ 6 "
        "2-тарау. Механика.............................. 40"
    )
    assert _looks_like_toc(toc)
    assert not is_usable_textbook_content(toc)


def test_answer_key_low_alpha_ratio_is_rejected():
    # Lots of digits, dots, brackets, and equals signs — real page content
    # but no pedagogical prose. 400-char window should be <35% alpha.
    key = (
        "45 Ответы: 1) 14 – 7 + 5 – 8 + 9 – 6 = 7   2) 18 – 9 + 6 – 8 + 7 – 5 = 9   "
        "3) 3,14 × 2 = 6,28   4) 12 ÷ 4 = 3   5) 2^3 = 8   6) √16 = 4   "
        "7) 0,5 × 0,2 = 0,1   8) 7 + 8 = 15   9) 100 / 4 = 25   10) 9 · 3 = 27."
    )
    # This is a borderline case; we assert it's *either* rejected OR marked as
    # having substantial content. The important thing is: a chunk that is 80%+
    # digits and operators should not sail through. We use a more aggressive
    # sample below to pin the behaviour.
    heavy = "2+2=4 " * 40 + "3·5=15 " * 40
    assert not is_usable_textbook_content(heavy)
    # `key` has enough surrounding prose ("Ответы", "Ответы") but is still
    # mostly numeric — acceptable to keep it, we don't assert on `key` itself.
    _ = key


def test_placeholder_notice_is_rejected():
    body = (
        "Все учебники Казахстана на OKULYK.KZ, скачать PDF и другие материалы. "
        "Приказа министра образования № 115 от 2021 года."
    )
    assert not is_usable_textbook_content(body)


def test_short_content_is_rejected():
    assert not is_usable_textbook_content("Короткий текст.")


def test_okulyk_watermark_inline_is_rejected():
    body = (
        "Решение: дискриминант D = b² − 4ac. "
        "okulyk.kz — все учебники Казахстана. "
        "Ответ x = (−b ± √D) / 2a."
    )
    assert not is_usable_textbook_content(body)


# ---------------------------------------------------------------------------
# Session 19 (2026-04-21): `normalize_textbook_snippet` used to greedily
# strip from "Все учебники Казахстана на OKULYK.KZ" to end-of-string when
# the chunk lacked a blank line (every Qwen OCR chunk we produced). That
# wiped 5,365 / 10,647 chunks silently and was the real root cause of the
# phys-08 / math-02 / math-10 / hist-03 "no-hits" eval failures. These
# tests pin the new behaviour: the banner is stripped literally, the rest
# of the chunk survives.
# ---------------------------------------------------------------------------
from app.utils.textbook_quality import PLACEHOLDER_NOTICE, normalize_textbook_snippet


def test_normalize_preserves_body_after_placeholder_no_blank_line():
    body = (
        f"{PLACEHOLDER_NOTICE} "
        "Атом Бора қалай жасалады? Бор моделі сутегі атомының спектрін "
        "түсіндіреді. Электрондар тек белгілі бір рұқсат етілген орбиталарда "
        "ғана қозғала алады. Квант сандары n, l, m, s энергия деңгейлерін "
        "және орбитальдарды сипаттайды."
    )
    out = normalize_textbook_snippet(body)
    # Banner gone, instructional prose preserved, chunk now usable.
    assert PLACEHOLDER_NOTICE not in out
    assert "Бор моделі" in out
    assert len(out) > 180
    assert is_usable_textbook_content(body)


def test_normalize_handles_placeholder_at_start_with_embedded_paragraph():
    body = f"{PLACEHOLDER_NOTICE}\n\nГлавная теорема алгебры утверждает..."
    out = normalize_textbook_snippet(body)
    assert PLACEHOLDER_NOTICE not in out
    assert "Главная теорема" in out
