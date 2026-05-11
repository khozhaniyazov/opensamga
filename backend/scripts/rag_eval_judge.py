"""
Session-16 (2026-04-21) — LLM-as-judge grader for the RAG answer layer.

Reads `backend/scripts/data/rag_eval_set.json`, runs every query end-to-
end through the *answer* path (ai_orchestrator.consult_library ->
search_library_chunks -> top snippets concatenated), then asks
qwen-max to grade each answer against its ground truth (keyphrases +
expected subject/grade).

Output JSON schema (per query):
  {
    "id": "bio-01",
    "n_hits": 5,
    "top1_subject": "...",
    "top1_grade": 9,
    "judge": {
        "score": 0..5,           # 5 = perfect, 0 = fabricated or empty
        "grounded": true/false,  # is the answer supported by retrieved snippets
        "on_subject": true/false,
        "reason": "short sentence"
    }
  }

Summary printed to stdout with pass-rate (judge.score >= 4) and grounded-
rate. Safety-filter rule: raw Cyrillic content is NEVER printed to the
assistant's tool channel — all summaries are ASCII counts/averages.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.services import library_retrieval as LR  # noqa: E402

EVAL_JSON = Path(__file__).parent / "data" / "rag_eval_set.json"
OUT_JSON = Path(__file__).parent / "data" / "rag_eval_judge_report.json"

# Session 16 post-mortem: `settings.OPENAI_BASE_URL` in this repo points
# at Minimax (it serves the chat model), NOT DashScope. The grader must
# hit a real Qwen endpoint to deliver a useful verdict, so we prefer the
# DashScope-specific env vars and fall back to the known-good mainland
# host. Override order: JUDGE_BASE_URL / JUDGE_API_KEY env vars, then
# DASHSCOPE_API_KEY, then the project default.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "qwen-max")
BASE_URL = (
    os.environ.get("JUDGE_BASE_URL")
    or os.environ.get("DASHSCOPE_BASE_URL")
    or "https://dashscope.aliyuncs.com/compatible-mode/v1"
).rstrip("/")


def _resolve_api_key() -> str:
    """Return a whitespace-stripped API key.

    Session 19 (2026-04-21): trailing spaces from `.env` or a
    `set VAR=value &` shell invocation were leaking into the
    Authorization header and httpx rejected them with
    `LocalProtocolError: Illegal header value`. Some sources
    (pydantic `SecretStr`) are not plain strings, so handle those too.
    """
    for source in (
        os.environ.get("JUDGE_API_KEY"),
        os.environ.get("DASHSCOPE_API_KEY"),
        getattr(settings, "OPENAI_API_KEY", None),
    ):
        if not source:
            continue
        if hasattr(source, "get_secret_value"):
            source = source.get_secret_value()
        candidate = str(source).strip()
        if candidate:
            return candidate
    return ""


API_KEY = _resolve_api_key()

JUDGE_SYSTEM_PROMPT = (
    "You are a strict, terse grader for a Kazakhstani high-school RAG "
    "tutor. Given a student question, a list of retrieved textbook "
    "snippets, and a ground-truth rubric (expected subject, minimum "
    "grade, expected keyphrases), return a JSON object ONLY (no prose) "
    "with fields: score (int 0-5), grounded (bool), on_subject (bool), "
    "reason (short English sentence). Rules:\n"
    "  - grounded = true only if the snippets contain the facts that "
    "    directly answer the question.\n"
    "  - on_subject = true only if the retrieved snippets belong to the "
    "    expected subject area.\n"
    "  - score: 5 = perfect, 4 = minor gap, 3 = partial, 2 = weak, "
    "    1 = mostly off-topic, 0 = empty / wrong subject / fabricated.\n"
    "  - reason: one short English sentence, ASCII only.\n"
)


def _sanitize(s: str) -> str:
    """Strip control characters that some PDF-derived chunks carry. The
    HTTP layer treats certain control bytes (form feed, NUL, vertical
    tab) as protocol errors even inside a JSON body for some clients.
    """
    if not s:
        return ""
    return "".join(c for c in s if c == "\n" or c == "\t" or 0x20 <= ord(c) < 0x10000)


def build_user_prompt(q: dict[str, Any], hits: list[dict[str, Any]]) -> str:
    snippets = []
    for i, h in enumerate(hits[:5], 1):
        body = _sanitize(h.get("snippet") or h.get("content") or "")[:900]
        snippets.append(
            f"[{i}] subject={h.get('subject')} grade={h.get('grade')} "
            f"page={h.get('page_number')}\n"
            f"{body}"
        )
    rubric = {
        "expected_subject": q.get("expected_subject"),
        "expected_grade_min": q.get("expected_grade_min"),
        "keyphrases": q.get("keyphrases", []),
    }
    return (
        f"QUESTION:\n{q['q']}\n\n"
        f"RETRIEVED_SNIPPETS ({len(hits)} hits):\n"
        + ("\n\n".join(snippets) if snippets else "(none)")
        + f"\n\nRUBRIC:\n{json.dumps(rubric, ensure_ascii=False)}\n\n"
        "Return JSON only."
    )


# Session 17 (2026-04-21): reusing a single AsyncClient across 60 Qwen
# calls reliably tripped httpx.LocalProtocolError partway through
# (probably a stale connection / server-side close). Opening a fresh
# client per request is negligibly slower at 60 queries and is bullet-
# proof.
async def judge_one(
    _unused_client: httpx.AsyncClient | None,
    q: dict[str, Any],
    hits: list[dict[str, Any]],
) -> dict[str, Any]:
    payload = {
        "model": JUDGE_MODEL,
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(q, hits)},
        ],
        "temperature": 0.0,
        # DashScope compat-mode accepts response_format for qwen-max;
        # keep it so the grader output is parseable.
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as fresh:
        r = await fresh.post(f"{BASE_URL}/chat/completions", json=payload, headers=headers)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Fall back to a best-effort JSON sniff — qwen-max sometimes
        # wraps the object in ```json``` fences.
        import re

        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError:
                parsed = {
                    "score": 0,
                    "grounded": False,
                    "on_subject": False,
                    "reason": "judge returned non-JSON",
                }
        else:
            parsed = {
                "score": 0,
                "grounded": False,
                "on_subject": False,
                "reason": "judge returned non-JSON",
            }
    return parsed


async def main():
    eval_set = json.loads(EVAL_JSON.read_text(encoding="utf-8"))
    print(f"queries={len(eval_set)}  judge_model={JUDGE_MODEL}  rerank={settings.RAG_USE_RERANKER}")

    report: list[dict[str, Any]] = []
    async with AsyncSessionLocal() as db:
        for q in eval_set:
            hits = await LR.search_library_chunks(
                db,
                q["q"],
                subject=q.get("subject"),
                limit=5,
                snippet_limit=600,
                log_query=False,
            )
            try:
                verdict = await judge_one(None, q, hits)
            except Exception as exc:
                import traceback

                detail = f"{type(exc).__name__}: {str(exc)[:200]}"
                sys.stderr.write(
                    f"\n---- judge error {q['id']} ----\n" + traceback.format_exc() + "\n"
                )
                verdict = {
                    "score": 0,
                    "grounded": False,
                    "on_subject": False,
                    "reason": f"judge error: {detail}",
                }
            row = {
                "id": q["id"],
                "n_hits": len(hits),
                "top1_subject": hits[0].get("subject") if hits else None,
                "top1_grade": hits[0].get("grade") if hits else None,
                "judge": verdict,
            }
            report.append(row)
            # ASCII-only summary line
            print(
                f"{q['id']:<10} hits={len(hits):>2} "
                f"score={verdict.get('score', '?'):<2} "
                f"grounded={'Y' if verdict.get('grounded') else 'N'} "
                f"subj={'Y' if verdict.get('on_subject') else 'N'}",
                flush=True,
            )
            # Session 18 (2026-04-21): flush the report after every row
            # so a timeout / lid-close never loses completed judgements.
            OUT_JSON.write_text(
                json.dumps(report, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    n = len(report)
    pass4 = sum(1 for r in report if (r["judge"].get("score") or 0) >= 4)
    grounded = sum(1 for r in report if r["judge"].get("grounded"))
    onsubj = sum(1 for r in report if r["judge"].get("on_subject"))
    avg = sum((r["judge"].get("score") or 0) for r in report) / max(n, 1)

    print("\n=== Judge summary ===")
    print(f"n        = {n}")
    print(f"avg_score= {avg:.2f}")
    print(f"pass@>=4 = {pass4}/{n} ({100 * pass4 / max(n, 1):.1f}%)")
    print(f"grounded = {grounded}/{n} ({100 * grounded / max(n, 1):.1f}%)")
    print(f"on_subj  = {onsubj}/{n} ({100 * onsubj / max(n, 1):.1f}%)")
    print(f"report   = {OUT_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
