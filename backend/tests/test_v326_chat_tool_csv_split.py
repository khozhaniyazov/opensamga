"""
test_v326_chat_tool_csv_split.py
--------------------------------

Regression: the chat tool ``get_majors_by_subjects`` previously matched
``MajorGroup.unt_subjects`` via ``ILIKE %subject%``, which collides
"Mathematics" with "Mathematical Literacy". v3.26 ports it to the
v3.25 CSV-split exact-match helpers.

These are no-DB tests using AsyncMock for the SQLAlchemy session — the
v3.25 service is unit-tested in test_v325_profile_pair_simulator.py;
here we only pin the chat-path glue.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import MajorGroup
from app.services.chat import tool_executor


def _scalars_all_result(values):
    """Mock the ``(await db.execute(...)).scalars().all()`` shape."""
    result = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=values)
    result.scalars = MagicMock(return_value=scalars)
    return result


def _make_major(code: str, name: str, csv: str) -> MajorGroup:
    """Construct a MajorGroup row with just the fields we care about."""
    return MajorGroup(group_code=code, group_name=name, unt_subjects=csv)


@pytest.mark.asyncio
async def test_get_majors_by_subjects_does_not_substring_collide():
    """Mathematics must NOT match a row whose csv is Math-Literacy + Reading.

    This is the canonical v3.26 regression: pre-v3.26 ILIKE returned the
    Math-Literacy row for ``subject1=Mathematics``.
    """

    rows = [
        _make_major("B057", "Computer Science", "Mathematics,Informatics"),
        _make_major(
            "M001",
            "Translation Studies",
            "Mathematical Literacy,Reading Literacy,Foreign Language",
        ),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result(rows))

    raw = await tool_executor.execute_tool(
        "get_majors_by_subjects",
        {"subject1": "Mathematics", "subject2": "Informatics"},
        db,
    )

    parsed = json.loads(raw)
    assert isinstance(parsed, list)
    assert len(parsed) == 1
    assert parsed[0]["code"] == "B057"
    # And explicitly: the Math-Literacy row was excluded.
    assert all(p["code"] != "M001" for p in parsed)


@pytest.mark.asyncio
async def test_get_majors_by_subjects_requires_both_subjects_present():
    """A row with only subject1 must not match — both must appear."""

    rows = [
        _make_major("X001", "Solo Math", "Mathematics,Geography"),
        _make_major("X002", "Solo Physics", "Physics,Chemistry"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result(rows))

    raw = await tool_executor.execute_tool(
        "get_majors_by_subjects",
        {"subject1": "Mathematics", "subject2": "Physics"},
        db,
    )

    # Neither row contains BOTH Mathematics and Physics.
    assert raw == "Специальности по данным предметам не найдены."


@pytest.mark.asyncio
async def test_get_majors_by_subjects_normalizes_ru_kz_aliases():
    """RU/KZ subject aliases must hit the same canonical match path."""

    rows = [
        _make_major("B057", "Computer Science", "Mathematics,Informatics"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result(rows))

    # "Математика" should normalize to canonical "Mathematics".
    raw = await tool_executor.execute_tool(
        "get_majors_by_subjects",
        {"subject1": "Математика", "subject2": "Informatics"},
        db,
    )
    parsed = json.loads(raw)
    assert len(parsed) == 1
    assert parsed[0]["code"] == "B057"


@pytest.mark.asyncio
async def test_get_majors_by_subjects_requires_both_args():
    """Missing arg → friendly error, no DB hit."""

    db = AsyncMock()
    db.execute = AsyncMock()

    raw = await tool_executor.execute_tool(
        "get_majors_by_subjects",
        {"subject1": "Mathematics"},
        db,
    )
    assert raw == "Указаны не все предметы."
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_get_majors_by_subjects_handles_csv_whitespace():
    """Real DB rows have spaces after commas — exact-match must still hit."""

    rows = [
        _make_major("B057", "Computer Science", "Mathematics, Informatics, Geography"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars_all_result(rows))

    raw = await tool_executor.execute_tool(
        "get_majors_by_subjects",
        {"subject1": "Mathematics", "subject2": "Geography"},
        db,
    )
    parsed = json.loads(raw)
    assert len(parsed) == 1
    assert parsed[0]["code"] == "B057"
