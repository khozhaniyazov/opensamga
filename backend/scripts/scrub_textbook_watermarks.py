"""Scrub OKULYK-family watermark residue from textbook_chunks.

Default mode is dry-run. Use --apply to update/delete affected chunks and
re-embed changed content with the configured DashScope embedding service.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text

from app.database import engine
from app.services.qwen_dashscope import embed_texts
from app.utils.textbook_quality import (
    is_usable_textbook_content,
    normalize_textbook_snippet,
)

PATTERNS = [
    "%OKULYK.KZ%",
    "%OKULYK.COM%",
    "%OKULIK.KZ%",
    "%OKULUK.KZ%",
    "%ОКУЛУК.KZ%",
    "%ОКУУК.KZ%",
    "%ULYK.KZ%",
    "%ZULYK.KZ%",
    "%3ULYK.KZ%",
    "%Все учебники Казахстана на%",
    "%Бсе учебники Казахстана на%",
    "%Все учебники Казахстана ищите%",
    "%Всё учебник% Казах% сайт%",
    "%Без учебника% Казах% сайт%",
]


def tokenize_approx(value: str) -> int:
    return max(1, len((value or "").split()))


def hash_content(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="replace")).hexdigest()


async def load_offenders():
    query = text("""
        SELECT DISTINCT id, textbook_id, content
          FROM textbook_chunks
         WHERE content ILIKE ANY(:patterns)
         ORDER BY id
    """)
    async with engine.begin() as conn:
        rows = (await conn.execute(query, {"patterns": PATTERNS})).mappings().all()
    return rows


async def count_residue() -> dict[str, int]:
    residual: dict[str, int] = {}
    async with engine.begin() as conn:
        for pattern in PATTERNS:
            value = (
                await conn.execute(
                    text("SELECT COUNT(*) FROM textbook_chunks WHERE content ILIKE :pattern"),
                    {"pattern": pattern},
                )
            ).scalar_one()
            residual[pattern] = int(value or 0)
    return {pattern: count for pattern, count in residual.items() if count}


async def apply_updates(updates, deletes, batch_size: int) -> None:
    affected_books = {row["textbook_id"] for row in updates}
    affected_books.update(row["textbook_id"] for row in deletes)

    async with engine.begin() as conn:
        if deletes:
            await conn.execute(
                text("DELETE FROM textbook_chunks WHERE id = ANY(:ids)"),
                {"ids": [row["id"] for row in deletes]},
            )

    for start in range(0, len(updates), batch_size):
        batch = updates[start : start + batch_size]
        embeddings = await asyncio.to_thread(
            embed_texts,
            [row["new_content"] for row in batch],
        )
        async with engine.begin() as conn:
            for row, embedding in zip(batch, embeddings, strict=False):
                vec = "[" + ",".join(f"{float(v):.6f}" for v in embedding) + "]"
                await conn.execute(
                    text("""
                    UPDATE textbook_chunks
                       SET content = :content,
                           token_count = :token_count,
                           content_hash = :content_hash,
                           chunk_embedding = CAST(:embedding AS vector)
                     WHERE id = :id
                """),
                    {
                        "id": row["id"],
                        "content": row["new_content"],
                        "token_count": tokenize_approx(row["new_content"]),
                        "content_hash": hash_content(row["new_content"]),
                        "embedding": vec,
                    },
                )

    if affected_books:
        async with engine.begin() as conn:
            await conn.execute(
                text("""
                UPDATE textbooks t
                   SET total_chunks = counts.n,
                       updated_at = now()
                  FROM (
                    SELECT textbook_id, COUNT(*) AS n
                      FROM textbook_chunks
                     WHERE textbook_id = ANY(:ids)
                     GROUP BY textbook_id
                  ) counts
                 WHERE t.id = counts.textbook_id
            """),
                {"ids": sorted(affected_books)},
            )


async def main_async(args: argparse.Namespace) -> int:
    offenders = await load_offenders()
    updates = []
    deletes = []
    unchanged = 0
    for row in offenders:
        cleaned = normalize_textbook_snippet(row["content"])
        if not is_usable_textbook_content(cleaned):
            deletes.append(row)
            continue
        if cleaned == row["content"]:
            unchanged += 1
            continue
        updates.append({**row, "new_content": cleaned})

    print(f"mode: {'apply' if args.apply else 'dry-run'}")
    print(f"offending_chunks: {len(offenders)}")
    print(f"updates: {len(updates)}")
    print(f"deletes: {len(deletes)}")
    print(f"unchanged_after_normalize: {unchanged}")

    if args.apply and (updates or deletes):
        await apply_updates(updates, deletes, args.embed_batch)

    residual = await count_residue()
    print(f"residual_patterns: {residual}")
    return 1 if residual and args.apply else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--embed-batch", type=int, default=10)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
