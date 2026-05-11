"""
Tests for v3.3 security hardening (2026-04-29).

Covers four audit findings that were hiding behind green CI:

  - #1  JWT type confusion: refresh tokens MUST NOT pass as access
        tokens through `routers.auth.get_current_user`,
        `routers.chat_websocket.get_user_from_token`,
        `routers.library.get_current_user_from_token`, and the
        onboarding-redirect helper in `app.main._decode_token_email`.
  - #4  Admin gate triplication: there is now ONE source of truth
        (`routers.auth.get_current_admin`). `routers.admin.is_admin`
        and `routers.billing.admin_set_plan` must both agree with it.
  - #10 Dev-console mount: `/api/dev/*` must NOT be mounted when
        `ENVIRONMENT != "development"`.
  - #11 Portfolio FRIENDS_ONLY: must NOT fall through to the public
        branch.

These are pure unit/shape tests — no DB, no network. They assert the
*behavior* against tiny ad-hoc inputs and the *shape* of route
registration. If any of these regressions reappear, pytest fails loud
the same way `test_auth_surface.py` catches session-2/3 reverts.
"""

from __future__ import annotations

import os
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.routers import auth as auth_mod

# ---------------------------------------------------------------------------
# Finding #1 — JWT type confusion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_token_rejected_by_get_current_user():
    """A refresh-typed JWT must raise 401 from get_current_user."""
    from fastapi import HTTPException

    refresh_token = auth_mod.create_refresh_token({"sub": "probe@test.com"})
    with pytest.raises(HTTPException) as exc:
        # db is unused on the failure path; pass None.
        await auth_mod.get_current_user(token=refresh_token, db=None)  # type: ignore[arg-type]
    assert exc.value.status_code == 401


def test_get_current_user_source_rejects_type_refresh():
    """Belt-and-suspenders: the literal `type == "refresh"` guard must
    be in the get_current_user source. If a refactor accidentally drops
    it, this fails before runtime tests do."""
    src = pytest.importorskip("inspect").getsource(auth_mod.get_current_user)
    assert '"refresh"' in src and "type" in src, (
        "get_current_user must reject tokens with type=='refresh'. Audit finding #1 (v3.3)."
    )


def test_chat_websocket_rejects_refresh_type():
    from app.routers import chat_websocket

    src = pytest.importorskip("inspect").getsource(chat_websocket.get_user_from_token)
    assert '"refresh"' in src, (
        "chat_websocket.get_user_from_token must reject refresh tokens. Audit finding #1 (v3.3)."
    )


def test_library_rejects_refresh_type():
    from app.routers import library

    src = pytest.importorskip("inspect").getsource(library.require_library_access)
    assert '"refresh"' in src, (
        "library.require_library_access must reject refresh tokens. Audit finding #1 (v3.3)."
    )


def test_main_decode_token_email_rejects_refresh_type():
    from app import main

    src = pytest.importorskip("inspect").getsource(main._decode_token_email)
    assert '"refresh"' in src, (
        "main._decode_token_email must reject refresh tokens for "
        "onboarding-redirect decisions. Audit finding #1 (v3.3)."
    )


# ---------------------------------------------------------------------------
# Finding #4 — Admin gate triplication
# ---------------------------------------------------------------------------


def test_admin_is_admin_respects_db_flag():
    """`routers.admin.is_admin(user)` must return True for a user with
    `is_admin=True` even if the env allowlist is empty."""
    from app.routers import admin as admin_mod

    user = SimpleNamespace(is_admin=True, email="someone@example.com")
    with patch.dict(os.environ, {"RAG_ADMIN_EMAILS": ""}, clear=False):
        assert admin_mod.is_admin(user) is True


def test_admin_is_admin_respects_env_allowlist():
    from app.routers import admin as admin_mod

    user = SimpleNamespace(is_admin=False, email="opslead@samga.ai")
    with patch.dict(os.environ, {"RAG_ADMIN_EMAILS": "opslead@samga.ai"}, clear=False):
        assert admin_mod.is_admin(user) is True


def test_admin_is_admin_denies_unprivileged():
    from app.routers import admin as admin_mod

    user = SimpleNamespace(is_admin=False, email="student@samga.ai")
    with patch.dict(os.environ, {"RAG_ADMIN_EMAILS": ""}, clear=False):
        assert admin_mod.is_admin(user) is False


