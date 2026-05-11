"""Session 22c: tests for GET /api/chat/template-context.

The endpoint returns personalization signals the empty-state uses to rank its
one-click prompt pills:

    - unresolved_mistakes_count (int)
    - weakness_topic_tag (str | None)
    - exam_attempts_count (int)
    - has_library_activity (bool)
    - profile_subjects (list[str])
    - weakest_subject (str | None)
    - last_test_results_count (int)
    - target_university_name (str | None)
    - has_onboarding_profile (bool)

We don't exercise the personalisation ranking itself — that lives in
the FE — we just verify the endpoint's contract and its silent-fail
behaviour, since a 500 here would cause the empty-state to fall back
to the static order (which is acceptable but shouldn't happen under
normal load).

s28 (2026-04-27): refactored away from positional `db.execute` side-effects.
The previous version asserted on a fixed call-count to db.execute, but the
endpoint's helper layer (count_unresolved_mistakes / cluster_mistakes_by_topic)
now performs subquery-wrapped queries plus a no-topic-tag fallback, which
shifted the positional indices and broke every assertion. Instead we patch
those helpers + the two raw SQL counts (exams, activity) at the function
boundary using monkeypatch — that is what we actually care about contractually,
and it is robust against future SQL refactors inside the helpers.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import StudentProfile, UniversityDetail, User


@pytest.fixture
def fake_user():
    return User(id=42, email="tmpl@x.test", name="TemplateOwner")


def _client_with(db, user):
    async def _get_db():
        yield db

    from app.database import get_db
    from app.routers.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = _get_db
    return TestClient(app)


def _cleanup():
    app.dependency_overrides.clear()


def _patch_helpers(
    monkeypatch: pytest.MonkeyPatch,
    *,
    mistakes: int = 0,
    cluster_rows: list[dict] | None = None,
    exams_count: int = 0,
    activity_count: int = 0,
    target_uni: UniversityDetail | None = None,
    helpers_should_raise: bool = False,
) -> None:
    """Replace the five collaborator points the endpoint calls with cheap
    AsyncMocks. This is closer to a real unit test than mocking
    db.execute — we test "given these signals, what does the endpoint
    return" rather than "the endpoint executes N raw queries"."""
    from app.routers import chat as chat_router

    if helpers_should_raise:

        async def _raise(*a, **kw):
            raise RuntimeError("simulated helper failure")

        monkeypatch.setattr(chat_router, "count_unresolved_mistakes", _raise)
        monkeypatch.setattr(chat_router, "cluster_mistakes_by_topic", _raise)
    else:

        async def _count(*a, **kw):
            return mistakes

        async def _cluster(*a, **kw):
            return list(cluster_rows or [])

        monkeypatch.setattr(chat_router, "count_unresolved_mistakes", _count)
        monkeypatch.setattr(chat_router, "cluster_mistakes_by_topic", _cluster)


def _make_db(
    *,
    exams_count: int = 0,
    activity_count: int = 0,
    target_uni: UniversityDetail | None = None,
    raise_on_execute: bool = False,
) -> AsyncMock:
    """Build a tiny AsyncMock DB whose only contract is responding to
    .execute() for: exams count, activity count, optional university
    lookup. Order matters because the endpoint runs them in a fixed
    sequence — but helper queries (mistakes/cluster) are patched out
    via monkeypatch so we only have 2-3 execute calls to model."""

    db = AsyncMock()

    if raise_on_execute:
        db.execute = AsyncMock(side_effect=RuntimeError("db down"))
        return db

    side_effects: list[AsyncMock] = []

    exams_result = AsyncMock()
    exams_result.scalar = lambda: exams_count
    side_effects.append(exams_result)

    activity_result = AsyncMock()
    activity_result.scalar = lambda: activity_count
    side_effects.append(activity_result)

    if target_uni is not None:
        uni_result = AsyncMock()
        uni_result.scalar_one_or_none = lambda: target_uni
        side_effects.append(uni_result)

    db.execute = AsyncMock(side_effect=side_effects)
    return db


# ---------------------------------------------------------------------------
# Contract tests
# ---------------------------------------------------------------------------


