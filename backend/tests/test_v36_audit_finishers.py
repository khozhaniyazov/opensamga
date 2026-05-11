"""
Tests for v3.6 audit finishers (2026-04-29).

Three findings closed:

  - #2  Ingest endpoint embedding-dim mismatch:
        `routers/data.py:get_embedding` previously hardcoded
        `text-embedding-3-small` (1536-dim), but the DB column
        `mock_questions.question_embedding` is `vector(1024)` (DashScope
        `text-embedding-v4`, since session 23c). Now delegates to
        `services.vector_search.get_embedding`.

  - #7  `/api/billing/webhook` open handler. Was returning
        `{"status": "ok"}` for any payload, no auth. Now requires
        an HMAC-SHA256 signature in `X-Signature`; returns 503 when
        no provider is wired up (`BILLING_WEBHOOK_SECRET` empty).

  - #9  Library upload janitor for `LibraryUploadJob` rows stuck in
        `PROCESSING_*`. New
        `services/library_upload_janitor.py:mark_stuck_uploads_failed`,
        wired into the lifespan startup branch.

Pure-python tests — no live DB. The janitor exercises an in-memory
SQLite backend through the existing async session machinery is
out-of-scope here; we test the source-shape contract instead, the
way `test_v33_security_hardening.py` tests source contracts.
"""

from __future__ import annotations

import hashlib
import hmac
import inspect
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# Finding #2 — embedding-dim mismatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_data_get_embedding_delegates_to_canonical_path():
    """`routers/data.py:get_embedding` must NOT mint embeddings via
    a hardcoded model — it must funnel through
    `services.vector_search.get_embedding`, which routes to the
    DashScope (1024-dim) provider that matches the DB column."""
    from app.routers import data as data_mod

    # Patch the canonical provider and verify our wrapper calls it.
    fake = AsyncMock(return_value=[0.0] * 1024)
    with patch("app.services.vector_search.get_embedding", fake):
        out = await data_mod.get_embedding("hello world")

    fake.assert_awaited_once_with("hello world")
    assert len(out) == 1024


def test_data_get_embedding_no_longer_calls_openai_directly():
    """Source-introspection guard: `routers/data.py:get_embedding`
    must not contain a direct `client.embeddings.create(...)` call —
    that path goes through the local `client` (OpenAI, 1536-dim) and
    causes the dim mismatch. The canonical path delegates to
    `services.vector_search.get_embedding`."""
    from app.routers import data as data_mod

    src = inspect.getsource(data_mod.get_embedding)
    assert "client.embeddings.create" not in src, (
        "data.get_embedding must not call client.embeddings.create directly; "
        "delegate to services.vector_search.get_embedding instead. "
        "Audit finding #2 (v3.6)."
    )


# ---------------------------------------------------------------------------
# Finding #7 — billing webhook signature gate
# ---------------------------------------------------------------------------


def _billing_app():
    """Build a *minimal* FastAPI app that mounts only the billing
    router. Avoids the production lifespan (which tries to talk to
    Postgres / Redis) so the webhook tests stay pure-python."""
    from fastapi import FastAPI

    from app.routers import billing as billing_mod

    app = FastAPI()
    # The router already carries `prefix="/billing"`, so we mount
    # it under `/api` to match the production path
    # `/api/billing/webhook`.
    app.include_router(billing_mod.router, prefix="/api")
    return app


def test_billing_webhook_returns_503_when_secret_unset():
    """Without `BILLING_WEBHOOK_SECRET`, the endpoint must refuse
    the request entirely. Returning 200 OK by default is what
    landed us this audit finding."""
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from app.config import settings

    original = settings.BILLING_WEBHOOK_SECRET
    try:
        settings.BILLING_WEBHOOK_SECRET = SecretStr("")
        client = TestClient(_billing_app())
        r = client.post("/api/billing/webhook", content=b"{}")
        assert r.status_code == 503, (
            f"Webhook with no secret should return 503, got {r.status_code}: {r.text}"
        )
    finally:
        settings.BILLING_WEBHOOK_SECRET = original


