"""
v3.11 (I1+I2, 2026-04-30) — trust-signal roll-up helpers.

Closes Phase I rows I1 (per-message redaction count surfaced in
metadata) and I2 (weekly roll-up dashboard for ops). The first is
already done at the persistence layer — `routers/chat.py` writes
`unverified_score_claims_redacted`, `consulted_sources`,
`failed_tool_calls`, and `is_general_knowledge` into
`chat_messages.message_metadata` for every assistant turn since
s28-s30. This module surfaces those fields as ops-readable
aggregates over a configurable window.

The aggregate query lives at `/api/admin/chat/trust-signal-rollup`
(see `routers/admin.py`); this module owns ONLY:

  1. The pure helpers that turn raw psql `mappings()` rows into
     the wire shape (parsable + testable without a DB).
  2. The bucket math (zero-div safe, percentages rounded once,
     null-counts surfaced rather than silently zeroed) so the
     ratios are stable across deployments.

No DB session here — the router holds the AsyncSession. This is
the same shape v3.6's library_upload_janitor took (helper + thin
service wired into a router) which made it easy to vitest-pin.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any


def safe_pct(numerator: float | int | None, denominator: float | int | None) -> float:
    """Percentage with denominator == 0 / null returning 0.0.

    Defensive against:
      - `None` numerator (psql AVG over no rows)
      - `None` denominator (window with zero turns in this bucket)
      - Negative inputs (psql shouldn't produce them, but if a
        broken migration zaps a count column negative we don't
        want -INF percentages on the dashboard)

    Always one decimal place. Matches the convention in the
    existing `chat_path_breakdown` endpoint so the two cards on
    the dashboard align.
    """
    if numerator is None or denominator is None:
        return 0.0
    try:
        n = float(numerator)
        d = float(denominator)
    except (TypeError, ValueError):
        return 0.0
    if d <= 0 or n < 0:
        return 0.0
    return round(100.0 * n / d, 1)


def coalesce_int(value: Any) -> int:
    """Convert a psql `mappings()` cell to an int, defaulting to 0
    on `None` / non-finite values. AVG / SUM can return `None` when
    the source filter matches no rows."""
    if value is None:
        return 0
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    if n < 0:
        return 0
    return n


def coalesce_float(value: Any) -> float | None:
    """Float coercion that PRESERVES `None` so the wire payload can
    distinguish "no rows in this bucket" from "literal zero". Used
    for AVG-shaped metrics (avg_redactions_per_turn). Negative
    inputs collapse to 0.0 (defensive — same reasoning as
    safe_pct)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f < 0:
        return 0.0
    return f


def format_trust_signal_row(row: Mapping[str, Any]) -> dict[str, Any]:
    """Convert one psql aggregate row into the wire shape.

    Input row keys (from the SQL in routers/admin.py):
        bucket            : 'agent' | 'legacy' | 'unknown'
        turns             : int   — total assistant turns in bucket
        redactions_total  : int   — SUM(unverified_score_claims_redacted)
        turns_with_redaction : int — COUNT WHERE redactions > 0
        turns_with_failed_tool : int — COUNT WHERE failed_tool_calls IS NOT NULL
        turns_general_knowledge : int — COUNT WHERE is_general_knowledge IS TRUE
        turns_with_sources : int — COUNT WHERE consulted_sources IS NOT NULL
        avg_redactions    : float — AVG(unverified_score_claims_redacted)

    Output keys mirror the input + add three derived percentages
    (redaction_pct, failed_tool_pct, general_knowledge_pct,
    sourced_pct) that ops needs at a glance — they're cheap to
    derive but easy to get wrong (zero-div), so we centralise.
    """
    turns = coalesce_int(row.get("turns"))
    redactions_total = coalesce_int(row.get("redactions_total"))
    turns_with_redaction = coalesce_int(row.get("turns_with_redaction"))
    turns_with_failed_tool = coalesce_int(row.get("turns_with_failed_tool"))
    turns_general_knowledge = coalesce_int(row.get("turns_general_knowledge"))
    turns_with_sources = coalesce_int(row.get("turns_with_sources"))
    return {
        "bucket": str(row.get("bucket") or "unknown"),
        "turns": turns,
        "redactions_total": redactions_total,
        "turns_with_redaction": turns_with_redaction,
        "redaction_pct": safe_pct(turns_with_redaction, turns),
        "turns_with_failed_tool": turns_with_failed_tool,
        "failed_tool_pct": safe_pct(turns_with_failed_tool, turns),
        "turns_general_knowledge": turns_general_knowledge,
        "general_knowledge_pct": safe_pct(turns_general_knowledge, turns),
        "turns_with_sources": turns_with_sources,
        "sourced_pct": safe_pct(turns_with_sources, turns),
        "avg_redactions": coalesce_float(row.get("avg_redactions")),
    }


def build_rollup_payload(
    window_days: int,
    rows: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Top-level payload builder. Sorts buckets by turn-count desc
    so the busiest path lands first (matches the chat_path_breakdown
    convention). `window_days` is echoed into the payload for the
    dashboard's "showing last N days" header."""
    formatted = [format_trust_signal_row(r) for r in rows]
    formatted.sort(key=lambda r: r["turns"], reverse=True)
    totals = _aggregate_totals(formatted)
    return {
        "window_days": int(window_days),
        "rows": formatted,
        "totals": totals,
    }


def _aggregate_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Sum across buckets so the dashboard has a single overall
    line. Percentages are RECOMPUTED from the summed counts (NOT
    averaged) so weighting reflects bucket size correctly."""
    turns = sum(r["turns"] for r in rows)
    redactions_total = sum(r["redactions_total"] for r in rows)
    turns_with_redaction = sum(r["turns_with_redaction"] for r in rows)
    turns_with_failed_tool = sum(r["turns_with_failed_tool"] for r in rows)
    turns_general_knowledge = sum(r["turns_general_knowledge"] for r in rows)
    turns_with_sources = sum(r["turns_with_sources"] for r in rows)
    return {
        "turns": turns,
        "redactions_total": redactions_total,
        "redaction_pct": safe_pct(turns_with_redaction, turns),
        "failed_tool_pct": safe_pct(turns_with_failed_tool, turns),
        "general_knowledge_pct": safe_pct(turns_general_knowledge, turns),
        "sourced_pct": safe_pct(turns_with_sources, turns),
    }
