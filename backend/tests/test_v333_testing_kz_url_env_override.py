"""v3.33 — TESTING_KZ_SCHEDULE_URL env override + testcenter.kz copy fix
(no DB, no network).

v3.36 update: the in-code default flipped from
``https://www.testing.kz/ent/schedule`` to ``https://testcenter.kz/``.
Tests assert the post-v3.36 default; the env-override behavior
itself is unchanged from v3.33.

Web research on 2026-05-01 confirmed that the canonical Kazakhstan
National Testing Center is **testcenter.kz** (НЦТ — Ұлттық тестілеу
орталығы), not testing.kz. The user-facing copy in
``RETAKE_GUIDE_STRINGS`` referenced testing.kz in both
``policy_authoritative`` and ``fallback_warning`` for both languages,
which is misleading at best.

This v3.33 ships:

1. ``TESTING_KZ_SCHEDULE_URL`` is now read from the environment at
   module-import time, falling back to the in-code default
   (now ``https://testcenter.kz/`` — see v3.36). Ops can switch
   the fetcher to any future stable URL (curated mirror, replacement
   НЦТ schedule page) without a code change.

2. The four user-facing strings (RU + KZ ``policy_authoritative``,
   RU + KZ ``fallback_warning``) now reference ``testcenter.kz``.

These tests pin both halves so a future "fix" that flips back to
testing.kz, or accidentally drops the env override, trips loudly.
"""

from __future__ import annotations

import importlib
import os
from unittest.mock import patch


def _reload_retake_guide():
    """Reload the module so module-level ``os.getenv`` re-evaluates."""
    import app.services.retake_guide as rg

    return importlib.reload(rg)


def test_default_schedule_url_when_env_unset():
    """With no ``TESTING_KZ_SCHEDULE_URL`` in the environment, the
    canonical NCT homepage is used (post-v3.36)."""
    env = {k: v for k, v in os.environ.items() if k != "TESTING_KZ_SCHEDULE_URL"}
    with patch.dict(os.environ, env, clear=True):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == "https://testcenter.kz/"
    # Restore module state for the rest of the suite.
    _reload_retake_guide()


def test_env_override_replaces_schedule_url():
    """A non-empty env value is picked up at import time."""
    override = "https://new.testcenter.kz/?lang=ru"
    with patch.dict(os.environ, {"TESTING_KZ_SCHEDULE_URL": override}):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == override
    _reload_retake_guide()


def test_env_override_strips_whitespace():
    """Leading/trailing whitespace in the env value is stripped — a
    common .env-file pitfall on Windows / multi-line YAML deploys."""
    with patch.dict(os.environ, {"TESTING_KZ_SCHEDULE_URL": "  https://example.test/  "}):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == "https://example.test/"
    _reload_retake_guide()


def test_empty_env_value_falls_back_to_default():
    """Empty string in the env (a common ``KEY=`` typo) must NOT
    leave the URL empty — fall back to the in-code default so the
    fetcher never sends a request to '/'."""
    with patch.dict(os.environ, {"TESTING_KZ_SCHEDULE_URL": ""}):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == "https://testcenter.kz/"
    _reload_retake_guide()


def test_whitespace_only_env_value_falls_back_to_default():
    """``KEY=   `` after strip is empty → use the default."""
    with patch.dict(os.environ, {"TESTING_KZ_SCHEDULE_URL": "   "}):
        rg = _reload_retake_guide()
        assert rg.TESTING_KZ_SCHEDULE_URL == "https://testcenter.kz/"
    _reload_retake_guide()


# --- copy strings now reference testcenter.kz ------------------------------


def test_ru_policy_authoritative_references_testcenter_kz():
    from app.services import retake_guide

    s = retake_guide.RETAKE_GUIDE_STRINGS["ru"]["policy_authoritative"]
    assert "testcenter.kz" in s
    assert "testing.kz" not in s


def test_kz_policy_authoritative_references_testcenter_kz():
    from app.services import retake_guide

    s = retake_guide.RETAKE_GUIDE_STRINGS["kz"]["policy_authoritative"]
    assert "testcenter.kz" in s
    assert "testing.kz" not in s


def test_ru_fallback_warning_references_testcenter_kz():
    from app.services import retake_guide

    s = retake_guide.RETAKE_GUIDE_STRINGS["ru"]["fallback_warning"]
    assert "testcenter.kz" in s
    assert "testing.kz" not in s
    # Cyrillic transliteration of testing.kz (тестинг.кз) was the
    # original phrasing — make sure the regression doesn't sneak back
    # via a translation pass.
    assert "тестинг" not in s.lower()


def test_kz_fallback_warning_references_testcenter_kz():
    from app.services import retake_guide

    s = retake_guide.RETAKE_GUIDE_STRINGS["kz"]["fallback_warning"]
    assert "testcenter.kz" in s
    assert "testing.kz" not in s
