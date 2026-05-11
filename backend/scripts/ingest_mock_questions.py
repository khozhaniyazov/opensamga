"""Normalize + embed + insert scraped / generated questions into `mock_questions`.

Inputs  : `backend/scripts/ymnik_dump/*.jsonl`   (shape defined by scrape_ymnik.py)
          `backend/scripts/generated_dump/*.jsonl` (future, same shape)

Output  : rows in `public.mock_questions`, idempotent by `content_hash`.

Pipeline
--------
1. Load all JSONL rows, compute a normalized content_hash
   (SHA-256 of lower-cased, whitespace-collapsed question + options).
2. Drop exact in-file dupes (hash).
3. Detect subject from scraper slug → canonical UNT subject name
   (see SUBJECT_CANONICAL below).
4. Detect language from the scraper tag (ru|kz).
5. Cheap heuristic difficulty:
    - question < 60 chars        → EASY
    - 60 <= question <= 180      → MEDIUM
    - > 180 chars or has passage → HARD
6. Skip rows that:
    - have no `correct_letters`   (the 8 subjects where ymnik hides the
      answer — those go through an LLM pass later)
    - are `format == 'multi'`     (multi-correct: keep them but mark
      correct_answer as "A,C" etc.; chat/UI expects single for now)
    - have < 3 options
7. Idempotent upsert via `ON CONFLICT (content_hash) DO NOTHING`.
8. Embed question_text with DashScope text-embedding-v4 (1024-dim)
   in batches of 10, update freshly-inserted rows.

Summary printed at the end: rows_read, rows_dropped{reason}, rows_inserted,
rows_embedded, by-subject breakdown.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

# Ensure backend root on path
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

import asyncio  # noqa: E402

import asyncpg  # noqa: E402

from app.services.qwen_dashscope import embed_texts  # noqa: E402

# Canonical UNT subject names (must match app.constants.subjects). We
# map ymnik.kz slugs → canonical.
SUBJECT_CANONICAL: dict[str, str] = {
    "mathematical-literacy": "Mathematical Literacy",
    "reading-literacy": "Reading Literacy",
    "history-of-Kazakhstan": "History of Kazakhstan",
    "biology": "Biology",
    "geography": "Geography",
    "maths": "Mathematics",
    "native-language": "Kazakh Literature",
    "physics": "Physics",
    "world-history": "World History",
    "english": "English",
    "German": "German",
    "French": "French",
    "chemistry": "Chemistry",
    "human-society-right": "Human Society Right",
}


DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/unt_platform",
)


# ---------- hashing / normalization ----------

_WS_RE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS_RE.sub(" ", (text or "").strip()).lower()


def compute_hash(question: str, options: dict[str, str]) -> str:
    opts_joined = "|".join(f"{k}:{_normalize(options[k])}" for k in sorted(options))
    h = hashlib.sha256()
    h.update(_normalize(question).encode("utf-8"))
    h.update(b"||")
    h.update(opts_joined.encode("utf-8"))
    return h.hexdigest()[:40]


def guess_difficulty(row: dict[str, Any]) -> str:
    q_len = len(row.get("question") or "")
    if row.get("passage") or q_len > 180:
        return "HARD"
    if q_len >= 60:
        return "MEDIUM"
    return "EASY"


def is_keepable(row: dict[str, Any]) -> tuple[bool, str]:
    """Return (ok, reason_if_drop)."""
    opts = row.get("options") or {}
    non_empty_opts = {k: v for k, v in opts.items() if (v or "").strip()}
    if len(non_empty_opts) < 3:
        return (False, "too_few_options")
    # If >25% of options are empty, it's almost certainly a broken
    # (image/MathJax-only) question — drop.
    if len(opts) - len(non_empty_opts) >= 2:
        return (False, "empty_options")
    q = (row.get("question") or "").strip()
    if not q:
        return (False, "empty_question")
    if len(q) < 8:
        return (False, "question_too_short")
    correct = row.get("correct_letters") or []
    if not correct:
        return (False, "no_correct_letter")
    # Drop if correct letter points to an empty option
    if any((opts.get(letter) or "").strip() == "" for letter in correct):
        return (False, "correct_points_to_empty")
    if row.get("format") == "multi":
        return (True, "multi_ok")
    return (True, "single_ok")


# ---------- load + filter ----------


def iter_scrape_rows(paths: Iterable[Path]) -> Iterable[dict[str, Any]]:
    for p in paths:
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue


def to_insert_row(src: dict[str, Any]) -> dict[str, Any]:
    slug = src.get("subject_slug")
    canonical = SUBJECT_CANONICAL.get(slug, slug)

    opts = src.get("options") or {}
    # Options is already a dict {A..H: text}
    correct_letters = src.get("correct_letters") or []
    correct_answer = ",".join(correct_letters)

    question_text = src.get("question", "").strip()

    h = compute_hash(question_text, opts)
    topic_tag = f"{canonical} > " + ("passage" if src.get("passage") else "core")

    return {
        "subject": canonical,
        "grade": None,
        "language": src.get("lang", "ru"),
        "source": "ymnik",
        "source_url": src.get("source_url"),
        "content_hash": h,
        "topic_tag": topic_tag,
        "question_text": question_text,
        "options": json.dumps(opts, ensure_ascii=False),
        "correct_answer": correct_answer,
        "difficulty": guess_difficulty(src),
    }


# ---------- DB ops ----------


INSERT_SQL = """
INSERT INTO mock_questions
    (subject, grade, language, source, source_url, content_hash,
     topic_tag, question_text, options, correct_answer, difficulty)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9::json, $10, $11)
