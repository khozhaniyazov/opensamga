"""Insert parsed egovreader.kz ENT rows into `mock_questions` + embed.

Inputs : backend/scripts/egovreader_dump/*.jsonl  (from scrape_egovreader.py)

Source column value: 'egovreader'.
Idempotent via ON CONFLICT (content_hash). Embeds only source='egovreader'
rows where question_embedding IS NULL.

This mirrors ingest_sdamgia.py almost exactly — same invariants, same
DashScope text-embedding-v4 batch-of-10 embedding, same ASCII-only output.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

import asyncpg  # noqa: E402

from app.services.qwen_dashscope import embed_texts  # noqa: E402

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/unt_platform",
)
DUMP_DIR = REPO / "backend" / "scripts" / "egovreader_dump"


_WS_RE = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip()).lower()


def _hash(question: str, options: dict[str, str]) -> str:
    keys = sorted(options)
    opts_joined = "|".join(f"{k}:{_norm(options[k])}" for k in keys)
    h = hashlib.sha256()
    h.update(_norm(question).encode("utf-8"))
    h.update(b"||")
    h.update(opts_joined.encode("utf-8"))
    return h.hexdigest()[:40]


def _difficulty(question: str, explanation: str | None) -> str:
    q_len = len(question or "")
    has_expl = bool(explanation)
    if q_len > 180 or has_expl:
        return "HARD"
    if q_len >= 60:
        return "MEDIUM"
    return "EASY"


def to_db_row(src: dict[str, Any]) -> dict[str, Any] | None:
    opts = src.get("options") or {}
    if len(opts) < 3:
        return None
    question = (src.get("question") or "").strip()
    if len(question) < 8:
        return None
    correct = src.get("correct_letter")
    if not correct or correct not in opts:
        return None

    subject = src["subject"]
    topic_tag = src.get("topic_tag") or f"{subject} > egovreader"

    return {
        "subject": subject,
        "grade": None,
        "language": src.get("language", "ru"),
        "source": "egovreader",
        "source_url": src["source_url"],
        "content_hash": _hash(question, opts),
        "topic_tag": topic_tag,
        "question_text": question,
        "options_json": json.dumps(opts, ensure_ascii=False),
        "correct_answer": correct,
        "difficulty": _difficulty(question, src.get("explanation")),
    }


INSERT_SQL = """
INSERT INTO mock_questions
    (subject, grade, language, source, source_url, content_hash,
     topic_tag, question_text, options, correct_answer, difficulty)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9::json, $10, $11)
ON CONFLICT (content_hash) DO NOTHING
RETURNING id
"""


EMBED_UPDATE_SQL = """
UPDATE mock_questions SET question_embedding = $1::vector
 WHERE id = $2
"""


async def _insert(conn: asyncpg.Connection, rows: list[dict[str, Any]]) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for r in rows:
        new_id = await conn.fetchval(
            INSERT_SQL,
            r["subject"],
            r["grade"],
            r["language"],
            r["source"],
            r["source_url"],
            r["content_hash"],
            r["topic_tag"],
            r["question_text"],
            r["options_json"],
            r["correct_answer"],
            r["difficulty"],
        )
        if new_id is not None:
            out.append((new_id, r["question_text"]))
    return out


async def _embed_only_new(conn: asyncpg.Connection, max_rows: int) -> int:
    rows = await conn.fetch(
        """
        SELECT id, question_text FROM mock_questions
         WHERE source = 'egovreader'
           AND question_embedding IS NULL
         ORDER BY id
         LIMIT $1
    """,
        max_rows,
    )
    if not rows:
        return 0
    pairs = [(r["id"], r["question_text"]) for r in rows]
    MAX_CHARS = 2000
    n = 0
    for i in range(0, len(pairs), 10):
        batch = pairs[i : i + 10]
        texts = [(p[1] or "")[:MAX_CHARS] or "(empty)" for p in batch]
        try:
            vectors = await asyncio.to_thread(embed_texts, texts)
        except Exception as e:
            print(f"  embed ERR batch {i}:{i + 10}: {e!r}")
            continue
        for (row_id, _), vec in zip(batch, vectors, strict=False):
            vec_lit = "[" + ",".join(f"{v:.6f}" for v in vec) + "]"
            await conn.execute(EMBED_UPDATE_SQL, vec_lit, row_id)
            n += 1
        if n % 100 == 0 or i == 0:
            print(f"  embedded {n}/{len(pairs)}")
    return n


async def run(dump_dir: Path, limit: int | None, skip_embed: bool, dry_run: bool) -> None:
    files = sorted(dump_dir.glob("*.jsonl"))
    print(f"scanning {len(files)} JSONL files under {dump_dir}")

    payload: list[dict[str, Any]] = []
    by_subject: Counter = Counter()
    seen_hash: set[str] = set()
    drop = Counter()
    read = 0
    for p in files:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            read += 1
            try:
                src = json.loads(line)
            except Exception:
                drop["bad_json"] += 1
                continue
            row = to_db_row(src)
            if row is None:
                drop["failed_to_db_row"] += 1
                continue
            if row["content_hash"] in seen_hash:
                drop["in_file_dupe_hash"] += 1
                continue
            seen_hash.add(row["content_hash"])
            payload.append(row)
            by_subject[(row["subject"], row["language"])] += 1
            if limit and len(payload) >= limit:
                break
        if limit and len(payload) >= limit:
            break

    print(f"rows_read:      {read}")
    print(f"drop_reasons:   {dict(drop)}")
    print(f"payload_size:   {len(payload)}")
    print("by subject:")
    for (s, l), n in sorted(by_subject.items()):
        print(f"  {s:<28} {l} {n}")

    if dry_run:
        print("DRY RUN: not inserting")
        return

    conn = await asyncpg.connect(DSN)
    try:
        before = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        print(f"rows before:    {before}")

        new_pairs: list[tuple[int, str]] = []
        BATCH = 250
        for i in range(0, len(payload), BATCH):
            part = payload[i : i + BATCH]
            pairs = await _insert(conn, part)
            new_pairs.extend(pairs)
        print(f"new inserts:    {len(new_pairs)}")

        after = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        print(f"rows after:     {after}  (+{after - before})")

        if skip_embed:
            print("--skip-embed: not embedding")
        else:
            missing_count = await conn.fetchval(
                "SELECT COUNT(*) FROM mock_questions "
                "WHERE source='egovreader' AND question_embedding IS NULL"
            )
            print(f"to embed:       {missing_count}")
            n = await _embed_only_new(conn, missing_count)
            print(f"embedded:       {n}")

        # Final breakdown
        print("\n=== mock_questions by (subject, language, source) ===")
        rows = await conn.fetch("""
            SELECT subject, language, source, COUNT(*) c
              FROM mock_questions
             GROUP BY subject, language, source
             ORDER BY subject, language, source
        """)
        for r in rows:
            print(f"  {r['subject']:<28} {r['language']:<3} {r['source']:<16} {r['c']:>6}")
        total = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        embedded = await conn.fetchval(
            "SELECT COUNT(*) FROM mock_questions WHERE question_embedding IS NOT NULL"
        )
        print(f"\nTOTAL: {total}  embedded: {embedded}")
    finally:
        await conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-dir", default=str(DUMP_DIR))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--skip-embed", action="store_true")
    ap.add_argument(
        "--dry-run", action="store_true", help="Parse and summarize but don't write to DB"
    )
    args = ap.parse_args()
    asyncio.run(run(Path(args.dump_dir), args.limit, args.skip_embed, args.dry_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
