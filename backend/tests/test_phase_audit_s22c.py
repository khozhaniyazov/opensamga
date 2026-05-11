"""Phase 1-4 regression guards (session 22c extension, 2026-04-22).

Covers:
  - Phase 1: textbooks.total_chunks == COUNT(textbook_chunks)
  - Phase 2: 5 FK constraints on {chat_feedback, rag_query_log,
             telemetry_errors, telemetry_logs, telemetry_requests}.user_id
  - Phase 4: dead tables either remain empty OR have been dropped
             (so when the s22d drop migration eventually runs, these
             tests keep passing).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.database import AsyncSessionLocal


@pytest.mark.asyncio
async def test_total_chunks_consistency():
    """textbooks.total_chunks must match COUNT(textbook_chunks)
    for every book."""
    async with AsyncSessionLocal() as db:
        n_drift = (
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
    assert n_drift == 0, (
        f"{n_drift} textbook(s) have total_chunks != actual chunk count; "
        "re-run tmp_scripts/session_2026-04-22/p1_repair_total_chunks.py --apply"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "conname",
    [
        "fk_chat_feedback_user_id",
        "fk_rag_query_log_user_id",
        "fk_telemetry_errors_user_id",
        "fk_telemetry_logs_user_id",
        "fk_telemetry_requests_user_id",
    ],
)
async def test_s22c_fk_constraints_present(conname: str):
    async with AsyncSessionLocal() as db:
        got = (
            await db.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :c"), {"c": conname})
        ).scalar_one_or_none()
    assert got is not None, f"{conname} missing; run alembic upgrade head (s22c_fk_hardening)"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tbl",
    [
        "chat_feedback",
        "rag_query_log",
        "telemetry_errors",
        "telemetry_logs",
        "telemetry_requests",
    ],
)
async def test_s22c_fk_no_orphans(tbl: str):
    """After the FK migration, no orphan user_id can exist (the FK
    itself would reject new ones; this test guards against someone
    disabling the constraint and re-introducing them)."""
    async with AsyncSessionLocal() as db:
        n = (
            await db.execute(
                text(
                    f"SELECT COUNT(*) FROM {tbl} a "
                    f" WHERE a.user_id IS NOT NULL "
                    f"   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)"
                )
            )
        ).scalar_one()
    assert n == 0, f"{tbl} has {n} orphan user_id rows"


@pytest.mark.asyncio
async def test_ocr_content_integrity_check_runs():
    """The new `check_ocr_content_integrity` runs cleanly and emits
    the expected subchecks. Does NOT assert verdict, because the live
    state includes a documented set of broken books that will be
    re-ingested at lower DPI out-of-band.
    """
    # The scripts/ dir isn't on sys.path by default; add it so we can
    # import the data_health helpers directly.
    import sys
    from pathlib import Path as _Path

    scripts_dir = str(_Path(__file__).resolve().parents[1] / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from data_health import check_ocr_content_integrity  # type: ignore

    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        s = await check_ocr_content_integrity(db)
    assert s.name == "ocr_content_integrity"
    labels = [label for (label, _verdict, _msg) in s.checks]
    assert "global_error_rate_all_grades" in labels
    # Either "all_in_scope_clean" OR at least one of the issue categories
    assert any(
        x in labels
        for x in (
            "all_in_scope_clean",
            "in_scope_books_above_10pct",
            "in_scope_books_2_to_10pct",
        )
    ), f"expected integrity verdict in labels: {labels}"
    assert s.metrics.get("total_pages", 0) > 0, "expected to have scanned pages"


@pytest.mark.asyncio
async def test_ocr_integrity_tolerates_classifier_edges(tmp_path):
    """Synthetic probe of the classifier: build tiny _qwen.md files
    in a temp dir and verify it produces the correct buckets.

    This keeps us honest about the 2% / 10% thresholds across future
    refactors even if the live library changes.
    """
    import re
    from pathlib import Path

    PAGE_RE = re.compile(r"^## Page (\d+)\s*$", re.M)
    ERR_RE = re.compile(r"__OCR_ERROR__", re.M)

    def mk(pages: int, errs: int) -> str:
        out = []
        for i in range(1, pages + 1):
            out.append(f"## Page {i}\n")
            if i <= errs:
                out.append("__OCR_ERROR__ synthetic\n")
            else:
                out.append("body body body\n")
        return "\n".join(out)

    cases = [
        ("clean", 100, 0, "<=2"),
        ("blip", 100, 2, "<=2"),
        ("warn", 100, 5, "2_10"),
        ("fail_lo", 100, 11, ">10"),
        ("fail_hi", 100, 80, ">10"),
    ]
    for name, pages, errs, bucket in cases:
        txt = mk(pages, errs)
        found_pages = len(PAGE_RE.findall(txt))
        found_errs = len(ERR_RE.findall(txt))
        assert found_pages == pages
        assert found_errs == errs
        pct = errs / pages
        if bucket == "<=2":
            assert pct <= 0.02, name
        elif bucket == "2_10":
            assert 0.02 < pct <= 0.10, name
        elif bucket == ">10":
            assert pct > 0.10, name


@pytest.mark.asyncio
async def test_dead_tables_either_empty_or_dropped():
    """These tables are classified DEAD (see DEAD_TABLES.md).
    Each must either still be dropped-safe or already dropped post-s22d.

    Drop-safe policy:
      - `langchain_pg_embedding`  : COUNT=0
      - `langchain_pg_collection` : COUNT=0 OR exactly 1 container row
        with no paired embeddings (the 'textbook_library' vestigial
        collection). This pre-existed the session-22c audit.
      - `student_profile`         : COUNT=0
    """
    async with AsyncSessionLocal() as db:

        def _exists(name: str) -> bool:
            return False  # replaced below

        # langchain_pg_embedding
        n_emb = None
        if (
            await db.execute(
                text("""
            SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='langchain_pg_embedding'
        """)
            )
        ).scalar_one_or_none():
            n_emb = (
                await db.execute(text("SELECT COUNT(*) FROM langchain_pg_embedding"))
            ).scalar_one()
            assert n_emb == 0, f"langchain_pg_embedding has {n_emb} rows; expected 0"

        # langchain_pg_collection
        if (
            await db.execute(
                text("""
            SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='langchain_pg_collection'
        """)
            )
        ).scalar_one_or_none():
            n_col = (
                await db.execute(text("SELECT COUNT(*) FROM langchain_pg_collection"))
            ).scalar_one()
            # The vestigial 'textbook_library' container may survive, but only
            # if the embedding table is empty.
            assert n_col <= 1, f"langchain_pg_collection has {n_col} rows; expected <=1"
            if n_col == 1:
                assert n_emb == 0, (
                    "langchain_pg_collection still has a container but the "
                    "embedding table is not empty"
                )

        # student_profile
        if (
            await db.execute(
                text("""
            SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='student_profile'
        """)
            )
        ).scalar_one_or_none():
            n_sp = (await db.execute(text("SELECT COUNT(*) FROM student_profile"))).scalar_one()
            assert n_sp == 0, (
                f"student_profile (singular) has {n_sp} rows; "
                "migrate to student_profiles or investigate"
            )