ON CONFLICT (content_hash) DO NOTHING
RETURNING id
"""

# Batch embed & update
EMBED_UPDATE_SQL = """
UPDATE mock_questions SET question_embedding = $1::vector
 WHERE id = $2
"""


async def _insert_batch(
    conn: asyncpg.Connection, rows: list[dict[str, Any]]
) -> list[tuple[int, str]]:
    """Insert batch; return list of (new_id, question_text) for embedding."""
    inserted: list[tuple[int, str]] = []
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
            r["options"],
            r["correct_answer"],
            r["difficulty"],
        )
        if new_id is not None:
            inserted.append((new_id, r["question_text"]))
    return inserted


async def _embed_and_attach(conn: asyncpg.Connection, pairs: list[tuple[int, str]]) -> int:
    """Embed + UPDATE in batches of 10 (DashScope limit)."""
    n = 0
    # Trim long texts (text-embedding-v4 max 8192 tokens is generous; still cap)
    MAX_CHARS = 2000
    for i in range(0, len(pairs), 10):
        batch = pairs[i : i + 10]
        texts = [p[1][:MAX_CHARS] or "(empty)" for p in batch]
        try:
            vectors = await asyncio.to_thread(embed_texts, texts)
        except Exception as e:
            print(f"[embed ERR batch {i}:{i + 10}]: {e!r}")
            continue
        for (row_id, _txt), vec in zip(batch, vectors, strict=False):
            vec_lit = "[" + ",".join(f"{v:.6f}" for v in vec) + "]"
            await conn.execute(EMBED_UPDATE_SQL, vec_lit, row_id)
            n += 1
        if n % 200 == 0 or i == 0:
            print(f"  embedded {n}/{len(pairs)}")
    return n


# ---------- main ----------


async def run(
    dump_dir: Path,
    limit: int | None,
    skip_embed: bool,
) -> None:
    stats: dict[str, Any] = {
        "rows_read": 0,
        "drop_reasons": Counter(),
        "in_file_dupes": 0,
        "by_subject": Counter(),
        "inserted": 0,
        "embedded": 0,
    }

    # Collect + dedupe within the ingest pass
    seen_hashes: set[str] = set()
    payload: list[dict[str, Any]] = []

    files = sorted(dump_dir.glob("*.jsonl"))
    print(f"=== scanning {len(files)} JSONL files under {dump_dir} ===")
    for src in iter_scrape_rows(files):
        stats["rows_read"] += 1
        ok, reason = is_keepable(src)
        if not ok:
            stats["drop_reasons"][reason] += 1
            continue
        row = to_insert_row(src)
        if row["content_hash"] in seen_hashes:
            stats["in_file_dupes"] += 1
            continue
        seen_hashes.add(row["content_hash"])
        payload.append(row)
        stats["by_subject"][(row["subject"], row["language"])] += 1
        if limit and len(payload) >= limit:
            break

    print(f"rows_read:       {stats['rows_read']}")
    print(f"dropped:         {dict(stats['drop_reasons'])}")
    print(f"in_file_dupes:   {stats['in_file_dupes']}")
    print(f"payload_size:    {len(payload)}")

    if not payload:
        print("nothing to insert; exiting")
        return

    # Insert
    conn = await asyncpg.connect(DSN)
    try:
        before = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        print(f"rows before:     {before}")

        inserted_pairs: list[tuple[int, str]] = []
        BATCH = 250
        for i in range(0, len(payload), BATCH):
            part = payload[i : i + BATCH]
            pairs = await _insert_batch(conn, part)
            inserted_pairs.extend(pairs)
            if (i // BATCH) % 4 == 0:
                print(f"  inserted {len(inserted_pairs)}/{len(payload)}")
        stats["inserted"] = len(inserted_pairs)

        after = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        print(f"rows after:      {after}  (+{after - before})")

        if skip_embed:
            print("--skip-embed: not embedding the new rows")
        else:
            # Embed rows that don't yet have an embedding (covers resumes)
            # We use inserted_pairs plus any pre-existing NULLs
            missing = await conn.fetch("""
                SELECT id, question_text FROM mock_questions
                 WHERE question_embedding IS NULL
                 ORDER BY id
            """)
            missing_pairs = [(r["id"], r["question_text"]) for r in missing]
            print(
                f"embedding {len(missing_pairs)} rows "
                f"(new+pre-existing missing) with text-embedding-v4 ..."
            )
            stats["embedded"] = await _embed_and_attach(conn, missing_pairs)
            print(f"embedded:        {stats['embedded']}")

        # Per-subject summary
        print("\n=== by (subject, language) ===")
        rows = await conn.fetch("""
            SELECT subject, language, COUNT(*) c
              FROM mock_questions
             GROUP BY subject, language
             ORDER BY c DESC
        """)
        for r in rows:
            print(f"  {r['subject']:<28} {r['language']:<3} {r['c']:>5}")

        total = await conn.fetchval("SELECT COUNT(*) FROM mock_questions")
        print(f"\nTOTAL mock_questions: {total}")
        if total >= 10_000:
            print("  ✓ 10K+ TARGET MET")
        else:
            print(f"  need {10_000 - total} more to reach 10K target")
    finally:
        await conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dump-dir",
        default="backend/scripts/ymnik_dump",
        help="Directory of *.jsonl scrape output",
    )
    ap.add_argument(
        "--limit", type=int, default=None, help="Cap number of rows to process (for smoke test)"
    )
    ap.add_argument(
        "--skip-embed", action="store_true", help="Insert rows but leave question_embedding NULL"
    )
    args = ap.parse_args()

    asyncio.run(run(Path(args.dump_dir), args.limit, args.skip_embed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
