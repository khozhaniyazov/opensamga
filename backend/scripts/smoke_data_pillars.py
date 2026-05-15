"""Smoke-test the three core data pillars against the live database.

This is intentionally narrower than scripts/data_health.py: it exercises
representative app paths for universities, textbook RAG, and exams after a
data repair or ingest run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.routers.exam import fetch_subject_questions
from app.services.library_retrieval import search_library_chunks
from app.services.university_search import (
    get_statistics,
    get_universities_by_score_range,
)

CONVERTED_ROOT = Path(os.environ.get("UNT_DATASET_CONVERTED", "dataset/converted_library"))
MIN_PROD_GRADE = 6

TRANSCRIPT_FOLDERS = {
    "Biology": ["Biology", "Биология"],
    "Geography": ["Geography", "География"],
    "Physics": ["Physics", "Физика"],
    "Chemistry": ["Chemistry", "Химия"],
    "Mathematics": ["Mathematics", "Математика"],
    "Informatics": ["Informatics", "Информатика"],
    "History of Kazakhstan": ["History of Kazakhstan", "История Казахстана"],
    "World History": ["World History", "Всемирная история"],
    "Kazakh Literature": ["Kazakh Literature", "Казахская литература"],
    "Kazakh Language": ["Kazakh Language", "Казахский язык"],
    "Russian Literature": ["Russian Literature", "Русская литература"],
    "Russian Language": ["Russian Language", "Русский язык"],
    "English": ["English", "Английский язык"],
    "German": ["German", "Немецкий язык"],
    "French": ["French", "Французский язык"],
}


class SmokeFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def transcript_path_for(row: dict[str, Any]) -> Path | None:
    subject = row["subject"] or ""
    grade = str(row["grade"] or 0)
    title = row["title"] or ""
    for folder in TRANSCRIPT_FOLDERS.get(subject, [subject]):
        candidate = CONVERTED_ROOT / folder / grade / f"{title}_qwen.md"
        if candidate.exists():
            return candidate
    return None


async def smoke_universities(db) -> dict[str, Any]:
    stats = await get_statistics(db)
    require(stats["total_universities"] >= 100, "university_data has too few rows")

    orphan_codes_2025 = (
        await db.execute(
            text("""
        SELECT COUNT(DISTINCT a.university_code)
          FROM acceptance_scores a
          LEFT JOIN university_details u ON u.university_code = a.university_code
         WHERE a.year = 2025 AND u.university_code IS NULL
    """)
        )
    ).scalar_one()
    require(orphan_codes_2025 == 0, "2025 acceptance_scores has orphan codes")

    general = await get_universities_by_score_range(db, score=110, quota_type="GENERAL")
    require(general, "score-range university search returned no GENERAL results")
    require(
        all(item["threshold"] is not None for item in general),
        "GENERAL score-range search returned NULL thresholds",
    )

    orphan = await get_universities_by_score_range(db, score=110, quota_type="ORPHAN")
    require(orphan == [], "ORPHAN score-range search should return no aggregate rows")

    return {
        "university_data_rows": stats["total_universities"],
        "orphan_codes_2025": orphan_codes_2025,
        "score_range_general_hits": len(general),
        "score_range_orphan_hits": len(orphan),
    }


async def smoke_books(db, *, live_rag: bool) -> dict[str, Any]:
    status_rows = (
        await db.execute(text("SELECT ocr_status, COUNT(*) FROM textbooks GROUP BY 1 ORDER BY 1"))
    ).all()
    by_status = {row[0]: row[1] for row in status_rows}
    total = sum(by_status.values())
    require(total > 0, "textbooks is empty")
    require(by_status == {"qwen_ok": total}, f"textbooks not fully qwen_ok: {by_status}")

    chunk_stats = (
        (
            await db.execute(
                text("""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE chunk_embedding IS NULL) AS null_embeddings
          FROM textbook_chunks
    """)
            )
        )
        .mappings()
        .one()
    )
    require(chunk_stats["total"] >= 50_000, "textbook_chunks unexpectedly low")
    require(chunk_stats["null_embeddings"] == 0, "textbook_chunks has NULL embeddings")

    drift = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM (
          SELECT t.id FROM textbooks t
            LEFT JOIN textbook_chunks c ON c.textbook_id = t.id
           GROUP BY t.id, t.total_chunks
          HAVING t.total_chunks IS DISTINCT FROM COUNT(c.id)
        ) q
    """)
        )
    ).scalar_one()
    require(drift == 0, "textbooks.total_chunks drift detected")

    rows = (
        (
            await db.execute(
                text("""
        SELECT id, title, subject, grade
          FROM textbooks
         WHERE ocr_status = 'qwen_ok'
         ORDER BY id
    """)
            )
        )
        .mappings()
        .all()
    )
    missing = []
    error_markers = 0
    for row in rows:
        md = transcript_path_for(row)
        if md is None:
            missing.append(f"id={row['id']} {row['subject']}/{row['grade']} {row['title']}")
            continue
        if (row["grade"] or 0) >= MIN_PROD_GRADE:
            text_body = md.read_text(encoding="utf-8", errors="replace")
            error_markers += len(re.findall(r"__OCR_ERROR__", text_body))

    require(not missing, f"missing DB-backed transcripts: {missing[:3]}")
    require(error_markers == 0, "in-scope DB-backed transcripts contain OCR errors")

    rag_hits = None
    if live_rag:
        hits = await search_library_chunks(
            db,
            "Ньютонның екінші заңы",
            subject="Physics",
            preferred_grade=11,
            limit=3,
            log_query=False,
        )
        require(hits, "live textbook RAG returned no Physics hits")
        require(
            all((hit.get("grade") or 0) >= MIN_PROD_GRADE for hit in hits),
            "live textbook RAG returned below-scope grade hits",
        )
        rag_hits = [
            {
                "book_id": hit.get("book_id"),
                "subject": hit.get("subject"),
                "grade": hit.get("grade"),
                "page": hit.get("page_number"),
            }
            for hit in hits
        ]

    return {
        "textbooks": total,
        "chunks": int(chunk_stats["total"]),
        "null_embeddings": int(chunk_stats["null_embeddings"]),
        "chunk_drift": drift,
        "in_scope_ocr_errors": error_markers,
        "live_rag_hits": rag_hits,
    }


