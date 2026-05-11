from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import HistoricalGrantThreshold, StudentProfile, UniversityData, UniversityDetail
from app.services import gap_analyzer


def _scalar_one_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


@pytest.mark.asyncio
async def test_get_user_target_threshold_requires_target_major():
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(
                StudentProfile(
                    user_id=501,
                    target_university_id=91,
                    target_majors=[],
                )
            ),
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
        ]
    )

    result = await gap_analyzer.get_user_target_threshold(501, db)

    assert result == {
        "university_name": "Astana IT University",
        "grant_threshold": None,
        "source": "not_found",
        "major_codes": [],
        "quota_type": "GENERAL",
        "data_year": None,
    }


@pytest.mark.asyncio
async def test_get_user_target_threshold_falls_back_to_university_data_when_history_missing(
    monkeypatch,
):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(
                StudentProfile(
                    user_id=777,
                    target_university_id=91,
                    target_majors=["Computer Science"],
                )
            ),
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalar_one_result(None),
            _scalar_one_result(
                UniversityData(
                    uni_name="Astana IT University",
                    major_code="B057",
                    grant_threshold_general=120,
                )
            ),
        ]
    )
    monkeypatch.setattr(
        gap_analyzer,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    result = await gap_analyzer.get_user_target_threshold(777, db)

    assert result == {
        "university_name": "Astana IT University",
        "grant_threshold": 120,
        "source": "university_data",
        "major_codes": ["B057"],
        "quota_type": "GENERAL",
        "data_year": None,
    }
    gap_analyzer.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_user_target_threshold_prefers_latest_historical_threshold(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(
                StudentProfile(
                    user_id=778,
                    target_university_id=91,
                    target_majors=["Computer Science"],
                )
            ),
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalar_one_result(
                HistoricalGrantThreshold(
                    uni_name="Astana IT University",
                    major_code="B057",
                    min_score=50,
                    quota_type="GENERAL",
                    data_year=2025,
                )
            ),
        ]
    )
    monkeypatch.setattr(
        gap_analyzer,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    result = await gap_analyzer.get_user_target_threshold(778, db)

    assert result == {
        "university_name": "Astana IT University",
        "grant_threshold": 50,
        "source": "historical",
        "major_codes": ["B057"],
        "quota_type": "GENERAL",
        "data_year": 2025,
    }
    gap_analyzer.resolve_major_codes.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_user_target_threshold_reports_unresolved_major_mapping(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(
                StudentProfile(
                    user_id=888,
                    target_university_id=91,
                    target_majors=["mystery major"],
                )
            ),
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
        ]
    )
    monkeypatch.setattr(
        gap_analyzer,
        "resolve_major_codes",
        AsyncMock(return_value=[]),
    )

    result = await gap_analyzer.get_user_target_threshold(888, db)

    assert result == {
        "university_name": "Astana IT University",
        "grant_threshold": None,
        "source": "major_not_resolved",
        "major_codes": [],
        "quota_type": "GENERAL",
        "data_year": None,
    }


@pytest.mark.asyncio
async def test_get_user_target_threshold_respects_rural_quota(monkeypatch):
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _scalar_one_result(
                StudentProfile(
                    user_id=990,
                    target_university_id=91,
                    target_majors=["B057"],
                )
            ),
            _scalar_one_result(UniversityDetail(full_name="Astana IT University")),
            _scalar_one_result(None),
            _scalar_one_result(
                UniversityData(
                    uni_name="Astana IT University",
                    major_code="B057",
                    grant_threshold_general=120,
                    grant_threshold_rural=114,
                )
            ),
        ]
    )
    monkeypatch.setattr(
        gap_analyzer,
        "resolve_major_codes",
        AsyncMock(return_value=["B057"]),
    )

    result = await gap_analyzer.get_user_target_threshold(990, db, quota_type="RURAL")

    assert result == {
        "university_name": "Astana IT University",
        "grant_threshold": 114,
        "source": "university_data",
        "major_codes": ["B057"],
        "quota_type": "RURAL",
        "data_year": None,
    }
