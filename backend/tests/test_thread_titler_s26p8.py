"""tests for app.services.chat.thread_titler (s26 phase 8).

Pin tests for the auto-rename helper. We exercise the pure functions
(``detect_lang`` / ``_clean_title`` / ``_seed_match``) directly, then
mock the DB + LLM client to drive ``auto_rename_thread_if_first_turn``
through its three skip branches (mid-conversation, manual rename, race
lost) and one happy path.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.chat import thread_titler as tt

# ── pure helpers ────────────────────────────────────────────────────


def test_detect_lang_kz_specific_letter():
    assert tt.detect_lang("Қандай университетке түсуге болады?") == "kz"
    # Cyrillic with no KZ-specific letters → ru
    assert tt.detect_lang("Какие у меня шансы на грант?") == "ru"
    # Pure ASCII → en
    assert tt.detect_lang("What are my grant chances?") == "en"
    # Empty → defaults to ru
    assert tt.detect_lang("") == "ru"


def test_clean_title_strips_quotes_and_punct():
    assert tt._clean_title('"Шансы на грант КБТУ"') == "Шансы на грант КБТУ"
    assert tt._clean_title("«Підготовка до ЕНТ.»") == "Підготовка до ЕНТ"
    assert tt._clean_title("  Multi   spaces!  ") == "Multi spaces"
    assert tt._clean_title("") == ""


def test_clean_title_strips_think_blocks():
    """Reasoning-class models sometimes leak <think>…</think> tags. Drop
    them whether closed or open-ended."""
    # Open-ended <think> with no closing tag and no other content → empty.
    assert tt._clean_title("<think> The user is asking for") == ""
    # Closed <think>…</think> followed by the actual title.
    assert (
        tt._clean_title("<think>some reasoning</think>\n\nGrant chances at KBTU")
        == "Grant chances at KBTU"
    )


def test_clean_title_strips_label_preamble():
    """Models love to preface with 'Title: …' / 'Заголовок: …'."""
    assert tt._clean_title("Title: Grant chances KBTU") == "Grant chances KBTU"
    assert tt._clean_title("Заголовок: Шансы на грант") == "Шансы на грант"
    assert tt._clean_title("Атау: ЕНТ-ге дайындық") == "ЕНТ-ге дайындық"
    assert tt._clean_title("Here's a title: Math improvement plan") == "Math improvement plan"


def test_clean_title_caps_at_80():
    long = "A " * 100
    out = tt._clean_title(long)
    assert len(out) <= 80


def test_seed_match_first_60_chars():
    msg = "x" * 200
    seed = tt._seed_match(msg)
    assert seed == "x" * 60
    assert tt._seed_match("") is None
    assert tt._seed_match(None) is None
    # Trailing whitespace stripped (mirrors FE `.slice(0,60).trim()`).
    assert tt._seed_match("  hi  ") == "hi"


# ── auto_rename_thread_if_first_turn ────────────────────────────────


def _mock_db_for_preflight(user_count: int, current_title):
    """Build an AsyncMock db where the first execute() returns user_count
    and the second returns current_title."""
    db = AsyncMock()

    count_result = MagicMock()
    count_result.scalar_one = MagicMock(return_value=user_count)

    title_result = MagicMock()
    title_result.scalar_one_or_none = MagicMock(return_value=current_title)

    update_result = MagicMock()
    update_result.rowcount = 1

    # Three calls in the happy path: count → title → UPDATE
    db.execute = AsyncMock(side_effect=[count_result, title_result, update_result])
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_skip_when_more_than_one_user_turn():
    """If the thread already has 2+ user messages, this is not the first
    turn, do nothing."""
    db = _mock_db_for_preflight(user_count=2, current_title=None)
    out = await tt.auto_rename_thread_if_first_turn(
        db=db,
        thread_id=42,
        user_id=7,
        user_msg="hi",
        assistant_msg="hello",
    )
    assert out is None
    # Only the count query ran; no UPDATE.
    assert db.execute.await_count == 1


@pytest.mark.asyncio
async def test_skip_when_manual_rename_present():
    """Title doesn't match the FE seed and isn't NULL → user must have
    manually renamed; we leave it alone."""
    db = _mock_db_for_preflight(
        user_count=1,
        current_title="Definitely a manual rename",
    )
    out = await tt.auto_rename_thread_if_first_turn(
        db=db,
        thread_id=42,
        user_id=7,
        user_msg="What are my chances?",
        assistant_msg="…",
    )
    assert out is None
    # count + title only — no UPDATE.
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_happy_path_writes_new_title(monkeypatch):
    user_msg = "Какие у меня шансы на грант КБТУ B057 со 101 баллом?"
    db = _mock_db_for_preflight(user_count=1, current_title=user_msg[:60])

    async def fake_summary(u, a, lang):
        assert lang == "ru"
        assert u.startswith("Какие у меня")
        return "Шансы на грант КБТУ"

    monkeypatch.setattr(tt, "_summarize_title", fake_summary)

    out = await tt.auto_rename_thread_if_first_turn(
        db=db,
        thread_id=42,
        user_id=7,
        user_msg=user_msg,
        assistant_msg="Анализ шансов…",
    )
    assert out == "Шансы на грант КБТУ"
    # 3 db calls: count, title, update
    assert db.execute.await_count == 3
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_skip_when_llm_returns_garbage(monkeypatch):
    """If the summarizer returns None (e.g. wrong word count), we skip."""
    db = _mock_db_for_preflight(user_count=1, current_title=None)

    async def fake_summary(u, a, lang):
        return None

    monkeypatch.setattr(tt, "_summarize_title", fake_summary)

    out = await tt.auto_rename_thread_if_first_turn(
        db=db,
        thread_id=42,
        user_id=7,
        user_msg="hi",
        assistant_msg="hello",
    )
    assert out is None
    # No UPDATE issued (only count + title).
    assert db.execute.await_count == 2


@pytest.mark.asyncio
async def test_race_lost_returns_none(monkeypatch):
    """If the conditional UPDATE matches 0 rows (manual rename slipped in
    between preflight and write), don't pretend we renamed."""
    db = AsyncMock()
    count_result = MagicMock()
    count_result.scalar_one = MagicMock(return_value=1)
    title_result = MagicMock()
    title_result.scalar_one_or_none = MagicMock(return_value=None)
    update_result = MagicMock()
    update_result.rowcount = 0  # ← race lost
    db.execute = AsyncMock(side_effect=[count_result, title_result, update_result])
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    async def fake_summary(u, a, lang):
        return "Some Title"

    monkeypatch.setattr(tt, "_summarize_title", fake_summary)

    out = await tt.auto_rename_thread_if_first_turn(
        db=db,
        thread_id=42,
        user_id=7,
        user_msg="x",
        assistant_msg="y",
    )
    assert out is None


@pytest.mark.asyncio
async def test_summarize_title_word_count_filter(monkeypatch):
    """The post-LLM filter rejects 1-word and 9+-word replies."""
    fake_resp = MagicMock()
    fake_resp.choices = [MagicMock()]
    # 1-word → reject
    fake_resp.choices[0].message.content = "Title"

    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)

    monkeypatch.setattr(tt, "AsyncOpenAI", lambda **kw: fake_client)
    monkeypatch.setenv("OPENAI_API_KEY", "x")

    out = await tt._summarize_title("hi", "hello", "en")
    assert out is None

    # 9 words → clip to first 6
    fake_resp.choices[0].message.content = "one two three four five six seven eight nine"
    out = await tt._summarize_title("hi", "hello", "en")
    assert out == "one two three four five six"

    # Sentence with punctuation → take first clause (≤6 words)
    fake_resp.choices[0].message.content = "Шансы на грант КБТУ: анализ на основе ваших баллов"
    out = await tt._summarize_title("hi", "hello", "en")
    assert out == "Шансы на грант КБТУ"

    # 3 words → accept
    fake_resp.choices[0].message.content = "Two Three Words"
    out = await tt._summarize_title("hi", "hello", "en")
    assert out == "Two Three Words"
