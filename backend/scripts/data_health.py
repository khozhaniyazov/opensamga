"""Data-health one-shot CLI (session 22c extension, 2026-04-22).

Prints a clean ASCII health-check of every user-facing DB surface:
users, exam_attempts, chat_threads/messages, textbooks, textbook_chunks,
universities, acceptance_scores, major_groups, historical_grant_thresholds.

Each section emits a PASS/WARN/FAIL verdict and concrete remediation
commands. Designed to be runnable in CI, by a dev after a fresh pull,
or by an admin after an ingest run.

Usage:
    python scripts/data_health.py
    python scripts/data_health.py --json   # machine-readable
    python scripts/data_health.py --strict # exit 1 on any WARN or FAIL

All stdout is ASCII-safe (no Cyrillic), so this is safe to run from
any terminal / CI log.
"""

from __future__ import annotations
import os

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

# Make `backend/` importable so `from app...` works when run from
# `backend/` or from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.services.university_admission_minimums import official_paid_min_score  # noqa: E402

# ---------- verdict helpers -----------------------------------------

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"


class Section:
    def __init__(self, name: str) -> None:
        self.name = name
        self.checks: list[tuple[str, str, str]] = []  # (label, verdict, msg)
        self.metrics: dict[str, Any] = {}

    def add(self, label: str, verdict: str, msg: str = "") -> None:
        self.checks.append((label, verdict, msg))

    def worst(self) -> str:
        order = {PASS: 0, WARN: 1, FAIL: 2}
        return max((v for _, v, _ in self.checks), key=lambda v: order[v], default=PASS)


# ---------- section runners -----------------------------------------


async def check_users(db) -> Section:
    s = Section("users")
    n = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar_one()
    s.metrics["total"] = n
    if n == 0:
        s.add("row_count", FAIL, "users table is empty")
    elif n < 3:
        s.add("row_count", WARN, f"only {n} users (looks like a fresh DB)")
    else:
        s.add("row_count", PASS, f"{n} users")
    return s


async def check_exam_attempts(db) -> Section:
    s = Section("exam_attempts")
    n = (await db.execute(text("SELECT COUNT(*) FROM exam_attempts"))).scalar_one()
    s.metrics["total"] = n

    # subject-naming convention sniffing
    rows = (
        await db.execute(
            text("SELECT UNNEST(subjects) AS tok, COUNT(*) FROM exam_attempts GROUP BY 1")
        )
    ).fetchall()
    tokens = [(r[0], r[1]) for r in rows]
    s.metrics["subject_tokens"] = tokens

    camel = title = snake = 0
    for tok, _ in tokens:
        if not tok:
            continue
        if "_" in tok:
            snake += 1
        elif tok[0].isupper() and not any(ch.isupper() for ch in tok[1:]):
            title += 1
        elif tok[0].islower() and any(ch.isupper() for ch in tok[1:]):
            camel += 1
    conventions_in_use = sum(1 for x in (camel, title, snake) if x > 0)
    s.metrics["conventions_in_use"] = conventions_in_use

    if conventions_in_use <= 1:
        s.add("subject_naming", PASS, "single convention in use")
    else:
        s.add(
            "subject_naming",
            WARN,
            f"{conventions_in_use} naming conventions coexist "
            f"(camel={camel} title={title} snake={snake}); "
            "canonicalize via services/subject_normalize.py",
        )
    return s


