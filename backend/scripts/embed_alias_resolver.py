"""Embedding-based univision alias resolver.

Swaps the lexical SequenceMatcher/token-ratio approach for DashScope
text-embedding-v4 cosine similarity. The lexical approach collapsed
because both sides share generic tokens ("университет", "институт",
"имени", etc.) — every low-conf guess ended up at "Международный
университет туризма и гостеприимства" by coincidence.

Strategy:
 1. Load the 27 low-confidence univision names from
    uni_name_aliases_v2.json["still_manual"].
 2. Pull the full candidate pool: university_details.full_name
    (ALL of them, not just unmatched — we might land on one already
    claimed by another univision name but that's fine, we're finding
    the closest DB row).
 3. Embed all candidate `full_name`s + search_keywords once.
 4. Embed each of the 27 univision names.
 5. For each univision name, compute cosine vs every candidate, emit
    top-3 with scores.
 6. Classify:
     - accept if top-1 cosine >= 0.80 AND margin over top-2 >= 0.05
     - review if top-1 >= 0.70 (promising, needs human eye)
     - reject otherwise (truly not in DB)
 7. Write uni_name_aliases_v3.json with the auto-accepted + a manual
    review list.

All Cyrillic stays on disk; tool output is ASCII-flag summary only.
"""

import os
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.qwen_dashscope import embed_texts

ROOT = Path(os.environ.get("UNT_PLATFORM_ROOT", "."))
IN = ROOT / "tmp_scripts" / "session_2026-04-21" / "uni_name_aliases_v2.json"
OUT = ROOT / "tmp_scripts" / "session_2026-04-21" / "uni_name_aliases_v3.json"


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb + 1e-12)


def embed_in_batches(texts, batch=10):
    out = []
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        out.extend(embed_texts(chunk))
        time.sleep(0.2)
    return out


async def main():
    data = json.loads(IN.read_text(encoding="utf-8"))
    manual = data.get("still_manual", [])
    print(f"manual_count = {len(manual)}")

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT id, full_name, search_keywords, university_code "
                    "FROM university_details ORDER BY id"
                )
            )
        ).fetchall()

    candidates = []
    corpus_texts = []
    for r in rows:
        fn = r[1] or ""
        kw = r[2] or ""
        # Combine into a single embedding input so partial-matches
        # through search_keywords still contribute.
        combined = fn + (" | " + kw if kw else "")
        candidates.append(
            {
                "id": r[0],
                "full_name": fn,
                "keywords": kw,
                "code": r[3],
            }
        )
        corpus_texts.append(combined[:1500])  # v4 has 8192 tok cap; safe

    print(f"candidates_count = {len(candidates)}")

    t0 = time.time()
    corpus_vecs = embed_in_batches(corpus_texts, batch=10)
    print(f"corpus_embeds_ok = {len(corpus_vecs)}  elapsed_s = {int(time.time() - t0)}")

    q_texts = [m["univision_name"] for m in manual]
    t0 = time.time()
    q_vecs = embed_in_batches(q_texts, batch=10)
    print(f"query_embeds_ok  = {len(q_vecs)}  elapsed_s = {int(time.time() - t0)}")

    results = []
    for uv_name, qv in zip(q_texts, q_vecs, strict=False):
        scored = [(cosine(qv, cv), i) for i, cv in enumerate(corpus_vecs)]
        scored.sort(reverse=True)
        top3 = []
        for s, i in scored[:3]:
            top3.append(
                {
                    "id": candidates[i]["id"],
                    "full_name": candidates[i]["full_name"],
                    "score": round(s, 4),
                }
            )
        results.append({"univision_name": uv_name, "top3": top3})

    # Classify
    accept, review, reject = {}, [], []
    for r in results:
        top = r["top3"]
        if not top:
            reject.append(r)
            continue
        s1 = top[0]["score"]
        s2 = top[1]["score"] if len(top) > 1 else 0.0
        margin = s1 - s2
        if s1 >= 0.80 and margin >= 0.05:
            accept[r["univision_name"]] = top[0]["full_name"]
        elif s1 >= 0.70:
            review.append({**r, "margin": round(margin, 4)})
        else:
            reject.append({**r, "margin": round(margin, 4)})

    OUT.write_text(
        json.dumps(
            {
                "method": "dashscope text-embedding-v4 cosine",
                "thresholds": {"accept_top1": 0.80, "accept_margin": 0.05, "review_top1": 0.70},
                "accepted_aliases": accept,
                "review": review,
                "rejected": reject,
                "raw_results": results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(f"accepted_count = {len(accept)}")
    print(f"review_count   = {len(review)}")
    print(f"rejected_count = {len(reject)}")


asyncio.run(main())
