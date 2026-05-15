from __future__ import annotations

import inspect
from pathlib import Path


def test_slowapi_middleware_and_handler_are_wired():
    from app import main

    src = inspect.getsource(main.create_app)
    assert "app.state.limiter = limiter" in src
    assert "@app.exception_handler(RateLimitExceeded)" in src
    assert "SlowAPIMiddleware" in src
    assert 'RATE_LIMIT_ENABLED", "true"' in src


def test_sensitive_routes_have_endpoint_limits():
    backend = Path(__file__).resolve().parent.parent
    auth = (backend / "app" / "routers" / "auth.py").read_text(encoding="utf-8")
    chat = (backend / "app" / "routers" / "chat.py").read_text(encoding="utf-8")
    admin = (backend / "app" / "routers" / "admin.py").read_text(encoding="utf-8")

    for marker in (
        "@limiter.limit(LIMIT_AUTH_REGISTER)",
        "@limiter.limit(LIMIT_AUTH_LOGIN)",
        "@limiter.limit(LIMIT_AUTH_REFRESH)",
    ):
        assert marker in auth
    assert "@limiter.limit(LIMIT_CHAT_STREAM)" in chat
    assert "@limiter.limit(LIMIT_CHAT_OCR)" in chat
    assert "@limiter.limit(LIMIT_ADMIN_UPLOAD)" in admin


def test_rate_limits_are_centralized_and_env_overridable():
    path = Path(__file__).resolve().parent.parent / "app" / "middleware" / "rate_limit.py"
    src = path.read_text(encoding="utf-8")

    assert "def _env_limit" in src
    for name in (
        "LIMIT_AUTH_LOGIN",
        "LIMIT_AUTH_REGISTER",
        "LIMIT_AUTH_REFRESH",
        "LIMIT_CHAT_OCR",
        "LIMIT_CHAT_STREAM",
        "LIMIT_ADMIN_UPLOAD",
    ):
        assert name in src
