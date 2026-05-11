from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import MajorGroup, UniversityData
from app.services.chat import tool_executor


def _scalar_result(value):
    result = MagicMock()
    result.scalar = MagicMock(return_value=value)
    return result


def _scalars_first_result(value):
    result = MagicMock()
    scalars = MagicMock()
    scalars.first = MagicMock(return_value=value)
    result.scalars = MagicMock(return_value=scalars)
    return result


def _scalars_all_result(values):
    result = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=values)
    result.scalars = MagicMock(return_value=scalars)
    return result


@pytest.mark.asyncio
async def test_check_grant_chance_resolves_major_name(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalars_first_result(
                UniversityData(
                    uni_name="Astana IT University",
                    major_code="B057",
                    grant_threshold_general=120,
                    grant_threshold_rural=114,
                )
            ),
            _scalar_result(2024),
        ]
    )
    monkeypatch.setattr(
        tool_executor,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )
    monkeypatch.setattr(
        tool_executor,
        "calculate_grant_probability_sync",
        lambda score, quota_type, general, rural: {
            "score": score,
            "quota_type": quota_type,
            "probability": "high",
            "general_threshold": general,
            "rural_threshold": rural,
        },
    )

    raw = await tool_executor.execute_tool(
        "check_grant_chance",
        {
            "uni_name": "Astana IT University",
            "major_code": "Computer Science",
            "score": 115,
            "quota_type": "GENERAL",
        },
        db,
    )

    parsed = json.loads(raw)
    assert parsed["probability"] == "high"
    assert parsed["data_year"] == 2024
    tool_executor.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_check_grant_chance_resolves_university_alias(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalars_first_result(
                UniversityData(
                    uni_name="Kazakh-British Technical University",
                    major_code="B057",
                    grant_threshold_general=110,
                    grant_threshold_rural=110,
                )
            ),
            _scalar_result(2025),
        ]
    )
    monkeypatch.setattr(
        tool_executor,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    raw = await tool_executor.execute_tool(
        "check_grant_chance",
        {
            "uni_name": "KBTU",
            "major_code": "B057",
            "score": 109,
            "quota_type": "GENERAL",
        },
        db,
    )

    parsed = json.loads(raw)
    assert parsed["data_year"] == 2025
    assert "порогу (110)" in parsed["сообщение"]
    tool_executor.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_check_grant_chance_prefers_best_university_match(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalars_all_result(
                [
                    UniversityData(
                        uni_name="Университет «Туран-Астана»",
                        major_code="B057",
                        grant_threshold_general=51,
                        grant_threshold_rural=66,
                    ),
                    UniversityData(
                        uni_name="Международный университет Астана",
                        major_code="B057",
                        grant_threshold_general=81,
                        grant_threshold_rural=80,
                    ),
                    UniversityData(
                        uni_name="Astana IT University",
                        major_code="B057",
                        grant_threshold_general=50,
                        grant_threshold_rural=80,
                    ),
                ]
            ),
            _scalar_result(2025),
        ]
    )
    monkeypatch.setattr(
        tool_executor,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    raw = await tool_executor.execute_tool(
        "check_grant_chance",
        {
            "uni_name": "Astana IT University",
            "major_code": "B057",
            "score": 109,
            "quota_type": "GENERAL",
        },
        db,
    )

    parsed = json.loads(raw)
    assert parsed["data_year"] == 2025
    assert "порога (50)" in parsed["сообщение"]
    tool_executor.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_major_requirements_resolves_human_major_input(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_scalars_first_result(
            MajorGroup(
                group_code="B057",
                group_name="Информационные технологии",
                unt_subjects="Mathematics, Informatics",
            )
        )
    )
    monkeypatch.setattr(
        tool_executor,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    raw = await tool_executor.execute_tool(
        "get_major_requirements",
        {"major_code": "айти"},
        db,
    )

    assert "Информационные технологии (B057)" in raw
    assert "Mathematics, Informatics" in raw
    tool_executor.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_recommend_universities_resolves_major_name(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalars_all_result(
                [
                    UniversityData(
                        uni_name="Astana IT University",
                        major_code="B057",
                        major_name="Информационные технологии",
                        grant_threshold_general=120,
                    )
                ]
            ),
            _scalar_result(2024),
        ]
    )
    monkeypatch.setattr(
        tool_executor,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    raw = await tool_executor.execute_tool(
        "recommend_universities",
        {"score": 123, "quota_type": "GENERAL", "major_code": "Computer Science"},
        db,
    )

    parsed = json.loads(raw)
    assert parsed[0]["uni_name"] == "Astana IT University"
    assert parsed[0]["data_year"] == 2024
    tool_executor.resolve_major_codes.assert_awaited_once()