def test_template_context_shape_empty_user(fake_user, monkeypatch):
    """Fresh user: all counts zero, weakness None, no library activity."""
    _patch_helpers(monkeypatch, mistakes=0, cluster_rows=[])
    db = _make_db(exams_count=0, activity_count=0)

    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/template-context")
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "unresolved_mistakes_count": 0,
        "exam_attempts_count": 0,
        "weakness_topic_tag": None,
        "has_library_activity": False,
        "profile_subjects": [],
        "weakest_subject": None,
        "last_test_results_count": 0,
        "target_university_name": None,
        "has_onboarding_profile": False,
    }


def test_template_context_returns_counts_and_topic(fake_user, monkeypatch):
    """Non-zero counts + weakness topic surface in the response."""
    _patch_helpers(
        monkeypatch,
        mistakes=7,
        cluster_rows=[{"topic": "quadratic_equations", "points_lost": 5, "mistake_count": 5}],
    )
    db = _make_db(exams_count=3, activity_count=12)

    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/template-context")
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    assert body["unresolved_mistakes_count"] == 7
    assert body["exam_attempts_count"] == 3
    assert body["weakness_topic_tag"] == "quadratic_equations"
    assert body["has_library_activity"] is True
    # No profile attached, so onboarding-derived fields stay falsy.
    assert body["profile_subjects"] == []
    assert body["weakest_subject"] is None
    assert body["last_test_results_count"] == 0
    assert body["target_university_name"] is None
    assert body["has_onboarding_profile"] is False


def test_template_context_silent_fail_on_db_errors(fake_user, monkeypatch):
    """If a sub-query raises, the endpoint still returns 200 with a
    safe default for that slot. The FE has a static fallback so the
    UX is acceptable even if every probe errors."""
    _patch_helpers(monkeypatch, helpers_should_raise=True)
    db = _make_db(raise_on_execute=True)

    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/template-context")
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "unresolved_mistakes_count": 0,
        "exam_attempts_count": 0,
        "weakness_topic_tag": None,
        "has_library_activity": False,
        "profile_subjects": [],
        "weakest_subject": None,
        "last_test_results_count": 0,
        "target_university_name": None,
        "has_onboarding_profile": False,
    }


def test_template_context_ignores_null_topic_tag(fake_user, monkeypatch):
    """If the top weakness row has a null topic, we report None
    rather than the string "None"."""
    _patch_helpers(
        monkeypatch,
        mistakes=2,
        cluster_rows=[{"topic": None, "points_lost": 2, "mistake_count": 2}],
    )
    db = _make_db(exams_count=0, activity_count=0)

    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/template-context")
    finally:
        _cleanup()

    assert r.status_code == 200
    assert r.json()["weakness_topic_tag"] is None


def test_template_context_includes_onboarding_profile_signals(fake_user, monkeypatch):
    """Newly onboarded users should get personalized chat templates
    before they have any mistake or mock-exam history."""
    # s26 phase 7 (2026-04-26): is_onboarding_completed now also
    # requires target_majors[0] and competition_quota so the chat
    # agent has full context for grant questions. Profiles without
    # them are treated as incomplete onboarding.
    fake_user.profile = StudentProfile(
        user_id=fake_user.id,
        chosen_subjects=["Mathematics", "Informatics"],
        target_university_id=17,
        target_majors=["B057"],
        competition_quota="GENERAL",
        last_test_results={
            "History of Kazakhstan": [18],
            "Mathematical Literacy": [9],
            "Reading Literacy": [8],
            "Mathematics": [50],
            "Informatics": [45],
        },
        weakest_subject="Informatics",
    )

    _patch_helpers(monkeypatch, mistakes=0, cluster_rows=[])
    db = _make_db(
        exams_count=0,
        activity_count=0,
        target_uni=UniversityDetail(full_name="Astana IT University"),
    )

    c = _client_with(db, fake_user)
    try:
        r = c.get("/api/chat/template-context")
    finally:
        _cleanup()

    assert r.status_code == 200
    body = r.json()
    assert body["profile_subjects"] == ["Mathematics", "Informatics"]
    assert body["weakest_subject"] == "Informatics"
    assert body["weakness_topic_tag"] is None
    assert body["last_test_results_count"] == 5
    assert body["target_university_name"] == "Astana IT University"
    assert body["has_onboarding_profile"] is True
