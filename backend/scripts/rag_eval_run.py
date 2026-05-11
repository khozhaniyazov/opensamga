"""
Session-15 RAG eval harness — cosine-only vs cosine+rerank.

Input : tmp_scripts/session_2026-04-21/rag_eval_set.json  (list of queries)
Output: tmp_scripts/session_2026-04-21/rag_eval_report.json
        + ASCII summary on stdout

Metric:
  * subject_match @k  — at least one of top-k hits has subject == expected
  * grade_ok      @k  — at least one of top-k hits has grade >= expected_grade_min
  * keyphrase     @k  — at least one listed keyphrase appears in top-k content
                         (case-insensitive, partial substring against a stem)

Safety-filter rule: content/title are NEVER printed raw; summaries only.
"""

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.config import settings
from app.database import AsyncSessionLocal
from app.services import library_retrieval as LR

EVAL_JSON = Path(__file__).parent / "data" / "rag_eval_set.json"
OUT_JSON = Path(__file__).parent / "data" / "rag_eval_report.json"


def contains_any(haystack: str, needles: list[str]) -> bool:
    h = (haystack or "").lower()
    return any(n.lower() in h for n in needles)


async def run_one(db, q: dict, rerank: bool, k: int = 5):
    settings.RAG_USE_RERANKER = rerank
    t0 = time.perf_counter()
    hits = await LR.search_library_chunks(
        db,
        q["q"],
        subject=q.get("subject"),
        limit=k,
        snippet_limit=300,
        log_query=False,  # don't pollute prod log
    )
    dur_ms = int((time.perf_counter() - t0) * 1000)
    return hits, dur_ms


def score(hits, q, k):
    top = hits[:k]
    subj_hit = any(
        (h.get("subject") or "").lower() == (q.get("expected_subject") or "").lower() for h in top
    )
    min_grade = q.get("expected_grade_min") or 0
    grade_hit = any((h.get("grade") or 0) >= min_grade for h in top)
    kp = q.get("keyphrases") or []
    blob = " ".join((h.get("content") or h.get("snippet") or "") for h in top)
    kp_hit = contains_any(blob, kp) if kp else True
    return subj_hit, grade_hit, kp_hit


async def main():
    eval_set = json.loads(EVAL_JSON.read_text(encoding="utf-8"))
    print(f"queries={len(eval_set)}  reranker_baseline={settings.RAG_USE_RERANKER}")

    report = {"queries": [], "modes": {}}

    async with AsyncSessionLocal() as db:
        for mode_label, flag in [("cosine", False), ("rerank", True)]:
            mode = {
                "n": 0,
                "subj@1": 0,
                "grade@1": 0,
                "kp@1": 0,
                "subj@5": 0,
                "grade@5": 0,
                "kp@5": 0,
                "latency_sum_ms": 0,
                "empty": 0,
            }
            for q in eval_set:
                hits, dur_ms = await run_one(db, q, rerank=flag, k=5)
                mode["n"] += 1
                mode["latency_sum_ms"] += dur_ms
                if not hits:
                    mode["empty"] += 1
                    continue
                s1, g1, k1 = score(hits, q, 1)
                s5, g5, k5 = score(hits, q, 5)
                mode["subj@1"] += int(s1)
                mode["grade@1"] += int(g1)
                mode["kp@1"] += int(k1)
                mode["subj@5"] += int(s5)
                mode["grade@5"] += int(g5)
                mode["kp@5"] += int(k5)
                if mode_label == "cosine":
                    report["queries"].append(
                        {
                            "id": q["id"],
                            "subj_expected": q.get("expected_subject"),
                            "cosine_top1_subject": hits[0].get("subject"),
                            "cosine_top1_grade": hits[0].get("grade"),
                        }
                    )
                else:
                    for row in report["queries"]:
                        if row["id"] == q["id"]:
                            row["rerank_top1_subject"] = hits[0].get("subject")
                            row["rerank_top1_grade"] = hits[0].get("grade")
                            row["changed_top1"] = row["cosine_top1_subject"] != hits[0].get(
                                "subject"
                            ) or row["cosine_top1_grade"] != hits[0].get("grade")
                            break
            report["modes"][mode_label] = mode

    # ASCII summary
    def pct(num, den):
        return f"{(100.0 * num / den):5.1f}%" if den else "   n/a"

    print("\n=== RAG eval summary ===")
    print(
        f"{'mode':<10} {'n':>3} {'subj@1':>7} {'grade@1':>8} {'kp@1':>6} "
        f"{'subj@5':>7} {'grade@5':>8} {'kp@5':>6} {'avg_ms':>8}"
    )
    for label in ("cosine", "rerank"):
        m = report["modes"][label]
        print(
            f"{label:<10} {m['n']:>3} "
            f"{pct(m['subj@1'], m['n']):>7} {pct(m['grade@1'], m['n']):>8} {pct(m['kp@1'], m['n']):>6} "
            f"{pct(m['subj@5'], m['n']):>7} {pct(m['grade@5'], m['n']):>8} {pct(m['kp@5'], m['n']):>6} "
            f"{(m['latency_sum_ms'] / max(m['n'], 1)):>8.0f}"
        )

    changed = sum(1 for row in report["queries"] if row.get("changed_top1"))
    print(f"\ntop-1 moved by reranker: {changed} / {len(report['queries'])}")

    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nreport written: {OUT_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
