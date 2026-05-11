"""DashScope (Alibaba Qwen) client adapters for OCR + embeddings.

The official DashScope OpenAI-compatible endpoint lets us hit all of:
 - qwen-vl-ocr-latest        vision -> text
 - text-embedding-v4         multilingual 1024-dim embeddings
 - qwen3-reranker / gte-rerank  (used in library_retrieval when the
                                RAG_USE_RERANKER flag is on)

Configured via env vars:
  DASHSCOPE_API_KEY     (required)
  DASHSCOPE_BASE_URL    (default the standard compatible-mode endpoint)
  DASHSCOPE_OCR_MODEL   (default qwen-vl-ocr-latest)
  DASHSCOPE_EMBED_MODEL (default text-embedding-v4)

Usage:
    from app.services.qwen_dashscope import (
        ocr_image_bytes, embed_texts, dashscope_client,
    )

All functions are synchronous - the caller can wrap in
asyncio.to_thread() if needed.
"""

from __future__ import annotations

import base64
import logging
import os
from collections.abc import Sequence

from openai import OpenAI

logger = logging.getLogger(__name__)


def _settings_fallback_key() -> str | None:
    """Fall back to pydantic settings if envvars are not populated."""
    try:
        from app.config import settings

        val = getattr(settings, "DASHSCOPE_API_KEY", None)
        if val and hasattr(val, "get_secret_value"):
            return val.get_secret_value()
        return val
    except Exception:
        return None


def _api_key() -> str:
    key = (
        os.environ.get("DASHSCOPE_API_KEY")
        or os.environ.get("QWEN_API_KEY")
        or _settings_fallback_key()
    )
    if not key:
        raise RuntimeError(
            "DASHSCOPE_API_KEY is not set. The Qwen OCR + embedding pipeline requires it."
        )
    # Session 19 (2026-04-21): defensively strip whitespace. A trailing
    # space in .env or in a `set VAR=value &` shell invocation leaked
    # directly into the `Authorization: Bearer <key>` header which httpx
    # then rejected with `LocalProtocolError: Illegal header value`,
    # crashing the judge-LLM harness on the first request.
    return str(key).strip()


def _base_url() -> str:
    url = os.environ.get("DASHSCOPE_BASE_URL")
    if url:
        return url
    try:
        from app.config import settings

        val = getattr(settings, "DASHSCOPE_BASE_URL", None)
        if val:
            return val
    except Exception:
        pass
    return "https://dashscope.aliyuncs.com/compatible-mode/v1"


_CLIENT: OpenAI | None = None


def dashscope_client() -> OpenAI:
    global _CLIENT
    if _CLIENT is None:
        timeout = float(os.environ.get("DASHSCOPE_TIMEOUT", "180"))
        _CLIENT = OpenAI(api_key=_api_key(), base_url=_base_url(), timeout=timeout)
    return _CLIENT


OCR_SYSTEM_PROMPT = (
    "You are a precise OCR engine for a Kazakhstani school textbook page. "
    "The page contains Russian or Kazakh body text and may include math, "
    "chemistry or physics formulas, tables, captions and diagrams. "
    "Transcribe every line of body text verbatim, in reading order. "
    "Preserve Cyrillic letters (including Kazakh-specific characters "
    "at U+04D9, U+0456, U+04A3, U+0493, U+04AF, U+04B1, U+049B, U+04E9, "
    "U+04BB). "
    "Preserve chemical formulas and mathematical notation exactly, "
    "including sub/superscripts, arrows and greek letters. "
    "Do NOT translate. Do NOT summarise. Do NOT add markdown, code "
    "fences, or commentary. Return only the page text as plain UTF-8. "
    "If the page is effectively blank or is a decorative cover, "
    "respond with the single token BLANK_PAGE."
)


def ocr_image_bytes(
    png_bytes: bytes,
    *,
    model: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 0.0,
    extra_hint: str | None = None,
) -> str:
    """Run qwen-vl-ocr-latest on a single page PNG.

    `extra_hint` can be 'chemistry', 'mathematics', 'history' etc.
    and is appended to the system prompt as a weak hint.
    """
    client = dashscope_client()
    model = model or os.environ.get("DASHSCOPE_OCR_MODEL", "qwen-vl-ocr-latest")

    prompt = OCR_SYSTEM_PROMPT
    if extra_hint:
        prompt = prompt + f"\n\nHint: this page is from a {extra_hint} textbook."

    b64 = base64.b64encode(png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": "Transcribe this page."},
                ],
            },
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


def embed_texts(
    texts: Sequence[str],
    *,
    model: str | None = None,
    dimensions: int = 1024,
) -> list[list[float]]:
    """Batch-embed a list of texts with text-embedding-v4.

    Note: DashScope's text-embedding-v4 max batch is 10 inputs per call
    and max 8192 input tokens per string. Caller must respect those.
    """
    if not texts:
        return []
    client = dashscope_client()
    model = model or os.environ.get("DASHSCOPE_EMBED_MODEL", "text-embedding-v4")
    r = client.embeddings.create(
        model=model,
        input=list(texts),
        dimensions=dimensions,
        encoding_format="float",
    )
    return [d.embedding for d in r.data]


def embed_text(text: str, **kwargs) -> list[float]:
    return embed_texts([text], **kwargs)[0]


# -----------------------------------------------------------------
# Reranker
# -----------------------------------------------------------------


def _rerank_raw(
    query: str,
    documents: Sequence[str],
    *,
    model: str | None = None,
    top_n: int | None = None,
) -> list[dict]:
    """Call the DashScope rerank endpoint and return the raw response
    items. Each item has `{index, relevance_score, document?}`.

    DashScope exposes rerank models on a dedicated path
    `/services/rerank/text-rerank/text-rerank` rather than the
    OpenAI-compatible endpoint. We post via requests here to keep the
    openai-python client scope unchanged.
    """
    import requests

    model = model or os.environ.get("DASHSCOPE_RERANKER_MODEL", "gte-rerank")
    api_key = _api_key()
    # Default to the mainland DashScope endpoint; the -intl host requires a
    # separate account and rejects China-region keys with HTTP 401.
    url = os.environ.get(
        "DASHSCOPE_RERANK_URL",
        "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    )
    payload = {
        "model": model,
        "input": {
            "query": query,
            "documents": list(documents),
        },
        "parameters": {
            "return_documents": False,
        },
    }
    if top_n:
        payload["parameters"]["top_n"] = top_n

    r = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    # output can be under `output.results` or `output.scores` depending on model.
    out = body.get("output") or {}
    return out.get("results") or out.get("scores") or []


def rerank(
    query: str,
    documents: Sequence[str],
    *,
    top_n: int | None = None,
    model: str | None = None,
) -> list[int]:
    """Return indices of `documents` sorted by rerank relevance (highest
    first). Falls back to input order if the call fails.
    """
    if not documents:
        return []
    try:
        items = _rerank_raw(query, documents, model=model, top_n=top_n)
        if not items:
            logger.warning(
                "rerank returned empty payload for %d candidates "
                "(model=%s) — falling back to input order; RAG quality "
                "will degrade until upstream is fixed",
                len(documents),
                model or "<default>",
            )
            return list(range(len(documents)))
        # Sort by relevance_score desc if present.
        items.sort(key=lambda it: -float(it.get("relevance_score", 0.0)))
        return [int(it["index"]) for it in items]
    except Exception as exc:
        logger.warning(
            "rerank call failed for %d candidates (model=%s): %s — "
            "falling back to input order; RAG quality will degrade "
            "until upstream is fixed",
            len(documents),
            model or "<default>",
            exc,
        )
        return list(range(len(documents)))