async def check_chat(db) -> Section:
    s = Section("chat")
    n_threads = (await db.execute(text("SELECT COUNT(*) FROM chat_threads"))).scalar_one()
    n_msgs = (await db.execute(text("SELECT COUNT(*) FROM chat_messages"))).scalar_one()
    s.metrics["threads"] = n_threads
    s.metrics["messages"] = n_msgs

    # Orphan messages with NON-NULL thread_id that doesn't exist
    n_orph = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM chat_messages m
         WHERE m.thread_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = m.thread_id)
    """)
        )
    ).scalar_one()
    s.metrics["truly_orphan_messages"] = n_orph

    # Legacy "main chat" bucket (pre-threads, thread_id IS NULL) - expected, not an orphan
    n_legacy = (
        await db.execute(text("SELECT COUNT(*) FROM chat_messages WHERE thread_id IS NULL"))
    ).scalar_one()
    s.metrics["legacy_null_thread_messages"] = n_legacy

    if n_orph > 0:
        s.add(
            "message_fk_integrity",
            FAIL,
            f"{n_orph} chat_messages rows reference a missing thread_id",
        )
    else:
        s.add("message_fk_integrity", PASS, "no orphan thread references")

    if n_legacy > 0:
        s.add(
            "legacy_main_chat",
            PASS,
            f"{n_legacy} pre-threads messages in the legacy NULL-thread bucket (expected)",
        )

    return s


async def check_textbooks(db) -> Section:
    s = Section("textbooks")
    rows = (
        await db.execute(
            text("SELECT ocr_status, COUNT(*) FROM textbooks GROUP BY 1 ORDER BY 2 DESC")
        )
    ).fetchall()
    by_ocr = {r[0]: r[1] for r in rows}
    total = sum(by_ocr.values())
    s.metrics["total"] = total
    s.metrics["by_ocr_status"] = by_ocr

    ok = by_ocr.get("qwen_ok", 0)
    pend = by_ocr.get("pending", 0)
    failed = by_ocr.get("failed", 0)

    if total == 0:
        s.add("total", FAIL, "textbooks is empty")
        return s

    pct = ok / max(total, 1) * 100
    if pct >= 90:
        s.add("ocr_coverage", PASS, f"{ok}/{total} books qwen_ok ({pct:.0f}%)")
    elif pct >= 70:
        s.add("ocr_coverage", WARN, f"{ok}/{total} books qwen_ok ({pct:.0f}%)")
    else:
        s.add("ocr_coverage", FAIL, f"only {ok}/{total} books qwen_ok ({pct:.0f}%)")

    if failed > 0:
        ids = (
            await db.execute(
                text(
                    "SELECT id, subject, grade FROM textbooks WHERE ocr_status='failed' ORDER BY id"
                )
            )
        ).fetchall()
        pretty = ", ".join(f"id={r[0]}({r[1]}/{r[2]})" for r in ids)
        s.add(
            "ocr_failures",
            WARN,
            f"{failed} book(s) stuck at ocr_status='failed': {pretty}; "
            "retry via qwen_ingest.py --only-book <path>",
        )

    if pend > 0:
        s.add(
            "ocr_pending",
            PASS if pend <= 5 else WARN,
            f"{pend} book(s) pending (normal if an ingest shard is running)",
        )

    # total_chunks drift - see p1_total_chunks_drift.py
    drift = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM (
          SELECT t.id FROM textbooks t
            LEFT JOIN textbook_chunks tc ON tc.textbook_id = t.id
           GROUP BY t.id, t.total_chunks
          HAVING t.total_chunks IS DISTINCT FROM COUNT(tc.id)
        ) q
    """)
        )
    ).scalar_one()
    s.metrics["total_chunks_drift"] = drift
    if drift == 0:
        s.add(
            "total_chunks_consistency",
            PASS,
            "textbooks.total_chunks matches COUNT(textbook_chunks)",
        )
    else:
        s.add(
            "total_chunks_consistency",
            WARN,
            f"{drift} book(s) have textbooks.total_chunks != actual; "
            "re-run tmp_scripts/session_2026-04-22/p1_repair_total_chunks.py --apply",
        )

    return s


