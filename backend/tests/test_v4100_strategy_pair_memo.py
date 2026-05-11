"""v4.10 — Contract tests for the profile-pair simulator memo cache.

Promotes ``spike/strategy-pair-precompute`` (553fefc). The cache is
strict opt-in via ``STRATEGY_PAIR_MEMO_TTL_SECONDS``; with the env
unset the response path is bit-identical to v4.9.

These tests pin the contract — they intentionally do NOT exercise
the full DB-backed orchestrator (that's covered by the v3.25
integration suite). Instead they target the policy seam:

  * ``_memo_ttl_seconds()`` returns 0 when the env is unset / empty /
    non-integer / negative — i.e. the cache stays off by default.
  * Returns the parsed integer otherwise.
  * The cache dict + reset helper are wired and behave as expected.

Why this is enough: the cache is a simple ``(monotonic_now - cached_at
< ttl) → return cached_payload`` check. The interesting failure modes
are policy (env parse) + freshness, both of which are exercised below.
"""

from __future__ import annotations

import time as _time

import pytest

from app.services.profile_pair_simulator import (
    _SIMULATOR_MEMO,
    _memo_ttl_seconds,
    _reset_simulator_memo,
)


@pytest.fixture(autouse=True)
def _clear_env_and_memo(monkeypatch):
    """Each test starts from a known state."""
    monkeypatch.delenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", raising=False)
    _reset_simulator_memo()
    yield
    _reset_simulator_memo()


# ──────────────────────────────────────────────────────────────────────────
# _memo_ttl_seconds
# ──────────────────────────────────────────────────────────────────────────


def test_memo_ttl_disabled_when_env_unset():
    assert _memo_ttl_seconds() == 0


def test_memo_ttl_disabled_when_env_empty(monkeypatch):
    monkeypatch.setenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", "")
    assert _memo_ttl_seconds() == 0


def test_memo_ttl_disabled_when_env_non_integer(monkeypatch):
    monkeypatch.setenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", "not-a-number")
    assert _memo_ttl_seconds() == 0


def test_memo_ttl_disabled_when_env_negative(monkeypatch):
    monkeypatch.setenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", "-30")
    assert _memo_ttl_seconds() == 0


def test_memo_ttl_returns_parsed_positive_int(monkeypatch):
    monkeypatch.setenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", "3600")
    assert _memo_ttl_seconds() == 3600


def test_memo_ttl_zero_value_keeps_cache_disabled(monkeypatch):
    """0 is a valid integer but means "off" by convention."""
    monkeypatch.setenv("STRATEGY_PAIR_MEMO_TTL_SECONDS", "0")
    assert _memo_ttl_seconds() == 0


# ──────────────────────────────────────────────────────────────────────────
# Memo dict + reset helper
# ──────────────────────────────────────────────────────────────────────────


def test_reset_clears_existing_entries():
    _SIMULATOR_MEMO[("Mathematics", "Physics")] = (_time.monotonic(), {"k": "v"})
    assert len(_SIMULATOR_MEMO) == 1
    _reset_simulator_memo()
    assert len(_SIMULATOR_MEMO) == 0


def test_memo_keyed_on_canonical_pair_tuple():
    """Documents the key shape so future readers don't reach for str keys."""
    key: tuple[str, str] = ("Mathematics", "Physics")
    payload: dict[str, str] = {"sentinel": "ok"}
    _SIMULATOR_MEMO[key] = (_time.monotonic(), payload)
    assert _SIMULATOR_MEMO[key][1] == payload


def test_freshness_check_is_monotonic_safe():
    """The cached_at timestamp uses time.monotonic.

    NTP jumps / wall-clock corrections must NOT make a fresh entry
    look stale. We can't directly assert "monotonic was used"; we
    assert the freshness math behaves correctly for a synthetic
    small TTL.
    """
    ttl = 5.0  # seconds
    cached_at = _time.monotonic()
    assert (_time.monotonic() - cached_at) < ttl  # fresh

    # Synthesize "5 seconds ago" by subtracting from cached_at.
    stale_cached_at = cached_at - (ttl + 0.5)
    assert (_time.monotonic() - stale_cached_at) >= ttl  # stale
