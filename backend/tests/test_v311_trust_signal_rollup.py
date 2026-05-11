"""
v3.11 (I1+I2, 2026-04-30) — pytest pins for trust-signal roll-up
helpers.

These tests cover the pure helpers in
`app.services.trust_signal_rollup`. The DB-touching endpoint at
`/api/admin/chat/trust-signal-rollup` is NOT covered here — it's
exercised by the e2e suite that already runs against a live
postgres. This file is meant to run in the no-DB CI smoke lane.
"""

from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def mod():
    return importlib.import_module("app.services.trust_signal_rollup")


# ---------------------------------------------------------------------------
# safe_pct
# ---------------------------------------------------------------------------


def test_safe_pct_happy_path(mod):
    assert mod.safe_pct(8, 100) == 8.0
    assert mod.safe_pct(1, 3) == 33.3
    assert mod.safe_pct(2, 3) == 66.7


def test_safe_pct_zero_denominator(mod):
    assert mod.safe_pct(5, 0) == 0.0


def test_safe_pct_none_inputs(mod):
    assert mod.safe_pct(None, 10) == 0.0
    assert mod.safe_pct(5, None) == 0.0
    assert mod.safe_pct(None, None) == 0.0


def test_safe_pct_negative_inputs(mod):
    assert mod.safe_pct(-1, 10) == 0.0
    assert mod.safe_pct(5, -10) == 0.0


def test_safe_pct_non_numeric(mod):
    assert mod.safe_pct("abc", 10) == 0.0
    assert mod.safe_pct(5, "abc") == 0.0


def test_safe_pct_one_decimal_place(mod):
    # AVG-shaped numbers should round to one decimal.
    assert mod.safe_pct(1, 7) == 14.3
    assert mod.safe_pct(1, 8) == 12.5
    assert mod.safe_pct(2, 9) == 22.2


# ---------------------------------------------------------------------------
# coalesce_int / coalesce_float
# ---------------------------------------------------------------------------


def test_coalesce_int_happy(mod):
    assert mod.coalesce_int(5) == 5
    assert mod.coalesce_int(0) == 0


def test_coalesce_int_none(mod):
    assert mod.coalesce_int(None) == 0


def test_coalesce_int_negative_clamped(mod):
    # Migration glitch shouldn't surface negative counts.
    assert mod.coalesce_int(-3) == 0


def test_coalesce_int_string(mod):
    assert mod.coalesce_int("not a number") == 0


def test_coalesce_float_preserves_none(mod):
    # Distinguishes "no rows in this bucket" from "literal zero".
    assert mod.coalesce_float(None) is None


def test_coalesce_float_happy(mod):
    assert mod.coalesce_float(0.5) == 0.5
    assert mod.coalesce_float(0) == 0.0


def test_coalesce_float_negative_clamped(mod):
    assert mod.coalesce_float(-0.1) == 0.0


def test_coalesce_float_non_numeric(mod):
    assert mod.coalesce_float("abc") is None


# ---------------------------------------------------------------------------
# format_trust_signal_row
# ---------------------------------------------------------------------------


def test_format_row_full_payload(mod):
    row = {
        "bucket": "agent",
        "turns": 100,
        "redactions_total": 8,
        "turns_with_redaction": 5,
        "turns_with_failed_tool": 3,
        "turns_general_knowledge": 21,
        "turns_with_sources": 67,
        "avg_redactions": 0.08,
    }
    out = mod.format_trust_signal_row(row)
    assert out["bucket"] == "agent"
    assert out["turns"] == 100
    assert out["redactions_total"] == 8
    assert out["redaction_pct"] == 5.0
    assert out["failed_tool_pct"] == 3.0
    assert out["general_knowledge_pct"] == 21.0
    assert out["sourced_pct"] == 67.0
    assert out["avg_redactions"] == 0.08


def test_format_row_zero_turns(mod):
    # Even with zero turns the percentages should be 0.0, not error.
    row = {
        "bucket": "agent",
        "turns": 0,
        "redactions_total": 0,
        "turns_with_redaction": 0,
        "turns_with_failed_tool": 0,
        "turns_general_knowledge": 0,
        "turns_with_sources": 0,
        "avg_redactions": None,
    }
    out = mod.format_trust_signal_row(row)
    assert out["turns"] == 0
    assert out["redaction_pct"] == 0.0
    assert out["sourced_pct"] == 0.0
    assert out["avg_redactions"] is None