async def check_textbook_chunks(db) -> Section:
    s = Section("textbook_chunks")
    total = (await db.execute(text("SELECT COUNT(*) FROM textbook_chunks"))).scalar_one()
    s.metrics["total"] = total

    if total == 0:
        s.add("total", FAIL, "textbook_chunks is empty")
        return s

    # NULL embedding?
    n_null = (
        await db.execute(text("SELECT COUNT(*) FROM textbook_chunks WHERE chunk_embedding IS NULL"))
    ).scalar_one()
    s.metrics["null_embeddings"] = n_null
    if n_null == 0:
        s.add("embedding_coverage", PASS, "no NULL embeddings")
    else:
        s.add(
            "embedding_coverage",
            FAIL,
            f"{n_null} chunks missing chunk_embedding; re-run embed step",
        )

    # Orphan textbook_id?
    n_orph = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM textbook_chunks c
         WHERE NOT EXISTS (SELECT 1 FROM textbooks t WHERE t.id = c.textbook_id)
    """)
        )
    ).scalar_one()
    s.metrics["orphan_textbook_id"] = n_orph
    if n_orph == 0:
        s.add("fk_integrity", PASS, "no orphan textbook_id")
    else:
        s.add("fk_integrity", FAIL, f"{n_orph} chunks reference missing textbooks")

    return s


async def check_universities(db) -> Section:
    s = Section("universities")
    n_details = (await db.execute(text("SELECT COUNT(*) FROM university_details"))).scalar_one()
    s.metrics["university_details_total"] = n_details

    duplicate_names = (
        await db.execute(
            text("""
        SELECT COUNT(*)
          FROM (
            SELECT full_name
              FROM university_details
             WHERE full_name IS NOT NULL AND btrim(full_name) <> ''
             GROUP BY full_name
            HAVING COUNT(*) > 1
          ) dup
    """)
        )
    ).scalar_one()
    s.metrics["duplicate_university_names"] = duplicate_names
    if duplicate_names == 0:
        s.add("duplicate_university_names", PASS, "no duplicate university detail names")
    else:
        s.add(
            "duplicate_university_names",
            FAIL,
            f"{duplicate_names} duplicate university detail name(s); run scripts/repair_university_data_depth.py --commit",
        )

    # 2025 orphan coverage
    n_orph_2025 = (
        await db.execute(
            text("""
        SELECT COUNT(DISTINCT a.university_code)
          FROM acceptance_scores a
          LEFT JOIN university_details u ON u.university_code = a.university_code
         WHERE a.year = 2025 AND u.university_code IS NULL
    """)
        )
    ).scalar_one()
    s.metrics["orphan_codes_2025"] = n_orph_2025

    if n_orph_2025 == 0:
        s.add("orphan_2025_codes", PASS, "every 2025 acceptance_scores row joins to a university")
    else:
        s.add(
            "orphan_2025_codes",
            FAIL,
            f"{n_orph_2025} orphan university_code(s) in 2025 acceptance_scores; "
            "re-run tmp_scripts/session_2026-04-22/backfill_orphan_unis_apply.py --apply",
        )

    # 2025 present at all?
    n_2025 = (
        await db.execute(text("SELECT COUNT(*) FROM acceptance_scores WHERE year = 2025"))
    ).scalar_one()
    s.metrics["acceptance_scores_2025"] = n_2025
    if n_2025 < 500:
        s.add("freshness", WARN, f"only {n_2025} acceptance_scores rows for 2025")
    else:
        s.add("freshness", PASS, f"{n_2025} acceptance_scores rows for 2025")

    missing_2025_pairs = (
        await db.execute(
            text("""
        SELECT COUNT(*)
          FROM (
            SELECT DISTINCT d.full_name, a.major_code
              FROM acceptance_scores a
              JOIN university_details d ON d.university_code = a.university_code
              JOIN major_groups mg ON mg.group_code = a.major_code
              LEFT JOIN university_data ud
                ON ud.uni_name = d.full_name AND ud.major_code = a.major_code
             WHERE a.year = 2025
               AND a.major_code LIKE 'B%'
               AND ud.id IS NULL
          ) missing
    """)
        )
    ).scalar_one()
    s.metrics["missing_2025_acceptance_pairs_in_university_data"] = missing_2025_pairs
    if missing_2025_pairs == 0:
        s.add(
            "acceptance_catalog_coverage",
            PASS,
            "all 2025 bachelor acceptance pairs have university_data rows",
        )
    else:
        s.add(
            "acceptance_catalog_coverage",
            FAIL,
            f"{missing_2025_pairs} 2025 acceptance pair(s) missing from university_data; "
            "run scripts/repair_university_data_depth.py --commit",
        )

    # thresholds coverage
    n_thr = (
        await db.execute(text("SELECT COUNT(*) FROM historical_grant_thresholds"))
    ).scalar_one()
    s.metrics["historical_grant_thresholds"] = n_thr
    if n_thr < 1000:
        s.add("thresholds", WARN, f"historical_grant_thresholds has only {n_thr} rows")
    else:
        s.add("thresholds", PASS, f"{n_thr} threshold rows")

    bad_thresholds = (
        await db.execute(
            text("""
        SELECT COUNT(*)
          FROM historical_grant_thresholds
         WHERE min_score IS NULL
            OR min_score <= 0
            OR btrim(COALESCE(uni_name, '')) IN ('', '0', 'Творческий экзамен')
    """)
        )
    ).scalar_one()
    s.metrics["bad_historical_threshold_rows"] = bad_thresholds
    if bad_thresholds == 0:
        s.add("historical_threshold_sentinels", PASS, "no zero/invalid historical threshold rows")
    else:
        s.add(
            "historical_threshold_sentinels",
            FAIL,
            f"{bad_thresholds} invalid historical threshold row(s); run scripts/repair_university_data_depth.py --commit",
        )

    zero_grant_counts = (
        (
            await db.execute(
                text("""
        SELECT
          (SELECT COUNT(*) FROM acceptance_scores WHERE grants_awarded = 0) AS acceptance_zero,
          (SELECT COUNT(*) FROM historical_grant_thresholds WHERE grants_awarded_count = 0) AS historical_zero
    """)
            )
        )
        .mappings()
        .one()
    )
    s.metrics["acceptance_zero_grants_awarded"] = zero_grant_counts["acceptance_zero"]
    s.metrics["historical_zero_grants_awarded_count"] = zero_grant_counts["historical_zero"]
    if zero_grant_counts["acceptance_zero"] == 0 and zero_grant_counts["historical_zero"] == 0:
        s.add("grant_count_zero_sentinels", PASS, "grant-count unknowns are NULL, not 0")
    else:
        s.add(
            "grant_count_zero_sentinels",
            FAIL,
            f"{zero_grant_counts['acceptance_zero']} acceptance and "
            f"{zero_grant_counts['historical_zero']} historical grant-count row(s) still use 0",
        )

    empty_student_splits = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM university_details
         WHERE total_students > 0
           AND grant_students = 0
           AND paid_students = 0
    """)
        )
    ).scalar_one()
    s.metrics["detail_empty_student_splits"] = empty_student_splits
    if empty_student_splits == 0:
        s.add("student_split_sentinels", PASS, "no positive-total rows have zero grant/paid split")
    else:
        s.add(
            "student_split_sentinels",
            FAIL,
            f"{empty_student_splits} university detail row(s) have positive total but zero grant/paid split",
        )

    ud_sentinels = (
        (
            await db.execute(
                text("""
        SELECT
          COUNT(*) FILTER (WHERE city IS NULL OR btrim(city) = '' OR city = '0') AS missing_city,
          COUNT(*) FILTER (WHERE tuition_per_year = 0) AS zero_tuition,
          COUNT(*) FILTER (WHERE tuition_per_year IS NULL OR tuition_per_year <= 0) AS unknown_tuition
        FROM university_data
    """)
            )
        )
        .mappings()
        .one()
    )
    s.metrics["university_data_missing_city"] = ud_sentinels["missing_city"]
    s.metrics["university_data_zero_tuition"] = ud_sentinels["zero_tuition"]
    s.metrics["university_data_unknown_tuition"] = ud_sentinels["unknown_tuition"]
    if ud_sentinels["missing_city"] == 0:
        s.add("city_coverage", PASS, "all university_data rows have a city")
    else:
        s.add(
            "city_coverage",
            FAIL,
            f"{ud_sentinels['missing_city']} university_data row(s) missing city",
        )

    if ud_sentinels["zero_tuition"] == 0:
        s.add(
            "tuition_zero_sentinel",
            PASS,
            f"no zero tuition sentinel; {ud_sentinels['unknown_tuition']} row(s) remain unknown/null",
        )
    else:
        s.add(
            "tuition_zero_sentinel",
            FAIL,
            f"{ud_sentinels['zero_tuition']} tuition row(s) are 0 sentinel; run scripts/repair_university_data_depth.py --commit",
        )

    min_rows = (
        (
            await db.execute(
                text("""
        SELECT uni_name, major_code, min_score_paid
          FROM university_data
         WHERE major_code IS NOT NULL
    """)
            )
        )
        .mappings()
        .all()
    )
    below_official = [
        row
        for row in min_rows
        if row["min_score_paid"] is None
        or row["min_score_paid"] <= 0
        or row["min_score_paid"] < official_paid_min_score(row["uni_name"], row["major_code"])
    ]
    s.metrics["min_score_paid_below_official_floor"] = len(below_official)
    if not below_official:
        s.add("min_score_paid_floor", PASS, "paid minimum scores meet official 2025 floors")
    else:
        s.add(
            "min_score_paid_floor",
            FAIL,
            f"{len(below_official)} paid minimum score row(s) are missing/below official floor",
        )

    # short_name coverage (s22c hardening)
    has_col = (
        await db.execute(
            text("""
        SELECT 1 FROM information_schema.columns
         WHERE table_name='university_details' AND column_name='short_name'
    """)
        )
    ).scalar_one_or_none()
    if not has_col:
        s.add(
            "short_name_column",
            FAIL,
            "short_name column missing; run alembic upgrade head (s22c_uni_details_hardening)",
        )
    else:
        pop = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM university_details "
                    " WHERE short_name IS NOT NULL AND short_name <> ''"
                )
            )
        ).scalar_one()
        s.metrics["short_name_populated"] = pop
        if pop == n_details:
            s.add("short_name_coverage", PASS, f"{pop}/{n_details} rows have short_name")
        else:
            s.add(
                "short_name_coverage",
                WARN,
                f"{pop}/{n_details} rows have short_name; re-run "
                "tmp_scripts/session_2026-04-22/backfill_short_names.py --apply",
            )

    # UNIQUE constraint on university_code
    uq = (
        await db.execute(
            text("""
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'university_details'::regclass
           AND conname = 'uq_university_details_university_code'
    """)
        )
    ).scalar_one_or_none()
    if uq:
        s.add("unique_university_code", PASS, "UNIQUE constraint present")
    else:
        s.add(
            "unique_university_code",
            FAIL,
            "uq_university_details_university_code missing; run "
            "alembic upgrade head (s22c_uni_details_hardening)",
        )

    return s