async def smoke_exams(db) -> dict[str, Any]:
    row = (
        (
            await db.execute(
                text("""
        SELECT COUNT(*) AS total,
               COUNT(DISTINCT subject) AS subjects,
               COUNT(*) FILTER (WHERE correct_answers_indices IS NULL
                                 OR array_length(correct_answers_indices, 1) IS NULL) AS missing_answers
          FROM exam_questions
    """)
            )
        )
        .mappings()
        .one()
    )
    require(row["total"] >= 300, "exam_questions has too few rows")
    require(row["subjects"] >= 10, "exam_questions subject diversity is too low")
    require(row["missing_answers"] == 0, "exam_questions has missing answers")

    math = await fetch_subject_questions(db, "Mathematics", 40, "math")
    physics = await fetch_subject_questions(db, "Physics", 40, "physics")
    history = await fetch_subject_questions(db, "History of Kazakhstan", 20, "histKz")
    for section in (math, physics, history):
        require(section["questions"], f"exam section {section['key']} returned no questions")
        for question in section["questions"]:
            if question["format"] in {"single_choice", "multiple_choice", "context"}:
                require(question.get("options"), f"{question['id']} missing options")
                require(question.get("correctIds"), f"{question['id']} missing correctIds")

    mock = (
        (
            await db.execute(
                text("""
        SELECT COUNT(*) AS total,
               COUNT(DISTINCT subject) AS subjects,
               COUNT(*) FILTER (WHERE question_embedding IS NULL) AS null_embeddings
          FROM mock_questions
    """)
            )
        )
        .mappings()
        .one()
    )
    require(mock["total"] >= 10_000, "mock_questions below 10K target")
    require(mock["subjects"] >= 10, "mock_questions subject diversity is too low")
    require(mock["null_embeddings"] == 0, "mock_questions has NULL embeddings")

    return {
        "exam_questions": int(row["total"]),
        "exam_subjects": int(row["subjects"]),
        "math_questions": len(math["questions"]),
        "physics_questions": len(physics["questions"]),
        "history_questions": len(history["questions"]),
        "mock_questions": int(mock["total"]),
    }


async def main_async(args: argparse.Namespace) -> int:
    async with AsyncSessionLocal() as db:
        report = {
            "universities": await smoke_universities(db),
            "books": await smoke_books(db, live_rag=not args.skip_live_rag),
            "exams": await smoke_exams(db),
        }
    print(json.dumps({"overall": "PASS", **report}, ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-live-rag",
        action="store_true",
        help="skip vector-search smoke that may call the configured embedding provider",
    )
    args = parser.parse_args()
    try:
        raise SystemExit(asyncio.run(main_async(args)))
    except SmokeFailure as exc:
        # The error message is already serialized into the JSON output above;
        # `from None` suppresses the duplicate traceback so stderr stays clean.
        print(json.dumps({"overall": "FAIL", "error": str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
