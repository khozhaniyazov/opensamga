"""Regression tests for chat import surface modules."""

import os


def test_app_main_imports_without_missing_chat_modules():
    os.environ.setdefault("OPENAI_API_KEY", "test-key")
    from app.main import app  # noqa: F401

    assert app is not None


def test_tools_registry_exports_openai_tools_list():
    os.environ.setdefault("OPENAI_API_KEY", "test-key")
    from app.services.chat.tools_registry import tools

    assert isinstance(tools, list)
    assert tools


def test_normalize_markdown_preserves_valid_markdown_and_collapses_blanks():
    from app.services.chat.message_formatter import normalize_markdown

    sample = "# Header\r\n\r\n\r\n\r\nParagraph"
    assert normalize_markdown(sample) == "# Header\n\nParagraph"
    assert normalize_markdown("") == ""


def test_chat_router_has_fastapi_status_symbol_in_namespace():
    """Regression guard for the 2026-04-18 NameError we hit at runtime:
    `status_code=status.HTTP_429_TOO_MANY_REQUESTS` depends on `status` being
    imported from fastapi at module level. If someone drops the import, the
    quota branch raises `NameError` instead of returning 429. Static import
    test that surfaces the bug without having to exercise the quota path.
    """
    os.environ.setdefault("OPENAI_API_KEY", "test-key")

    from app.routers import chat as chat_router

    assert hasattr(chat_router, "status"), (
        "app.routers.chat must expose `status` (from fastapi) so the quota "
        "branch can raise HTTP 429 without NameError."
    )
    # Sanity: the symbol we actually dereference at runtime.
    assert hasattr(chat_router.status, "HTTP_429_TOO_MANY_REQUESTS")