async def check_ocr_content_integrity(db) -> Section:
    """Scan on-disk qwen transcripts for __OCR_ERROR__ markers.

    A book is healthy iff its _qwen.md file contains <= 2% errored pages.
    This catches the class of failure exposed during session-22c where
    a book is marked ocr_status='qwen_ok' but its transcript is riddled
    with DashScope 20MB data-URI rejections / timeouts - so the DB has
    far fewer chunks than the book's real page count.

    Thresholds (in-scope books only, g>=MIN_PROD_GRADE):
      <=2%     -> PASS (connection blips tolerated)
      2-10%    -> WARN (investigate)
      >10%     -> FAIL (re-ingest at lower DPI)

    Out-of-scope books (g<MIN_PROD_GRADE) are counted in metrics but
    never drive WARN/FAIL verdicts. This mirrors library_retrieval.py,
    which keeps grade 6+ in the pool for UNT-prep users.
    """
    import re
    from pathlib import Path

    MIN_PROD_GRADE = 6  # same as library_retrieval.py's UNT grade floor

    s = Section("ocr_content_integrity")
    root = Path(os.environ.get("UNT_DATASET_CONVERTED", "dataset/converted_library"))
    if not root.exists():
        s.add("converted_library", WARN, f"{root} not found - cannot audit OCR transcripts")
        return s

    page_re = re.compile(r"^## Page (\d+)\s*$", re.M)
    err_re = re.compile(r"__OCR_ERROR__", re.M)

    # Some transcripts predate qwen_ingest.py subject canonicalization
    # and still live under Cyrillic folders. Audit live DB textbooks,
    # with legacy folder fallbacks, instead of every abandoned markdown
    # artifact on disk.
    transcript_folders = {
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

    def transcript_path_for(row) -> Path | None:
        subject = row["subject"] or ""
        grade = str(row["grade"] or 0)
        title = row["title"] or ""
        folders = transcript_folders.get(subject, [subject])
        for folder in folders:
            candidate = root / folder / grade / f"{title}_qwen.md"
            if candidate.exists():
                return candidate
        return None

    total_pages = 0
    total_errs = 0
    in_scope_clean = 0
    in_scope_warn: list[str] = []
    in_scope_fail: list[str] = []
    out_of_scope_issues: list[str] = []
    missing_in_scope: list[str] = []
    missing_out_of_scope: list[str] = []

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

    for row in rows:
        md = transcript_path_for(row)
        g = int(row["grade"] or 0)
        if md is None:
            label = f"id={row['id']} {row['subject']}/{row['grade']} {row['title']}"
            if g < MIN_PROD_GRADE:
                missing_out_of_scope.append(label)
            else:
                missing_in_scope.append(label)
            continue
        try:
            txt = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        n_pages = len(page_re.findall(txt))
        n_errs = len(err_re.findall(txt))
        if n_pages == 0:
            continue
        total_pages += n_pages
        total_errs += n_errs
        pct = n_errs / n_pages
        rel = md.relative_to(root).as_posix()
        if g < MIN_PROD_GRADE:
            if pct > 0.10:
                out_of_scope_issues.append(f"{rel} ({n_errs}/{n_pages} = {pct:.0%}, g{g})")
            continue
        if pct <= 0.02:
            in_scope_clean += 1
        elif pct <= 0.10:
            in_scope_warn.append(f"{rel} ({n_errs}/{n_pages} = {pct:.0%})")
        else:
            in_scope_fail.append(f"{rel} ({n_errs}/{n_pages} = {pct:.0%})")

    scanned_in_scope = in_scope_clean + len(in_scope_warn) + len(in_scope_fail)
    s.metrics["scanned_in_scope_books"] = scanned_in_scope
    s.metrics["in_scope_clean"] = in_scope_clean
    s.metrics["in_scope_warn_books"] = in_scope_warn
    s.metrics["in_scope_fail_books"] = in_scope_fail
    s.metrics["out_of_scope_issues"] = out_of_scope_issues
    s.metrics["missing_in_scope_transcripts"] = missing_in_scope
    s.metrics["missing_out_of_scope_transcripts"] = missing_out_of_scope
    s.metrics["total_pages"] = total_pages
    s.metrics["total_error_pages"] = total_errs
    s.metrics["min_prod_grade"] = MIN_PROD_GRADE

    pct_errs = total_errs / max(total_pages, 1) * 100
    s.add(
        "global_error_rate_all_grades",
        PASS if pct_errs <= 5 else WARN,
        f"{total_errs}/{total_pages} pages errored across all grades ({pct_errs:.1f}%)",
    )

    if in_scope_fail:
        preview = ", ".join(in_scope_fail[:3])
        more = "" if len(in_scope_fail) <= 3 else f" (+{len(in_scope_fail) - 3} more)"
        s.add(
            "in_scope_books_above_10pct",
            FAIL,
            f"{len(in_scope_fail)} in-scope (g>={MIN_PROD_GRADE}) book(s) "
            f"need re-ingest at lower DPI: {preview}{more}",
        )
    if in_scope_warn:
        preview = ", ".join(in_scope_warn[:3])
        more = "" if len(in_scope_warn) <= 3 else f" (+{len(in_scope_warn) - 3} more)"
        s.add(
            "in_scope_books_2_to_10pct",
            WARN,
            f"{len(in_scope_warn)} in-scope book(s) with 2-10% error rate: {preview}{more}",
        )
    if missing_in_scope:
        preview = ", ".join(missing_in_scope[:3])
        more = "" if len(missing_in_scope) <= 3 else f" (+{len(missing_in_scope) - 3} more)"
        s.add(
            "missing_in_scope_transcripts",
            WARN,
            f"{len(missing_in_scope)} in-scope qwen_ok book(s) are missing "
            f"transcript files: {preview}{more}",
        )
    if not (in_scope_fail or in_scope_warn or missing_in_scope):
        s.add(
            "all_in_scope_clean",
            PASS,
            f"{in_scope_clean}/{scanned_in_scope} in-scope books at <=2% error rate",
        )

    if out_of_scope_issues:
        s.add(
            "out_of_scope_books_flagged",
            PASS,
            f"{len(out_of_scope_issues)} out-of-scope (g<{MIN_PROD_GRADE}) "
            f"book(s) have high error rates but are intentionally "
            f"excluded from prod queries",
        )

    return s


async def check_mistake_reviews(db) -> Section:
    s = Section("mistake_reviews")
    total = (await db.execute(text("SELECT COUNT(*) FROM mistake_reviews"))).scalar_one()
    s.metrics["total"] = total

    if total == 0:
        s.add("total", WARN, "mistake_reviews is empty (no student errors logged)")
        return s

    # FK integrity to users
    n_orph_user = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM mistake_reviews m
         WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id)
    """)
        )
    ).scalar_one()
    if n_orph_user == 0:
        s.add("user_fk", PASS, f"{total} reviews, all linked to a user")
    else:
        s.add("user_fk", FAIL, f"{n_orph_user}/{total} reviews reference a missing user")

    # textbook_chunk_id coverage (nullable - but if set, must be valid)
    n_orph_chunk = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM mistake_reviews m
         WHERE m.textbook_chunk_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM textbook_chunks c WHERE c.id = m.textbook_chunk_id)
    """)
        )
    ).scalar_one()
    if n_orph_chunk == 0:
        s.add("chunk_fk", PASS, "every non-null textbook_chunk_id resolves")
    else:
        s.add("chunk_fk", FAIL, f"{n_orph_chunk} mistake reviews reference a missing chunk")

    return s