def test_billing_webhook_rejects_missing_signature():
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from app.config import settings

    original = settings.BILLING_WEBHOOK_SECRET
    try:
        settings.BILLING_WEBHOOK_SECRET = SecretStr("topsecret")
        client = TestClient(_billing_app())
        r = client.post("/api/billing/webhook", content=b'{"event":"test"}')
        assert r.status_code == 401
        assert "X-Signature" in r.text
    finally:
        settings.BILLING_WEBHOOK_SECRET = original


def test_billing_webhook_rejects_wrong_signature():
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from app.config import settings

    original = settings.BILLING_WEBHOOK_SECRET
    try:
        settings.BILLING_WEBHOOK_SECRET = SecretStr("topsecret")
        client = TestClient(_billing_app())
        r = client.post(
            "/api/billing/webhook",
            content=b'{"event":"test"}',
            headers={"X-Signature": "deadbeef" * 8},
        )
        assert r.status_code == 401
    finally:
        settings.BILLING_WEBHOOK_SECRET = original


def test_billing_webhook_accepts_correct_signature():
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from app.config import settings

    secret = "topsecret"
    body = b'{"event":"payment.confirmed","amount":1990}'
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    original = settings.BILLING_WEBHOOK_SECRET
    try:
        settings.BILLING_WEBHOOK_SECRET = SecretStr(secret)
        client = TestClient(_billing_app())
        r = client.post(
            "/api/billing/webhook",
            content=body,
            headers={"X-Signature": sig},
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "ok"}
    finally:
        settings.BILLING_WEBHOOK_SECRET = original


def test_billing_webhook_uses_constant_time_compare():
    """The implementation must use `hmac.compare_digest`. A naive
    `==` would leak signature byte-by-byte via timing."""
    from app.routers import billing

    src = inspect.getsource(billing.billing_webhook)
    assert "hmac.compare_digest" in src, (
        "billing_webhook must use hmac.compare_digest for signature "
        "comparison. Audit finding #7 (v3.6)."
    )


# ---------------------------------------------------------------------------
# Finding #9 — library upload janitor
# ---------------------------------------------------------------------------


def test_library_upload_janitor_module_exists():
    from app.services import library_upload_janitor as jan

    assert hasattr(jan, "mark_stuck_uploads_failed")
    assert hasattr(jan, "DEFAULT_STUCK_AFTER")
    # 60-minute default cutoff.
    assert jan.DEFAULT_STUCK_AFTER.total_seconds() == 60 * 60


def test_library_upload_janitor_flips_only_processing_states():
    """The janitor's source must restrict UPDATEs to PROCESSING_OCR
    and PROCESSING_VECTOR. A bug here would re-FAIL completed jobs."""
    from app.models import UploadJobStatus
    from app.services import library_upload_janitor as jan

    src = inspect.getsource(jan)
    # Both processing states referenced.
    assert "PROCESSING_OCR" in src
    assert "PROCESSING_VECTOR" in src
    # COMPLETED never appears in the WHERE clause.
    # (This is a weak guard — but it would catch the most likely
    # off-by-one regression: someone accidentally widening the
    # state filter.)
    candidates = jan._PROCESSING_STATES
    assert UploadJobStatus.COMPLETED not in candidates
    assert UploadJobStatus.FAILED not in candidates
    assert UploadJobStatus.PENDING not in candidates


def test_lifespan_calls_janitor_on_startup():
    """`app.main.lifespan` must invoke `mark_stuck_uploads_failed`
    on startup. Catches the regression where the janitor exists but
    nothing calls it."""
    from app import main

    src = inspect.getsource(main.lifespan)
    assert "mark_stuck_uploads_failed" in src, (
        "lifespan must invoke mark_stuck_uploads_failed on startup. Audit finding #9 (v3.6)."
    )


def test_janitor_lives_under_services_not_scripts():
    """Architectural: the janitor must be a service (importable from
    the running app), not a script in `backend/scripts/`."""
    from app.services import library_upload_janitor

    janitor_path = Path(library_upload_janitor.__file__).resolve()
    assert "services" in janitor_path.parts
    assert "scripts" not in janitor_path.parts
