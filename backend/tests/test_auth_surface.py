"""Regression lock for backend/app/routers/auth.py.

Session 20 (2026-04-21) caught a silent revert of three session-2/3
fixes: EmailStr validation, password-strength rules, and the
`/api/auth/refresh` endpoint. The file had been overwritten at some
point during the s13-s19 run and nobody noticed because no test
covered any of those surfaces.

Purpose of this file: assert the *shape* of the module, not the
business semantics. If any of these surfaces disappear again (a bad
rebase, a hand-edit that drops imports, anything), pytest fails loud.

Runs in pure unit mode — no DB, no fixtures, no network. Reads the
router module directly and introspects.
"""

from __future__ import annotations

import inspect

import pytest

from app.routers import auth as auth_mod


def test_token_model_has_optional_refresh_token():
    """Login responses must be able to return a refresh token."""
    Token = auth_mod.Token
    fields = Token.model_fields
    assert "access_token" in fields
    assert "token_type" in fields
    assert "refresh_token" in fields, (
        "Token model missing `refresh_token`. Session 20 regression — "
        "the /api/auth/refresh endpoint depends on this field being "
        "populated by the /login and /token endpoints."
    )


def test_user_create_uses_emailstr():
    """Registration must reject malformed emails at the pydantic layer."""
    from pydantic import EmailStr  # noqa: F401 — proves dep is installed

    UserCreate = auth_mod.UserCreate
    annotations = {name: field.annotation for name, field in UserCreate.model_fields.items()}
    # EmailStr is a type-alias that pydantic preserves on the field
    repr_email = repr(annotations["email"])
    assert "EmailStr" in repr_email or "email" in repr_email.lower(), (
        f"UserCreate.email should be EmailStr, got {repr_email!r}. "
        "BUG-1 regression — a@b and similar malformed emails will be "
        "accepted as valid users."
    )


def test_user_create_validates_password_strength():
    """Password policy (>=8 chars, alpha + digit) must be enforced server-side."""
    UserCreate = auth_mod.UserCreate
    assert hasattr(UserCreate, "validate_password_strength"), (
        "UserCreate.validate_password_strength missing. BUG-2 regression — "
        "server will accept 7-char passwords, whitespace-only passwords, "
        "and passwords with no digits."
    )
    # Positive cases
    UserCreate.validate_password_strength("Qaz1234pass")
    # Negative cases
    with pytest.raises(ValueError):
        UserCreate.validate_password_strength("short1a")  # <8
    with pytest.raises(ValueError):
        UserCreate.validate_password_strength("        ")  # whitespace only
    with pytest.raises(ValueError):
        UserCreate.validate_password_strength("aaaaaaaaa")  # no digit
    with pytest.raises(ValueError):
        UserCreate.validate_password_strength("12345678")  # no alpha


def test_user_create_rejects_over_72_bytes():
    """bcrypt 5.0.0 raises on passwords >72 bytes; we must reject at
    validation time with a clean ValueError instead of letting a 500
    escape from the hashing layer during registration."""
    UserCreate = auth_mod.UserCreate
    # 73 ASCII bytes, otherwise-valid (mixed alpha+digit)
    pw = "A1" + ("x" * 71)
    assert len(pw.encode("utf-8")) == 73
    with pytest.raises(ValueError):
        UserCreate.validate_password_strength(pw)
    # 72 bytes exactly should still pass (boundary case)
    pw_ok = "A1" + ("x" * 70)
    assert len(pw_ok.encode("utf-8")) == 72
    UserCreate.validate_password_strength(pw_ok)  # no raise


def test_refresh_request_schema_present():
    """The refresh endpoint's request body schema must exist."""
    assert hasattr(auth_mod, "RefreshRequest")
    fields = auth_mod.RefreshRequest.model_fields
    assert "refresh_token" in fields


def test_refresh_token_factory_issues_refresh_type_jwt():
    """create_refresh_token must mint a JWT with `type=refresh`."""
    from jose import jwt

    assert hasattr(auth_mod, "create_refresh_token")
    token = auth_mod.create_refresh_token({"sub": "probe@test.com"})
    decoded = jwt.decode(token, auth_mod.SECRET_KEY, algorithms=[auth_mod.ALGORITHM])
    assert decoded.get("sub") == "probe@test.com"
    assert decoded.get("type") == "refresh", (
        "create_refresh_token must set `type: refresh` so the "
        "/api/auth/refresh endpoint can distinguish refresh from access "
        "tokens. A refresh-token reuse check depends on this."
    )


def test_access_token_factory_issues_access_type_jwt():
    from jose import jwt

    token = auth_mod.create_access_token({"sub": "probe@test.com"})
    decoded = jwt.decode(token, auth_mod.SECRET_KEY, algorithms=[auth_mod.ALGORITHM])
    assert decoded.get("type") == "access", (
        "create_access_token should tag tokens with `type: access` so "
        "the refresh endpoint can reject access tokens presented for "
        "refresh."
    )


def test_refresh_endpoint_is_mounted():
    """`POST /api/auth/refresh` must be registered on the auth router."""
    router = auth_mod.router
    paths = {route.path for route in router.routes}
    assert "/auth/refresh" in paths, (
        "POST /auth/refresh missing from auth router. Session 20 "
        "regression — the frontend AuthContext depends on this."
    )


def test_admin_gate_helpers_exist():
    """Session 19 admin-gate must still be wired in."""
    assert hasattr(auth_mod, "get_current_admin")
    assert hasattr(auth_mod, "_env_admin_emails")
    # Helper should be callable without any I/O.
    out = auth_mod._env_admin_emails()
    assert isinstance(out, set)


def test_refresh_endpoint_signature():
    """The /refresh endpoint must take a RefreshRequest body (not a raw token)."""
    for route in auth_mod.router.routes:
        if getattr(route, "path", "") == "/auth/refresh":
            sig = inspect.signature(route.endpoint)
            param_names = list(sig.parameters.keys())
            assert any(
                auth_mod.RefreshRequest is sig.parameters[p].annotation for p in param_names
            ), (
                f"/auth/refresh endpoint should accept RefreshRequest as a "
                f"body param; got {param_names}"
            )
            return
    pytest.fail("/auth/refresh route not found on router")
