"""v4.24 (2026-05-11): tripwire — no hardcoded OpenAI-shaped API keys
anywhere in ``backend/``.

Context
-------
Pre-v4.24, ``backend/scripts/convert_scanned_book.py`` carried a live
``sk-proj-...`` OpenAI project key pinned at module level. The key was
rotated by the owner on 2026-05-11 and the source constant collapsed
to an env-driven lazy client (``_build_client`` reading
``OPENAI_API_KEY``). This file makes sure a future commit can't quietly
reintroduce a similar pattern.

What's pinned
-------------
Two regex families run over every tracked ``backend/**/*.py`` file:

1. OpenAI **project** keys: ``sk-proj-<140+ url-safe chars>``.
2. OpenAI **legacy** keys: ``sk-<20+ base62 chars>`` (excluding the
   ``sk-proj-`` prefix to avoid double-counting).

The only legitimate occurrences in the tree are:

- String literals that are OBVIOUSLY placeholders
  (``sk-REPLACE_WITH_REAL_KEY`` and similar).
- This test file's own regex literals.
- The ``.gitleaks.toml`` allowlist (outside ``backend/``).

Anything else fails the test. The shape matches the
``test_v357_ruff_t20_gate`` / ``test_v342_partial_ac_keyword_guard``
tripwire patterns already used in the repo.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent  # backend/
REPO_ROOT = BACKEND_ROOT.parent

# Patterns matching real-looking OpenAI keys. Deliberately conservative:
# sk-proj- keys are 140+ chars of [A-Za-z0-9_-]; legacy sk- keys are
# 20+ chars of [A-Za-z0-9] (we accept _ and - as well to avoid being
# fooled by a superset).
PROJECT_KEY_RE = re.compile(r"sk-proj-[A-Za-z0-9_-]{40,}")
LEGACY_KEY_RE = re.compile(r"sk-(?!proj-)(?!REPLACE)[A-Za-z0-9_-]{20,}")

# Obvious placeholders we allow as literal substrings.
PLACEHOLDER_SUBSTRINGS = (
    "sk-REPLACE",
    "sk-your-key",
    "sk-xxxx",
    "sk-TEST",
)


def _iter_backend_py_files() -> list[Path]:
    """Every tracked .py file under backend/, excluding caches."""
    hits: list[Path] = []
    for path in BACKEND_ROOT.rglob("*.py"):
        parts = set(path.parts)
        if ".pytest_cache" in parts or ".ruff_cache" in parts or "__pycache__" in parts:
            continue
        hits.append(path)
    return hits


def _is_this_test_file(path: Path) -> bool:
    return path.resolve() == Path(__file__).resolve()


def _strip_placeholders(line: str) -> str:
    out = line
    for placeholder in PLACEHOLDER_SUBSTRINGS:
        out = out.replace(placeholder, "")
    return out


@pytest.mark.parametrize(
    "key_pattern",
    [PROJECT_KEY_RE, LEGACY_KEY_RE],
    ids=["openai_project_key", "openai_legacy_key"],
)
def test_no_hardcoded_openai_keys_in_backend(key_pattern: re.Pattern[str]) -> None:
    offenders: list[tuple[str, int, str]] = []
    for path in _iter_backend_py_files():
        if _is_this_test_file(path):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            scan = _strip_placeholders(line)
            if key_pattern.search(scan):
                rel = path.relative_to(REPO_ROOT).as_posix()
                offenders.append((rel, lineno, line.strip()[:120]))
    assert not offenders, (
        "Hardcoded OpenAI-shaped API key found in backend/ source. "
        "Move it to os.environ['OPENAI_API_KEY']. Offenders:\n"
        + "\n".join(f"  {rel}:{ln}: {content}" for rel, ln, content in offenders)
    )


def test_convert_scanned_book_reads_env_var() -> None:
    """v4.24 scrub site: the one file that had a live key must now
    build its OpenAI client from ``OPENAI_API_KEY`` and must not
    assign a string literal to a module-level ``OPENAI_API_KEY``
    constant.
    """
    path = BACKEND_ROOT / "scripts" / "convert_scanned_book.py"
    text = path.read_text(encoding="utf-8")

    assert "os.environ" in text or "os.getenv" in text, (
        "convert_scanned_book.py must read OPENAI_API_KEY from the "
        "environment, not carry a string literal."
    )

    # Reject the exact shape of the pre-v4.24 leak: a module-level
    # `OPENAI_API_KEY = "..."` assignment.
    module_level_literal = re.compile(
        r'^OPENAI_API_KEY\s*=\s*["\'][A-Za-z0-9_\-]+["\']',
        re.MULTILINE,
    )
    assert not module_level_literal.search(text), (
        "Module-level OPENAI_API_KEY string literal reintroduced. "
        "Use `os.environ['OPENAI_API_KEY']` inside a helper instead."
    )
