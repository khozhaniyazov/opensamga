"""Tests for the per-invocation isolation of the `test_user` fixture.

Pins the conftest invariant introduced 2026-04-30 as a chore on
top of v3.20:

  > The integration-pgvector lane shares one Postgres container
  > across the whole pytest session. The `test_user` fixture in
  > tests/conftest.py commits its row, so every test that
  > requests it tries a fresh INSERT. With the previous
  > hardcoded `test@example.com` / `testuser` literals, the
  > second INSERT tripped `ix_users_email` /
  > `ix_users_username` UniqueViolation and the cascading
  > setup-error storm masked real failures.

The fix uniquifies email + username with a uuid suffix so the
fixture is safe to be requested by multiple tests in one
session.

These tests are no-DB — they read the conftest source. They run
on every commit in the smoke lane.

Memory pointer: project_session_2026-04-30_v319_chore_ci_baseline.md
captures lane bug #2.
"""

from __future__ import annotations

from pathlib import Path

CONFTEST_PATH = Path(__file__).parent / "conftest.py"


def test_test_user_fixture_uniquifies_email():
    """The fixture must derive email + username from a uuid
    suffix, not a hardcoded literal. A regression here re-opens
    lane bug #2."""
    src = CONFTEST_PATH.read_text(encoding="utf-8")

    fn_start = src.find("async def test_user(")
    assert fn_start != -1, "tests/conftest.py must expose `test_user` fixture"

    # Slice the function body — stop at the next top-level
    # `async def` so we only inspect the fixture, not its
    # neighbours.
    next_fn = src.find("\nasync def ", fn_start + 1)
    body = src[fn_start : next_fn if next_fn != -1 else len(src)]

    assert 'email="test@example.com"' not in body, (
        "test_user fixture must NOT use a hardcoded "
        "`test@example.com` literal. The integration-pgvector "
        "lane shares one Postgres container across the session "
        "and the second INSERT trips ix_users_email "
        "UniqueViolation. Use a uuid-suffixed email instead "
        "(see lane bug #2 in "
        "project_session_2026-04-30_v319_chore_ci_baseline.md)."
    )
    assert 'username="testuser"' not in body, (
        "test_user fixture must NOT use a hardcoded `testuser` "
        "literal — same reason as the email above."
    )
    assert "uuid" in body, (
        "test_user fixture should derive its email/username "
        "from a uuid suffix so multiple tests can request it "
        "without colliding on the unique constraints."
    )


def test_conftest_imports_uuid():
    """The `uuid` import must live at module scope so the fixture
    body doesn't pay the import cost per invocation."""
    src = CONFTEST_PATH.read_text(encoding="utf-8")
    # First 30 lines should contain the import — guards against
    # someone moving it inside the fixture function.
    head = "\n".join(src.splitlines()[:30])
    assert "import uuid" in head, (
        "tests/conftest.py must `import uuid` at module scope "
        "(used by the test_user fixture for email/username "
        "uniquification)."
    )
