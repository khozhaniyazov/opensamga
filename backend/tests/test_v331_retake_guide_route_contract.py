"""v3.31 — Retake Guide route language-param contract pin (no DB).

v3.28 shipped a silent FE/BE mismatch: the FE sent `?lang=kz` but
the BE handler at `app/routers/strategy.py:get_retake_guide` declares
the param under the name `language`, so KZ users got the RU default.

These tests pin the BE route shape — they boot the FastAPI app via
TestClient and call the real querystring path. The testing.kz fetch
is mocked to return None so we never hit the network.

If the FE drifts back to `lang=` (or the BE renames `language`),
v3.31's `buildRetakeGuideQuery` vitest cases catch the FE side and
this file catches the BE side.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services import retake_guide


@pytest.fixture(autouse=True)
def _reset_module_cache():
    retake_guide.clear_cache_for_tests()
    yield
    retake_guide.clear_cache_for_tests()


@pytest.fixture
def _mock_no_network():
    """Force the curated fallback path so testing.kz is never touched."""
    with patch.object(
        retake_guide,
        "fetch_testing_kz_sessions",
        AsyncMock(return_value=None),
    ):
        yield


@pytest.mark.asyncio
async def test_route_accepts_language_param_returns_kz(_mock_no_network):
    """`?language=kz` → payload.language == 'kz' with KZ string table."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/strategy/retake-guide?language=kz&weeks_until_session=8")
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "kz"
    # KZ title from the inline string table.
    assert body["strings"]["title"] == "ҰБТ-ны қайта тапсыру нұсқаулығы"


@pytest.mark.asyncio
async def test_route_accepts_language_param_returns_ru(_mock_no_network):
    """`?language=ru` → payload.language == 'ru' (explicit)."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/strategy/retake-guide?language=ru&weeks_until_session=8")
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "ru"
    assert body["strings"]["title"] == "Гид по пересдаче ЕНТ"


@pytest.mark.asyncio
async def test_route_default_when_no_language_is_ru(_mock_no_network):
    """No language param → BE default 'ru'."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/strategy/retake-guide")
    assert resp.status_code == 200
    assert resp.json()["language"] == "ru"


@pytest.mark.asyncio
async def test_route_ignores_unknown_lang_alias(_mock_no_network):
    """If a stale FE sent `?lang=kz` (without `language=`), the BE
    falls back to its `language` default (RU). This is the bug v3.28
    actually shipped; we pin it here so a future FE/BE rename can't
    silently re-introduce the mismatch by accident."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/api/strategy/retake-guide?lang=kz&weeks_until_session=8")
    assert resp.status_code == 200
    # Default `language=ru` wins because `lang` is not bound.
    assert resp.json()["language"] == "ru"


@pytest.mark.asyncio
async def test_route_passes_current_score_through(_mock_no_network):
    """`current_score` round-trips into the estimator block."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get(
        "/api/strategy/retake-guide?language=kz&weeks_until_session=4&current_score=95"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estimator"]["current_score"] == 95
    assert body["estimator"]["weeks_until_session"] == 4