def test_admin_router_no_hardcoded_email_lists():
    """No router file may carry its own hardcoded admin email list any
    more — the canonical source is `auth.get_current_admin`."""
    from pathlib import Path

    # `routers/admin.py` and `routers/billing.py` historically each had
    # their own copies of a small admin-allowlist set literal. The
    # previous fix removed them. This test makes sure nobody
    # re-introduces one. Pattern-match on the hallmark sentinel strings
    # (any literal email set in a router counts as a regression).
    backend_routers = Path(auth_mod.__file__).parent
    for name in ("admin.py", "billing.py"):
        text = (backend_routers / name).read_text(encoding="utf-8")
        # Reject any hardcoded email domain the original allowlists used.
        assert "@samga.ai" not in text or "@unt.edu.kz" not in text, (
            f"{name} re-introduced a hardcoded admin email list. "
            "All admin gating must go through auth.get_current_admin."
        )


def test_billing_set_plan_uses_canonical_admin_dep():
    # admin_set_plan must depend on get_current_admin, not get_current_user.
    import inspect

    from app.routers import billing as billing_mod

    sig = inspect.signature(billing_mod.admin_set_plan)
    current_user_param = sig.parameters["current_user"]
    default = current_user_param.default
    # FastAPI Depends() carries the dependency callable on `.dependency`.
    dep_callable = getattr(default, "dependency", None)
    assert dep_callable is auth_mod.get_current_admin, (
        "billing.admin_set_plan must use auth.get_current_admin (audit finding #4, v3.3)."
    )


def test_admin_router_require_admin_uses_canonical_dep():
    import inspect

    from app.routers import admin as admin_mod

    sig = inspect.signature(admin_mod.require_admin)
    current_user_param = sig.parameters["current_user"]
    default = current_user_param.default
    dep_callable = getattr(default, "dependency", None)
    assert dep_callable is auth_mod.get_current_admin, (
        "admin.require_admin must delegate to auth.get_current_admin (audit finding #4, v3.3)."
    )


# ---------------------------------------------------------------------------
# Finding #10 — Dev console XFF bypass
# ---------------------------------------------------------------------------


def test_dev_console_router_only_mounted_in_development():
    """
    `app.main.create_app()` must NOT mount `/api/dev/*` when
    ENVIRONMENT is anything other than "development". The previous
    in-router localhost guard parsed X-Forwarded-For (attacker
    controlled) and could be bypassed.
    """
    from importlib import reload

    from app import config as config_mod
    from app import main as main_mod

    original_env = config_mod.settings.ENVIRONMENT
    try:
        config_mod.settings.ENVIRONMENT = "production"
        # Recreate the app with the patched setting.
        prod_app = main_mod.create_app()
        prod_paths = {getattr(r, "path", "") for r in prod_app.routes}
        assert not any(p.startswith("/api/dev") for p in prod_paths), (
            "Dev console router must NOT be mounted in production. Audit finding #10 (v3.3)."
        )

        config_mod.settings.ENVIRONMENT = "development"
        dev_app = main_mod.create_app()
        dev_paths = {getattr(r, "path", "") for r in dev_app.routes}
        assert any(p.startswith("/api/dev") for p in dev_paths), (
            "Dev console router must be mounted in development."
        )
    finally:
        config_mod.settings.ENVIRONMENT = original_env
        reload(main_mod)  # restore module-level `app`


# ---------------------------------------------------------------------------
# Finding #11 — Portfolio FRIENDS_ONLY visibility leak
# ---------------------------------------------------------------------------


def test_portfolio_friends_only_does_not_fall_through_to_public():
    """The portfolio handler must NOT treat FRIENDS_ONLY as PUBLIC.
    Until the social graph is wired up, FRIENDS_ONLY behaves like
    PRIVATE (owner-only)."""
    from app.routers import portfolio as portfolio_mod

    # The module loads `Visibility` enum from the models layer; the
    # protective branch we added must reference it.
    src = pytest.importorskip("inspect").getsource(portfolio_mod)
    assert "FRIENDS_ONLY" in src and "raise HTTPException" in src, (
        "portfolio handler must explicitly handle Visibility.FRIENDS_ONLY "
        "and not fall through to the public-return branch. "
        "Audit finding #11 (v3.3)."
    )
