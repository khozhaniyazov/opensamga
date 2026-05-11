"""v3.29 — UniversitiesPage major-code deep-link filter (no DB).

The endpoint behavior is exercised by patching
``app.routers.data.load_university_catalog`` to return a hand-built
catalog. We do NOT spin up FastAPI's TestClient — the route is
declared async and we just invoke the handler directly with a
None-shaped ``db`` dependency, since we've stubbed the catalog loader.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.routers import data as data_router
from app.services.university_catalog import UniversityCatalog


def _make_summary(uni_id: int, label: str) -> dict:
    return {
        "id": uni_id,
        "label": label,
        "value": str(uni_id),
        "city": "Almaty",
        "university_code": f"U{uni_id}",
        "search_keywords": "",
        "total_students": 1000,
        "majors_count": 1,
        "median_grant_threshold": 100,
        "max_grant_threshold": 120,
        "popularity_score": 50,
        "popularity_rank": uni_id,
        "popularity_tier": "medium",
        "prestige_score": 30,
        "prestige_tier": "regional",
        "prestige_note": None,
        "data_confidence": None,
    }


def _row(major_code: str | None) -> SimpleNamespace:
    return SimpleNamespace(major_code=major_code)


def _build_catalog() -> UniversityCatalog:
    """Three universities; only #1 and #3 have major B057 in their rows."""
    summaries = [
        _make_summary(1, "Alpha University"),
        _make_summary(2, "Bravo Institute"),
        _make_summary(3, "Charlie Polytech"),
    ]
    return UniversityCatalog(
        summaries=summaries,
        summary_by_id={s["id"]: s for s in summaries},
        details_by_id={},
        rows_by_id={
            1: [_row("B057"), _row("B001")],
            2: [_row("B999")],
            3: [_row("b057")],  # case-insensitive intent
        },
        history_by_id={},
    )


@pytest.mark.asyncio
async def test_search_universities_no_filter_returns_all():
    """Baseline: no major_code filter → all 3 unis."""
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out = await data_router.search_universities(query=None, major_code=None, db=None)
    assert sorted(o.id for o in out) == [1, 2, 3]


@pytest.mark.asyncio
async def test_search_universities_major_code_filter_drops_unmatched():
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out = await data_router.search_universities(query=None, major_code="B057", db=None)
    # Only unis 1 and 3 — uni 2 has only B999.
    assert sorted(o.id for o in out) == [1, 3]


@pytest.mark.asyncio
async def test_search_universities_major_code_is_case_insensitive():
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out_upper = await data_router.search_universities(query=None, major_code="B057", db=None)
        out_lower = await data_router.search_universities(query=None, major_code="b057", db=None)
    assert sorted(o.id for o in out_upper) == sorted(o.id for o in out_lower)


@pytest.mark.asyncio
async def test_search_universities_major_code_unknown_returns_empty():
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out = await data_router.search_universities(query=None, major_code="ZZZ-NOPE", db=None)
    assert out == []


@pytest.mark.asyncio
async def test_search_universities_blank_major_code_acts_as_no_filter():
    """An empty / whitespace-only param must not filter anything out."""
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out_empty = await data_router.search_universities(query=None, major_code="", db=None)
        out_ws = await data_router.search_universities(query=None, major_code="   ", db=None)
    assert len(out_empty) == 3
    assert len(out_ws) == 3


@pytest.mark.asyncio
async def test_search_universities_major_code_composes_with_query():
    """major_code narrows to {1, 3}, then query="alpha" drops #3."""
    fake_catalog = _build_catalog()
    with patch.object(
        data_router,
        "load_university_catalog",
        AsyncMock(return_value=fake_catalog),
    ):
        out = await data_router.search_universities(query="alpha", major_code="B057", db=None)
    assert [o.id for o in out] == [1]