async def check_student_profiles(db) -> Section:
    s = Section("student_profiles")
    n_plural = (await db.execute(text("SELECT COUNT(*) FROM student_profiles"))).scalar_one()
    s.metrics["student_profiles_total"] = n_plural

    # Detect dupe table: the singular variant must stay empty or be
    # explicitly documented. If it has rows, flag it.
    #
    # The singular table was dropped by migration s22d. We probe via
    # ``to_regclass`` (returns NULL for missing tables, no exception)
    # and only run the COUNT inside a SAVEPOINT when the table exists,
    # so a stale environment that still has it does not poison the
    # surrounding asyncpg transaction with InFailedSQLTransactionError.
    singular_exists = (
        await db.execute(text("SELECT to_regclass('public.student_profile') IS NOT NULL"))
    ).scalar_one()
    n_singular: int | None = 0
    if singular_exists:
        try:
            async with db.begin_nested():
                n_singular = (
                    await db.execute(text("SELECT COUNT(*) FROM student_profile"))
                ).scalar_one()
        except Exception:
            n_singular = None
    s.metrics["student_profile_singular_total"] = n_singular

    if n_singular and n_singular > 0:
        s.add(
            "legacy_singular_table",
            WARN,
            f"student_profile (singular) has {n_singular} rows; "
            "plan migration to student_profiles or drop the table",
        )
    elif n_singular == 0:
        s.add("legacy_singular_table", PASS, "student_profile (singular) is empty - safe to drop")

    if n_plural == 0:
        s.add("coverage", WARN, "no student_profiles rows")
        return s

    # FK integrity
    n_orph = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM student_profiles p
         WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)
    """)
        )
    ).scalar_one()
    if n_orph == 0:
        s.add("user_fk", PASS, f"{n_plural} profiles, all linked to a user")
    else:
        s.add("user_fk", FAIL, f"{n_orph}/{n_plural} profiles reference a missing user")

    # coverage ratio vs users
    n_users = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar_one()
    ratio = n_plural / max(n_users, 1)
    if ratio >= 0.8:
        s.add("coverage_vs_users", PASS, f"{n_plural}/{n_users} users have a profile ({ratio:.0%})")
    elif ratio >= 0.4:
        s.add(
            "coverage_vs_users",
            PASS,
            f"{n_plural}/{n_users} users have a profile ({ratio:.0%}) - expected if onboarding is optional",
        )
    else:
        s.add(
            "coverage_vs_users",
            WARN,
            f"only {n_plural}/{n_users} users have a profile ({ratio:.0%})",
        )

    return s


async def check_gamification(db) -> Section:
    s = Section("gamification")
    try:
        n = (await db.execute(text("SELECT COUNT(*) FROM gamification_profiles"))).scalar_one()
    except Exception:
        s.add("table", WARN, "gamification_profiles table not found")
        return s
    n_users = (await db.execute(text("SELECT COUNT(*) FROM users"))).scalar_one()
    s.metrics["gamification_profiles_total"] = n
    s.metrics["users_total"] = n_users

    if n == 0:
        s.add(
            "coverage",
            WARN,
            "no gamification_profiles rows yet - feature unreleased or "
            "profile auto-creation not wired",
        )
    else:
        ratio = n / max(n_users, 1)
        if ratio >= 0.5:
            s.add("coverage", PASS, f"{n}/{n_users} users gamified ({ratio:.0%})")
        else:
            s.add(
                "coverage",
                PASS,
                f"{n}/{n_users} users gamified ({ratio:.0%}) - low but not necessarily a bug",
            )

    # Every profile must point at a real user (FK already exists per
    # pg_constraint, but double-check live).
    if n > 0:
        n_orph = (
            await db.execute(
                text("""
            SELECT COUNT(*) FROM gamification_profiles g
             WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id)
        """)
            )
        ).scalar_one()
        if n_orph == 0:
            s.add("user_fk", PASS, "no orphan user_id")
        else:
            s.add("user_fk", FAIL, f"{n_orph} profile(s) reference a missing user")

    return s


async def check_mock_questions(db) -> Section:
    """Session-23 practice-question bank sanity.

    Expect >= 10K rows across >= 10 subjects, mostly from ymnik.kz scrape
    + LLM-marked no-good subjects. Every row must have a content_hash
    (UNIQUE) and a correct_answer. Embedding coverage should be >= 80%;
    lower is a WARN (still populating), 0 is a FAIL.
    """
    s = Section("mock_questions")
    total = (await db.execute(text("SELECT COUNT(*) FROM mock_questions"))).scalar_one()
    s.metrics["total"] = total

    if total == 0:
        s.add(
            "total",
            FAIL,
            "mock_questions is empty - run scrape_ymnik.py + ingest_mock_questions.py",
        )
        return s
    if total < 1_000:
        s.add("total", WARN, f"only {total} rows - 10K+ is the session-23 target")
    elif total < 10_000:
        s.add("total", WARN, f"{total} rows (approaching 10K target)")
    else:
        s.add("total", PASS, f"{total} rows (>=10K target met)")

    # Hash-and-answer integrity
    n_no_hash = (
        await db.execute(text("SELECT COUNT(*) FROM mock_questions WHERE content_hash IS NULL"))
    ).scalar_one()
    if n_no_hash:
        s.add(
            "content_hash",
            FAIL,
            f"{n_no_hash} rows have NULL content_hash - dedup invariant broken",
        )
    else:
        s.add("content_hash", PASS, "all rows have content_hash")

    n_no_ans = (
        await db.execute(
            text(
                "SELECT COUNT(*) FROM mock_questions "
                "WHERE correct_answer IS NULL OR correct_answer=''"
            )
        )
    ).scalar_one()
    if n_no_ans:
        s.add(
            "correct_answer",
            FAIL,
            f"{n_no_ans} rows have no correct_answer - would 500 in practice UI",
        )
    else:
        s.add("correct_answer", PASS, "all rows have correct_answer")

    # Subject diversity
    n_subj = (
        await db.execute(
            text("SELECT COUNT(DISTINCT subject) FROM mock_questions WHERE subject IS NOT NULL")
        )
    ).scalar_one()
    if n_subj < 10:
        s.add("subject_diversity", WARN, f"only {n_subj} distinct subjects (expect 14)")
    else:
        s.add("subject_diversity", PASS, f"{n_subj} distinct subjects")

    # Language split
    lang_rows = (
        await db.execute(
            text("SELECT language, COUNT(*) FROM mock_questions GROUP BY language ORDER BY 2 DESC")
        )
    ).fetchall()
    s.metrics["by_language"] = {r[0]: r[1] for r in lang_rows}
    langs = {r[0]: r[1] for r in lang_rows}
    if "ru" in langs and "kz" in langs:
        s.add("bilingual_coverage", PASS, f"RU={langs.get('ru', 0)} KZ={langs.get('kz', 0)}")
    else:
        s.add("bilingual_coverage", WARN, f"language split: {langs} - expected both 'ru' and 'kz'")

    # Embedding coverage
    n_no_emb = (
        await db.execute(
            text("SELECT COUNT(*) FROM mock_questions WHERE question_embedding IS NULL")
        )
    ).scalar_one()
    pct = (total - n_no_emb) / max(total, 1) * 100
    s.metrics["embedding_pct"] = round(pct, 1)
    if pct >= 95:
        s.add("embedding_coverage", PASS, f"{total - n_no_emb}/{total} embedded ({pct:.0f}%)")
    elif pct >= 50:
        s.add(
            "embedding_coverage",
            WARN,
            f"{total - n_no_emb}/{total} embedded ({pct:.0f}%); "
            "run tmp_scripts/session_2026-04-22/embed_all.py",
        )
    else:
        s.add(
            "embedding_coverage",
            WARN,
            f"only {total - n_no_emb}/{total} embedded ({pct:.0f}%); "
            "run tmp_scripts/session_2026-04-22/embed_all.py",
        )

    return s


async def check_fk_hardening(db) -> Section:
    """Lock in the session-22c FK hardening - 5 named constraints."""
    s = Section("fk_hardening")
    required = [
        "fk_chat_feedback_user_id",
        "fk_rag_query_log_user_id",
        "fk_telemetry_errors_user_id",
        "fk_telemetry_logs_user_id",
        "fk_telemetry_requests_user_id",
    ]
    rows = (
        await db.execute(
            text("""
        SELECT conname FROM pg_constraint
         WHERE conname = ANY(:names)
    """),
            {"names": required},
        )
    ).fetchall()
    got = {r[0] for r in rows}
    missing = [c for c in required if c not in got]
    s.metrics["required"] = required
    s.metrics["missing"] = missing
    if not missing:
        s.add("all_5_fks_present", PASS, "5/5 session-22c FKs enforced")
    else:
        s.add(
            "all_5_fks_present",
            FAIL,
            f"missing: {missing}; run alembic upgrade head (s22c_fk_hardening)",
        )
    return s


async def check_major_groups(db) -> Section:
    s = Section("major_groups")
    total = (await db.execute(text("SELECT COUNT(*) FROM major_groups"))).scalar_one()
    s.metrics["total"] = total

    n_unknown = (
        await db.execute(
            text("""
        SELECT COUNT(*) FROM major_groups
         WHERE unt_subjects IS NULL
            OR LOWER(TRIM(unt_subjects)) = 'unknown'
            OR TRIM(unt_subjects) = ''
    """)
        )
    ).scalar_one()
    s.metrics["unknown_rows"] = n_unknown

    if n_unknown == 0:
        s.add("unt_subjects_coverage", PASS, "no Unknown/NULL rows")
    else:
        s.add(
            "unt_subjects_coverage",
            FAIL,
            f"{n_unknown} rows have Unknown/NULL/empty unt_subjects; "
            "re-run tmp_scripts/session_2026-04-22/backfill_unknown_groups_apply.py --apply",
        )

    return s


# ---------- main -----------------------------------------------------


async def run_all() -> list[Section]:
    async with AsyncSessionLocal() as db:
        sections: list[Section] = []
        sections.append(await check_users(db))
        sections.append(await check_exam_attempts(db))
        sections.append(await check_chat(db))
        sections.append(await check_textbooks(db))
        sections.append(await check_textbook_chunks(db))
        sections.append(await check_universities(db))
        sections.append(await check_major_groups(db))
        sections.append(await check_mistake_reviews(db))
        sections.append(await check_student_profiles(db))
        sections.append(await check_gamification(db))
        sections.append(await check_mock_questions(db))
        sections.append(await check_fk_hardening(db))
        sections.append(await check_ocr_content_integrity(db))
        return sections


def emit_text(sections: list[Section]) -> str:
    lines: list[str] = []
    lines.append("=" * 74)
    lines.append("UNT PLATFORM  data_health  (session 22c, 2026-04-22)")
    lines.append("=" * 74)

    for s in sections:
        worst = s.worst()
        marker = {PASS: "[ok ]", WARN: "[WARN]", FAIL: "[FAIL]"}[worst]
        lines.append("")
        lines.append(f"{marker}  {s.name}")
        lines.append("-" * 74)
        for label, verdict, msg in s.checks:
            m = {PASS: "  ok", WARN: "WARN", FAIL: "FAIL"}[verdict]
            lines.append(f"   {m}  {label:<26} {msg}")

    # overall
    verdict = PASS
    for s in sections:
        w = s.worst()
        if w == FAIL:
            verdict = FAIL
            break
        if w == WARN and verdict == PASS:
            verdict = WARN
    lines.append("")
    lines.append("=" * 74)
    lines.append(f"OVERALL: {verdict}")
    lines.append("=" * 74)
    return "\n".join(lines)


def emit_json(sections: list[Section]) -> str:
    out = {
        "sections": [
            {
                "name": s.name,
                "worst": s.worst(),
                "checks": [{"label": lbl, "verdict": v, "msg": m} for lbl, v, m in s.checks],
                "metrics": s.metrics,
            }
            for s in sections
        ],
        "overall": max(
            (s.worst() for s in sections),
            key=lambda v: {PASS: 0, WARN: 1, FAIL: 2}[v],
            default=PASS,
        ),
    }
    return json.dumps(out, indent=2, default=str)


def main_cli() -> int:
    ap = argparse.ArgumentParser(description="UNT platform data-health check")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    ap.add_argument("--strict", action="store_true", help="exit 1 on any WARN or FAIL (CI mode)")
    args = ap.parse_args()

    sections = asyncio.run(run_all())
    if args.json:
        print(emit_json(sections))
    else:
        print(emit_text(sections))

    # exit code
    overall = max(
        (s.worst() for s in sections), key=lambda v: {PASS: 0, WARN: 1, FAIL: 2}[v], default=PASS
    )
    if overall == FAIL:
        return 2
    if overall == WARN and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main_cli())