def test_format_row_unknown_bucket_label(mod):
    row = {"bucket": None, "turns": 5}
    out = mod.format_trust_signal_row(row)
    assert out["bucket"] == "unknown"


def test_format_row_missing_keys_default_to_zero(mod):
    out = mod.format_trust_signal_row({"bucket": "agent", "turns": 10})
    assert out["redactions_total"] == 0
    assert out["turns_with_redaction"] == 0
    assert out["redaction_pct"] == 0.0
    assert out["sourced_pct"] == 0.0


def test_format_row_negative_inputs_clamped(mod):
    out = mod.format_trust_signal_row({"bucket": "agent", "turns": -5, "redactions_total": -2})
    assert out["turns"] == 0
    assert out["redactions_total"] == 0


# ---------------------------------------------------------------------------
# build_rollup_payload
# ---------------------------------------------------------------------------


def test_build_payload_sorts_buckets_by_turns_desc(mod):
    rows = [
        {"bucket": "legacy", "turns": 30},
        {"bucket": "agent", "turns": 100},
        {"bucket": "unknown", "turns": 5},
    ]
    payload = mod.build_rollup_payload(window_days=7, rows=rows)
    buckets = [r["bucket"] for r in payload["rows"]]
    assert buckets == ["agent", "legacy", "unknown"]


def test_build_payload_window_days_echoed(mod):
    payload = mod.build_rollup_payload(window_days=30, rows=[])
    assert payload["window_days"] == 30
    assert payload["rows"] == []


def test_build_payload_totals_summed(mod):
    rows = [
        {
            "bucket": "agent",
            "turns": 100,
            "redactions_total": 8,
            "turns_with_redaction": 5,
            "turns_with_failed_tool": 3,
            "turns_general_knowledge": 20,
            "turns_with_sources": 60,
            "avg_redactions": 0.08,
        },
        {
            "bucket": "legacy",
            "turns": 50,
            "redactions_total": 2,
            "turns_with_redaction": 1,
            "turns_with_failed_tool": 0,
            "turns_general_knowledge": 5,
            "turns_with_sources": 30,
            "avg_redactions": 0.04,
        },
    ]
    payload = mod.build_rollup_payload(window_days=7, rows=rows)
    totals = payload["totals"]
    assert totals["turns"] == 150
    assert totals["redactions_total"] == 10
    # 6/150 = 4.0%
    assert totals["redaction_pct"] == 4.0
    # 3/150 = 2.0%
    assert totals["failed_tool_pct"] == 2.0
    # 90/150 = 60.0%
    assert totals["sourced_pct"] == 60.0


def test_build_payload_empty_rows(mod):
    payload = mod.build_rollup_payload(window_days=7, rows=[])
    assert payload["rows"] == []
    assert payload["totals"]["turns"] == 0
    assert payload["totals"]["redaction_pct"] == 0.0


def test_build_payload_window_days_coerces_int(mod):
    # FastAPI's Query(...) hands us an int already, but pin the
    # coercion so a future caller passing "7" doesn't blow up.
    payload = mod.build_rollup_payload(window_days="7", rows=[])  # type: ignore[arg-type]
    assert payload["window_days"] == 7


# ---------------------------------------------------------------------------
# Source introspection — ensure the feature flag boundary stays clean
# ---------------------------------------------------------------------------


def test_module_does_not_import_db_session(mod):
    """The helpers must not import `app.database` or any AsyncSession
    surface — they're pure formatters. If a future refactor pulls in
    a DB import this test will trip and remind us to split."""
    import inspect

    src = inspect.getsource(mod)
    assert "from ..database" not in src
    assert "from app.database" not in src
    # AsyncSession should never be imported into this module — only
    # mentioned in a docstring describing the boundary. Pin the
    # actual import statement, not the word.
    assert "import AsyncSession" not in src
    assert "from sqlalchemy" not in src


def test_admin_router_wires_helper(mod):
    """Source-introspect the admin router to ensure the new endpoint
    delegates to `build_rollup_payload`. Catches a refactor that
    inlines the math back into the SQL handler."""
    import inspect

    from app.routers import admin as admin_router

    src = inspect.getsource(admin_router)
    assert "trust_signal_rollup" in src
    assert "build_rollup_payload" in src
    assert "/chat/trust-signal-rollup" in src
