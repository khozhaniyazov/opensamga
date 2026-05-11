"""Regression tests for `ai_orchestrator.optimize_rag_query`.

These tests pin down two defects that silently poisoned RAG quality:

* The previous implementation piped the raw LLM completion straight into
  the embedding layer. Several failover providers (gpt-5.2, qwen3.5,
  minimax) prefix their reply with a `<think> … </think>` chain-of-thought
  block. That block was being *embedded* as the search query, which is why
  "квадратные уравнения дискриминант" turned into
  "<think>The user is asking about…</think>" at the DB layer.
* With `max_tokens=200` the reasoning block routinely consumed the entire
  budget, leaving an empty completion and thus an empty query string.

The fix lives in `ai_orchestrator._strip_reasoning_output` +
`optimize_rag_query` (bumped budget, strip, fallback).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ai_orchestrator import _strip_reasoning_output, optimize_rag_query

# ---------------------------------------------------------------------------
# Pure helper — no I/O
# ---------------------------------------------------------------------------


def test_strip_reasoning_removes_balanced_block():
    raw = "<think>The user asks about X. Let me think…</think>\n\nquadratic equation discriminant formula"
    assert _strip_reasoning_output(raw) == "quadratic equation discriminant formula"


def test_strip_reasoning_removes_unterminated_block():
    # Models that hit max_tokens mid-thought leave the block open. We must
    # still scrub it so nothing from the reasoning reaches the embedder.
    raw = "<think>The user asks about quadratic eq"
    assert _strip_reasoning_output(raw) == ""


def test_strip_reasoning_noop_on_plain_text():
    assert (
        _strip_reasoning_output("дискриминант квадратного уравнения формула")
        == "дискриминант квадратного уравнения формула"
    )


def test_strip_reasoning_case_insensitive():
    raw = "<THINK>musings</THINK>\nreal query"
    assert _strip_reasoning_output(raw) == "real query"


def test_strip_reasoning_handles_none_and_empty():
    assert _strip_reasoning_output("") == ""
    assert _strip_reasoning_output(None) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# End-to-end optimize_rag_query with a mocked LLM client
# ---------------------------------------------------------------------------


def _mock_completion(content: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class _MockAsyncClient:
    def __init__(self, content: str):
        self._content = content
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(
                create=AsyncMock(return_value=_mock_completion(self._content))
            )
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_optimize_rag_query_scrubs_think_block(monkeypatch):
    """Simulates a failover model emitting <think>…</think> + answer."""
    from app.utils import cache as cache_mod

    # Force cache miss and don't persist.
    monkeypatch.setattr(cache_mod.cache, "get", AsyncMock(return_value=None))
    monkeypatch.setattr(cache_mod.cache, "set", AsyncMock(return_value=None))

    mock_completion = (
        "<think>\nThe user is asking about quadratic equations and the "
        "discriminant. I should rewrite this as a textbook keyword query…\n</think>\n\n"
        "дискриминант квадратного уравнения формула"
    )

    with patch(
        "app.services.ai_orchestrator.AsyncOpenAIFailoverClient",
        return_value=_MockAsyncClient(mock_completion),
    ):
        out = await optimize_rag_query(
            "Как решать квадратные уравнения через дискриминант?", language="ru"
        )

    assert "<think>" not in out
    assert "</think>" not in out
    assert out == "дискриминант квадратного уравнения формула"


@pytest.mark.asyncio
async def test_optimize_rag_query_falls_back_when_only_think(monkeypatch):
    """If the model's reply is *nothing but* a reasoning block (i.e. the
    real answer got truncated), fall back to the original user query
    rather than embedding an empty string."""
    from app.utils import cache as cache_mod

    monkeypatch.setattr(cache_mod.cache, "get", AsyncMock(return_value=None))
    monkeypatch.setattr(cache_mod.cache, "set", AsyncMock(return_value=None))

    original = "Как решать квадратные уравнения через дискриминант?"

    with patch(
        "app.services.ai_orchestrator.AsyncOpenAIFailoverClient",
        return_value=_MockAsyncClient("<think>still thinking"),
    ):
        out = await optimize_rag_query(original, language="ru")

    assert out == original


@pytest.mark.asyncio
async def test_optimize_rag_query_uses_cache_on_hit(monkeypatch):
    """Cached values must still be returned verbatim (no double-strip)."""
    from app.utils import cache as cache_mod

    monkeypatch.setattr(cache_mod.cache, "get", AsyncMock(return_value="cached_optimized_query"))
    set_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(cache_mod.cache, "set", set_mock)

    with patch("app.services.ai_orchestrator.AsyncOpenAIFailoverClient") as mc:
        out = await optimize_rag_query("irrelevant", language="ru")

    assert out == "cached_optimized_query"
    # LLM must not have been called on a cache hit.
    mc.assert_not_called()
    set_mock.assert_not_called()
