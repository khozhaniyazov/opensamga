"""Populate `textbook_chunks.chunk_embedding_ml` using the multilingual
MiniLM encoder.

Reads rows in deterministic id order, batches them, writes back with
`UPDATE ... FROM (VALUES ...)`.  Safe to interrupt and resume: picks
up from the first NULL row every run.

Usage:
    # full corpus (~36k rows, ~25 min on CPU):
    python backend/scripts/reembed_multilingual.py

    # limit subset (useful for smoke / dry-run):
    python backend/scripts/reembed_multilingual.py --limit 500

    # only subjects matching a pattern:
    python backend/scripts/reembed_multilingual.py --subject-like "%Mathematics%"

The writer uses a single pgvector-formatted bracketed-list per row; a
parameterised VALUES block keeps the query small even for batch=128.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.services.vector_search import (  # noqa: E402
    get_multilingual_embedding_model,
)


def _to_vec_literal(vec) -> str:
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


async def reembed(
    limit: int | None,
    subject_like: str | None,
    batch_size: int,
    log_every: int,
) -> int:
    model = get_multilingual_embedding_model()

    where_clauses = ["tc.chunk_embedding_ml IS NULL"]
    params: dict[str, object] = {}
    if subject_like:
        where_clauses.append("t.subject ILIKE :subj")
        params["subj"] = subject_like

    where_sql = " AND ".join(where_clauses)

    fetch_sql = (
        "SELECT tc.id, tc.content FROM textbook_chunks tc "
        "JOIN textbooks t ON t.id = tc.textbook_id "
        f"WHERE {where_sql} "
        "ORDER BY tc.id ASC "
        "LIMIT :batch"
    )

    total_total_sql = (
        "SELECT COUNT(*) FROM textbook_chunks tc "
        "JOIN textbooks t ON t.id = tc.textbook_id "
        f"WHERE {where_sql}"
    )

    async with AsyncSessionLocal() as session:
        remaining = (await session.execute(text(total_total_sql), params)).scalar() or 0
        target = min(remaining, limit) if limit else remaining

    print(f"rows to re-embed: {target} (total null: {remaining})")
    if target == 0:
        return 0

    processed = 0
    t0 = time.time()

    while processed < target:
        async with AsyncSessionLocal() as session:
            this_batch = min(batch_size, target - processed)
            params_q = dict(params, batch=this_batch)
            rows = (await session.execute(text(fetch_sql), params_q)).fetchall()
            if not rows:
                break

            ids = [r[0] for r in rows]
            contents = [r[1] or "" for r in rows]
            vectors = model.encode(
                contents,
                batch_size=min(32, len(contents)),
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )

            # One-row-per-execute keeps the SQL compilation simple and
            # avoids asyncpg parameter-type inference on mixed (int,
            # vector) VALUES tuples. Batches of 128 still go end-to-end
            # in milliseconds per batch because the model forward is
            # the hot path.
            update_sql = text(
                "UPDATE textbook_chunks "
                "SET chunk_embedding_ml = CAST(:vec AS vector) "
                "WHERE id = :cid"
            )
            for cid, vec in zip(ids, vectors, strict=False):
                await session.execute(
                    update_sql,
                    {"cid": int(cid), "vec": _to_vec_literal(vec.tolist())},
                )
            await session.commit()

            processed += len(ids)
            if processed % log_every == 0 or processed >= target:
                elapsed = time.time() - t0
                rate = processed / max(elapsed, 1e-6)
                eta = (target - processed) / max(rate, 1e-6)
                print(f"  progress: {processed}/{target}  rate={rate:.1f}/s  eta={int(eta)}s")

    print(f"done: {processed} rows embedded in {int(time.time() - t0)}s")
    return processed


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument(
        "--subject-like", type=str, default=None, help="SQL ILIKE pattern for Textbook.subject"
    )
    p.add_argument("--batch-size", type=int, default=128)
    p.add_argument("--log-every", type=int, default=256)
    args = p.parse_args()

    asyncio.run(
        reembed(
            limit=args.limit,
            subject_like=args.subject_like,
            batch_size=args.batch_size,
            log_every=args.log_every,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
