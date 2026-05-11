"""
v3.12 (F5, 2026-04-30) — pytest pins for chat-image OCR helpers.

Covers `app.services.image_ocr` pure helpers:
  - is_allowed_ocr_content_type
  - is_within_ocr_size_cap
  - classify_ocr_result
  - ocr_seed_prefix / ocr_seed_suffix
  - build_ocr_seed
  - ocr_error_message

The `/api/chat/ocr` endpoint that wraps these helpers is intentionally
NOT exercised here — the endpoint touches DashScope and lives in the
e2e suite. This file is meant to run in the no-DB CI smoke lane and
is pinned by the workflow `-k` filter as `v312_image_ocr`.

The source-introspection guard at the bottom enforces that this
helper module stays free of DB / SQLAlchemy / DashScope client
imports (so the pure-helper invariant doesn't drift).
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest


@pytest.fixture
def mod():
    return importlib.import_module("app.services.image_ocr")


# ---------------------------------------------------------------------------
# is_allowed_ocr_content_type
# ---------------------------------------------------------------------------


def test_allowed_content_type_jpeg_png(mod):
    assert mod.is_allowed_ocr_content_type("image/jpeg") is True
    assert mod.is_allowed_ocr_content_type("image/png") is True
    assert mod.is_allowed_ocr_content_type("image/jpg") is True


def test_allowed_content_type_case_insensitive(mod):
    assert mod.is_allowed_ocr_content_type("IMAGE/JPEG") is True
    assert mod.is_allowed_ocr_content_type("Image/Png") is True


def test_allowed_content_type_strips_whitespace(mod):
    assert mod.is_allowed_ocr_content_type("  image/png  ") is True


def test_allowed_content_type_rejects_heic(mod):
    # HEIC is intentionally NOT in the allow-list — qwen-vl-ocr
    # won't accept it without a converter step.
    assert mod.is_allowed_ocr_content_type("image/heic") is False
    assert mod.is_allowed_ocr_content_type("image/heif") is False


def test_allowed_content_type_rejects_other_media(mod):
    assert mod.is_allowed_ocr_content_type("image/webp") is False
    assert mod.is_allowed_ocr_content_type("image/gif") is False
    assert mod.is_allowed_ocr_content_type("application/pdf") is False
    assert mod.is_allowed_ocr_content_type("text/plain") is False


def test_allowed_content_type_defensive_against_non_str(mod):
    assert mod.is_allowed_ocr_content_type(None) is False
    assert mod.is_allowed_ocr_content_type(123) is False
    assert mod.is_allowed_ocr_content_type(["image/png"]) is False
    assert mod.is_allowed_ocr_content_type({"image/png": True}) is False
    assert mod.is_allowed_ocr_content_type("") is False


# ---------------------------------------------------------------------------
# is_within_ocr_size_cap
# ---------------------------------------------------------------------------


def test_size_cap_zero_bytes_allowed(mod):
    # An empty body is technically within the cap; the endpoint
    # rejects empty bodies via a separate check, not via size.
    assert mod.is_within_ocr_size_cap(0) is True


def test_size_cap_under_limit(mod):
    assert mod.is_within_ocr_size_cap(1) is True
    assert mod.is_within_ocr_size_cap(1024) is True
    assert mod.is_within_ocr_size_cap(mod.MAX_OCR_IMAGE_BYTES - 1) is True


def test_size_cap_at_limit(mod):
    assert mod.is_within_ocr_size_cap(mod.MAX_OCR_IMAGE_BYTES) is True


def test_size_cap_over_limit(mod):
    assert mod.is_within_ocr_size_cap(mod.MAX_OCR_IMAGE_BYTES + 1) is False
    assert mod.is_within_ocr_size_cap(100 * 1024 * 1024) is False


def test_size_cap_rejects_negative(mod):
    assert mod.is_within_ocr_size_cap(-1) is False
    assert mod.is_within_ocr_size_cap(-1024) is False


def test_size_cap_defensive_against_non_int(mod):
    assert mod.is_within_ocr_size_cap(None) is False
    assert mod.is_within_ocr_size_cap("1024") is False
    assert mod.is_within_ocr_size_cap(1024.0) is False
    assert mod.is_within_ocr_size_cap(True) is False  # bool is int subclass; reject
    assert mod.is_within_ocr_size_cap([1024]) is False


def test_size_cap_default_is_8_mib(mod):
    # Hard-pin the cap so an accidental bump shows up in CI.
    assert mod.MAX_OCR_IMAGE_BYTES == 8 * 1024 * 1024


# ---------------------------------------------------------------------------
# classify_ocr_result
# ---------------------------------------------------------------------------


def test_classify_blank_page_token(mod):
    assert mod.classify_ocr_result("BLANK_PAGE") == "blank"
    assert mod.classify_ocr_result("  BLANK_PAGE  ") == "blank"


def test_classify_blank_page_token_is_case_sensitive(mod):
    # The system prompt is documented to return the literal token;
    # treat lowercase variants as plain text the model produced.
    assert mod.classify_ocr_result("blank_page") == "ok"


def test_classify_empty_string(mod):
    assert mod.classify_ocr_result("") == "empty"
    assert mod.classify_ocr_result("   ") == "empty"
    assert mod.classify_ocr_result("\n\n") == "empty"


def test_classify_under_min_useful_chars(mod):
    assert mod.classify_ocr_result("ab") == "empty"
    assert mod.classify_ocr_result("abc") == "empty"


def test_classify_at_min_useful_chars(mod):
    # Boundary: MIN_USEFUL_OCR_CHARS=4 → strings of length 4 are "ok".
    assert mod.classify_ocr_result("abcd") == "ok"


def test_classify_ok_text(mod):
    assert mod.classify_ocr_result("Hello, world.") == "ok"
    assert mod.classify_ocr_result("Найти x: 2x+3=7") == "ok"
    assert mod.classify_ocr_result("Теңдеу: x² - 5x + 6 = 0") == "ok"


def test_classify_defensive_against_non_str(mod):
    assert mod.classify_ocr_result(None) == "empty"
    assert mod.classify_ocr_result(b"BLANK_PAGE") == "empty"
    assert mod.classify_ocr_result(123) == "empty"
    assert mod.classify_ocr_result(["text"]) == "empty"


# ---------------------------------------------------------------------------
# ocr_seed_prefix / ocr_seed_suffix
# ---------------------------------------------------------------------------


def test_seed_prefix_ru(mod):
    out = mod.ocr_seed_prefix("ru")
    assert "Опираясь" in out
    assert out.endswith("\n\n")


def test_seed_prefix_kz(mod):
    out = mod.ocr_seed_prefix("kz")
    assert "Осы суреттегі" in out
    assert out.endswith("\n\n")


def test_seed_prefix_unknown_lang_falls_back_to_ru(mod):
    # Anything not "kz" → RU (matches s28-s35 chat-UI convention).
    assert mod.ocr_seed_prefix("en") == mod.ocr_seed_prefix("ru")
    assert mod.ocr_seed_prefix(None) == mod.ocr_seed_prefix("ru")
    assert mod.ocr_seed_prefix("") == mod.ocr_seed_prefix("ru")
    assert mod.ocr_seed_prefix(42) == mod.ocr_seed_prefix("ru")


def test_seed_suffix_is_empty_for_now(mod):
    # Documented as reserved; guard the contract.
    assert mod.ocr_seed_suffix("ru") == ""
    assert mod.ocr_seed_suffix("kz") == ""


# ---------------------------------------------------------------------------
# build_ocr_seed
# ---------------------------------------------------------------------------


def test_build_seed_happy_path_ru(mod):
    out = mod.build_ocr_seed("Найти x: 2x+3=7", "ru")
    assert out is not None
    assert out.startswith("Опираясь")
    assert "Найти x: 2x+3=7" in out


def test_build_seed_happy_path_kz(mod):
    out = mod.build_ocr_seed("Теңдеуді шеш: x²=9", "kz")
    assert out is not None
    assert out.startswith("Осы суреттегі")
    assert "Теңдеуді шеш" in out


def test_build_seed_strips_leading_trailing_whitespace(mod):
    out = mod.build_ocr_seed("   текст с пробелами   ", "ru")
    assert out is not None
    assert "текст с пробелами" in out
    # Stripped, no leading whitespace from the OCR text itself.
    assert "\n\n   текст" not in out


def test_build_seed_returns_none_on_blank_page(mod):
    assert mod.build_ocr_seed("BLANK_PAGE", "ru") is None
    assert mod.build_ocr_seed("BLANK_PAGE", "kz") is None


def test_build_seed_returns_none_on_empty(mod):
    assert mod.build_ocr_seed("", "ru") is None
    assert mod.build_ocr_seed("   ", "ru") is None
    assert mod.build_ocr_seed("ab", "ru") is None


def test_build_seed_returns_none_on_non_str(mod):
    assert mod.build_ocr_seed(None, "ru") is None
    assert mod.build_ocr_seed(123, "ru") is None
    assert mod.build_ocr_seed(["text"], "ru") is None


# ---------------------------------------------------------------------------
# ocr_error_message
# ---------------------------------------------------------------------------


def test_error_message_blank_ru_kz(mod):
    ru = mod.ocr_error_message("blank", "ru")
    kz = mod.ocr_error_message("blank", "kz")
    assert ru != kz
    assert "текст" in ru.lower()
    assert "мәтін" in kz.lower()


def test_error_message_empty_ru_kz(mod):
    ru = mod.ocr_error_message("empty", "ru")
    kz = mod.ocr_error_message("empty", "kz")
    assert ru != kz
    assert ru and kz


def test_error_message_too_large_mentions_cap(mod):
    ru = mod.ocr_error_message("too-large", "ru")
    kz = mod.ocr_error_message("too-large", "kz")
    cap_mib = mod.MAX_OCR_IMAGE_BYTES // (1024 * 1024)
    assert str(cap_mib) in ru
    assert str(cap_mib) in kz


def test_error_message_bad_type(mod):
    ru = mod.ocr_error_message("bad-type", "ru")
    kz = mod.ocr_error_message("bad-type", "kz")
    assert "JPEG" in ru and "PNG" in ru
    assert "JPEG" in kz and "PNG" in kz


def test_error_message_upstream_failed(mod):
    ru = mod.ocr_error_message("upstream-failed", "ru")
    kz = mod.ocr_error_message("upstream-failed", "kz")
    assert ru and kz
    assert ru != kz


def test_error_message_unknown_reason_falls_back_to_generic(mod):
    # Unknown reasons collapse to the generic "upstream-failed" copy.
    ru_unknown = mod.ocr_error_message("totally-unknown", "ru")
    ru_upstream = mod.ocr_error_message("upstream-failed", "ru")
    assert ru_unknown == ru_upstream


def test_error_message_lang_default_is_ru(mod):
    # Anything that isn't the literal "kz" → RU.
    assert mod.ocr_error_message("blank", "en") == mod.ocr_error_message("blank", "ru")
    assert mod.ocr_error_message("blank", None) == mod.ocr_error_message("blank", "ru")


# ---------------------------------------------------------------------------
# Source-introspection guard — keep the module pure
# ---------------------------------------------------------------------------


def test_module_source_has_no_db_or_dashscope_imports():
    """Pin: image_ocr.py is a *pure* helper module.

    If a future change pulls in SQLAlchemy or the DashScope client at
    module level, this test fails — forcing the new I/O to live in the
    router or in a separate non-pure module instead.
    """
    here = Path(__file__).resolve().parent
    src = (here.parent / "app" / "services" / "image_ocr.py").read_text(encoding="utf-8")
    forbidden = (
        "import AsyncSession",
        "from sqlalchemy",
        "from ..database",
        "from .database",
        "import dashscope",
        "from openai",
        "import httpx",
        "import requests",
    )
    for tok in forbidden:
        assert tok not in src, (
            f"image_ocr.py must remain pure; found forbidden import token: {tok!r}"
        )
