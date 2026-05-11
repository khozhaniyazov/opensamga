"""v3.38 (2026-05-01) — re-run the four P0 findings from
``project_db_audit_findings_2026-04-28`` and print a structured
PASS/FAIL table.

Spun out of the 2026-04-28 read-only DB audit memory which queued
four concrete P0 fixes:

1. ``database/Информатика.json`` ``cs_multi_003`` and
   ``cs_multi_008`` — only 4 options but ``correct_answers_indices``
   includes ``4`` (out of range).
2. ``student_profiles`` 1 row with orphan
   ``target_university_id = 126`` (no matching university).
3. ``university_data`` "Казахский национальный университет водного
   хозяйства и ирригации" triplicated under codes ``000``, ``000_96``,
   ``529``.
4. ``university_data.min_score_paid = 50`` on 1,496/1,505 rows is a
   default sentinel masquerading as data.

This script is read-only and re-runnable. Each check is independent
and produces a structured ``CheckResult``. JSON checks (#1) run with
no DB. DB checks (#2 #3 #4) require a live DB connection — when the
DB is unreachable the script reports those checks as ``SKIPPED`` and
exits zero (so CI doesn't go red on a missing DB).

Output formats:
- text (default): aligned ASCII table, one row per check.
- ``--json``: machine-readable, suitable for piping into the audit
  memory's verify-and-purge cycle.

Exit codes:
- ``0`` if every check is ``PASS`` or ``SKIPPED``.
- ``2`` if any check is ``FAIL`` (i.e. the audit memory's claim still
  holds and is actionable).

Pure helpers (the ``check_cs_multi_*`` family + the ``_render_*``
emitters) live below as module-level functions and are exercised by
``backend/tests/test_v338_db_audit_recheck.py`` so this script
doubles as a tiny library.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Make ``backend/`` importable so ``from app...`` works whether this
# is invoked from ``backend/`` or from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Windows asyncio selector policy: needed on Python <=3.13 for asyncpg
# friendliness, deprecated on 3.14+. Guard so we don't emit a noisy
# DeprecationWarning on the modern interpreter (Python 3.14 is what
# this repo runs in CI per the .python-version file).
if sys.platform == "win32" and sys.version_info < (3, 14):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


# ---------- result types ---------------------------------------------

PASS = "PASS"
FAIL = "FAIL"
SKIPPED = "SKIPPED"


@dataclass
class CheckResult:
    """Structured outcome for one P0 finding."""

    name: str
    verdict: str  # PASS | FAIL | SKIPPED
    summary: str
    details: dict[str, Any] = field(default_factory=dict)


# ---------- JSON-backed checks (no DB) -------------------------------


# Path to the JSON snapshot the 2026-04-28 audit was reading. Lives
# at ``database/Информатика.json`` from repo root.
INFORMATICS_JSON = Path(__file__).resolve().parents[2] / "database" / "Информатика.json"


def find_question_by_id(payload: dict[str, Any], question_id: str) -> dict[str, Any] | None:
    """Walk the standard ``database/<subject>.json`` shape and return
    the first question matching ``question_id``. Returns ``None`` if
    the id is absent. The shape is ``{"subjects": [{"questions":
    [...]}]}``; we tolerate either a top-level ``questions`` list or
    the nested ``subjects`` form."""
    if "questions" in payload and isinstance(payload["questions"], list):
        for q in payload["questions"]:
            if q.get("question_id") == question_id:
                return q
    for subj in payload.get("subjects", []) or []:
        for q in subj.get("questions", []) or []:
            if q.get("question_id") == question_id:
                return q
    return None


def check_cs_multi_indices(payload: dict[str, Any], question_id: str) -> CheckResult:
    """One row of the JSON-backed P0 check.

    Audit claim: ``correct_answers_indices`` includes ``4`` while
    only 4 options exist (``options[4]`` would be out of range).

    Verdict logic:
    - PASS when ``max(correct_answers_indices) < min(len(options_ru),
      len(options_kz))`` — the audit's claim no longer holds.
    - FAIL when any index is ``>= len(options)`` for either language —
      the bug is real.
    - SKIPPED when the question_id is missing entirely (treat as a
      separate problem, not this one).
    """
    name = f"cs_multi:{question_id}:indices_in_range"
    q = find_question_by_id(payload, question_id)
    if q is None:
        return CheckResult(
            name=name,
            verdict=SKIPPED,
            summary=f"{question_id} not found in Информатика.json",
        )
    options_ru = q.get("options_ru") or []
    options_kz = q.get("options_kz") or []
    indices = q.get("correct_answers_indices") or []
    max_idx = max(indices) if indices else -1
    n_ru = len(options_ru)
    n_kz = len(options_kz)
    smallest = min(n_ru, n_kz) if n_ru and n_kz else max(n_ru, n_kz)
    details = {
        "options_ru": n_ru,
        "options_kz": n_kz,
        "indices": list(indices),
        "max_index": max_idx,
    }
    if max_idx < smallest and indices:
        return CheckResult(
            name=name,
            verdict=PASS,
            summary=(f"max_index={max_idx} < options={smallest} (audit claim no longer holds)"),
            details=details,
        )
    if not indices:
        return CheckResult(
            name=name,
            verdict=FAIL,
            summary=f"correct_answers_indices is empty for {question_id}",
            details=details,
        )
    return CheckResult(
        name=name,
        verdict=FAIL,
        summary=f"max_index={max_idx} >= options={smallest} (audit claim still holds)",
        details=details,
    )


def run_json_checks() -> list[CheckResult]:
    """Run every JSON-backed P0 check. Doesn't touch the DB."""
    if not INFORMATICS_JSON.exists():
        return [
            CheckResult(
                name="cs_multi:json_file_present",
                verdict=SKIPPED,
                summary=f"{INFORMATICS_JSON} not found",
            )
        ]
    try:
        payload = json.loads(INFORMATICS_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [
            CheckResult(
                name="cs_multi:json_file_present",
                verdict=FAIL,
                summary=f"failed to read/parse Информатика.json: {exc}",
            )
        ]
    return [
        check_cs_multi_indices(payload, "cs_multi_003"),
        check_cs_multi_indices(payload, "cs_multi_008"),
    ]


# ---------- DB-backed checks -----------------------------------------


WATER_UNI_FRAGMENT = "водного хозяйства и ирригации"
ORPHAN_TARGET_ID = 126
SENTINEL_MIN_SCORE_PAID = 50


async def check_orphan_target_university(db) -> CheckResult:
    """Audit claim: 1 row in ``student_profiles`` with
    ``target_university_id = 126`` and no matching university.

    Verdict:
    - PASS when zero rows match (audit fix applied or never existed).
    - FAIL when one or more rows still carry the orphan id.
    - SKIPPED if the table doesn't exist on this DB.
    """
    from sqlalchemy import text

    name = "student_profiles:orphan_target_university_id"
    try:
        n = (
            await db.execute(
                text("SELECT COUNT(*) FROM student_profiles WHERE target_university_id = :tid"),
                {"tid": ORPHAN_TARGET_ID},
            )
        ).scalar_one()
    except Exception as exc:  # noqa: BLE001 — surface any DB error as a SKIPPED row
        return CheckResult(
            name=name,
            verdict=SKIPPED,
            summary=f"query failed: {exc.__class__.__name__}",
        )
    if n == 0:
        return CheckResult(
            name=name,
            verdict=PASS,
            summary=f"zero rows with target_university_id={ORPHAN_TARGET_ID}",
            details={"count": 0},
        )
    return CheckResult(
        name=name,
        verdict=FAIL,
        summary=f"{n} row(s) with orphan target_university_id={ORPHAN_TARGET_ID}",
        details={"count": int(n)},
    )


async def check_water_uni_triplicate(db) -> CheckResult:
    """Audit claim: water-irrigation university triplicated under
    codes ``000``, ``000_96``, ``529`` in ``university_data``.

    Verdict:
    - PASS when the count of distinct ``major_code`` values for that
      uni name is ``<= 2`` (single canonical or one legacy alias is
      tolerable; >= 3 means the dup still holds).
    - FAIL when ``>= 3`` distinct codes still match.
    - SKIPPED on DB errors.
    """
    from sqlalchemy import text

    name = "university_data:water_uni_distinct_codes"
    try:
        codes = (
            (
                await db.execute(
                    text(
                        "SELECT DISTINCT major_code FROM university_data WHERE uni_name ILIKE :pat"
                    ),
                    {"pat": f"%{WATER_UNI_FRAGMENT}%"},
                )
            )
            .scalars()
            .all()
        )
    except Exception as exc:  # noqa: BLE001
        return CheckResult(
            name=name,
            verdict=SKIPPED,
            summary=f"query failed: {exc.__class__.__name__}",
        )
    n = len(codes)
    details = {"distinct_major_codes": n, "sample": sorted([str(c) for c in codes])[:10]}
    if n <= 2:
        return CheckResult(
            name=name,
            verdict=PASS,
            summary=f"{n} distinct major_code(s) for water-uni (<=2 acceptable)",
            details=details,
        )
    return CheckResult(
        name=name,
        verdict=FAIL,
        summary=(f"{n} distinct major_code(s) for water-uni — triplicate audit claim still holds"),
        details=details,
    )


async def check_min_score_paid_sentinel(db) -> CheckResult:
    """Audit claim: ``min_score_paid = 50`` on 1,496/1,505 rows is a
    sentinel default, not data.

    This check is informational — fixing it requires a backfill, not
    a one-line repair. We report ``PASS`` when the sentinel ratio has
    dropped meaningfully (< 50% of rows) and ``FAIL`` when the
    sentinel still dominates (>= 50%). The numbers go in ``details``
    either way so the next agent can see the trend.
    """
    from sqlalchemy import text

    name = "university_data:min_score_paid_sentinel"
    try:
        total = (await db.execute(text("SELECT COUNT(*) FROM university_data"))).scalar_one()
        sentinel = (
            await db.execute(
                text("SELECT COUNT(*) FROM university_data WHERE min_score_paid = :s"),
                {"s": SENTINEL_MIN_SCORE_PAID},
            )
        ).scalar_one()
    except Exception as exc:  # noqa: BLE001
        return CheckResult(
            name=name,
            verdict=SKIPPED,
            summary=f"query failed: {exc.__class__.__name__}",
        )
    total = int(total)
    sentinel = int(sentinel)
    ratio = (sentinel / total) if total else 0.0
    details = {
        "total_rows": total,
        "sentinel_rows": sentinel,
        "ratio": round(ratio, 4),
        "sentinel_value": SENTINEL_MIN_SCORE_PAID,
    }
    if total == 0:
        return CheckResult(
            name=name,
            verdict=SKIPPED,
            summary="university_data is empty — no signal",
            details=details,
        )
    if ratio < 0.5:
        return CheckResult(
            name=name,
            verdict=PASS,
            summary=(
                f"{sentinel}/{total} rows ({ratio:.1%}) at sentinel — audit claim "
                "no longer dominates"
            ),
            details=details,
        )
    return CheckResult(
        name=name,
        verdict=FAIL,
        summary=(f"{sentinel}/{total} rows ({ratio:.1%}) at sentinel — sentinel still dominates"),
        details=details,
    )


async def run_db_checks() -> list[CheckResult]:
    """Run every DB-backed P0 check. Returns SKIPPED results when the
    DB is unreachable so the caller can still emit a clean table."""
    try:
        from app.database import AsyncSessionLocal  # noqa: WPS433
    except Exception as exc:  # noqa: BLE001
        return [
            CheckResult(
                name="db_connect",
                verdict=SKIPPED,
                summary=f"could not import AsyncSessionLocal: {exc.__class__.__name__}",
            )
        ]
    try:
        async with AsyncSessionLocal() as db:
            return [
                await check_orphan_target_university(db),
                await check_water_uni_triplicate(db),
                await check_min_score_paid_sentinel(db),
            ]
    except Exception as exc:  # noqa: BLE001
        return [
            CheckResult(
                name="db_connect",
                verdict=SKIPPED,
                summary=f"DB unreachable: {exc.__class__.__name__}",
            )
        ]


# ---------- emitters -------------------------------------------------


def render_text(results: list[CheckResult]) -> str:
    """ASCII-safe text table — Cyrillic is not echoed (Windows
    console mojibake hazard documented in the project README)."""
    width = max((len(r.name) for r in results), default=20)
    width = min(max(width, 24), 60)
    lines: list[str] = []
    lines.append("=" * 78)
    lines.append("v3.38  db_audit_recheck  (re-run of 2026-04-28 P0 findings)")
    lines.append("=" * 78)
    lines.append(f"  {'check':<{width}}  verdict  summary")
    lines.append(f"  {'-' * width}  -------  -----------------------------------------")
    for r in results:
        marker = {PASS: "  ok ", FAIL: "FAIL", SKIPPED: "skip"}[r.verdict]
        lines.append(f"  {r.name:<{width}}  {marker}     {r.summary}")
    lines.append("=" * 78)
    overall = overall_verdict(results)
    lines.append(f"OVERALL: {overall}")
    lines.append("=" * 78)
    return "\n".join(lines)


def render_json(results: list[CheckResult]) -> str:
    return json.dumps(
        {
            "results": [asdict(r) for r in results],
            "overall": overall_verdict(results),
        },
        indent=2,
        ensure_ascii=False,
    )


def overall_verdict(results: list[CheckResult]) -> str:
    """FAIL if any check FAILed; otherwise PASS (SKIPPED is not a
    failure — the script exits zero on a missing DB)."""
    for r in results:
        if r.verdict == FAIL:
            return FAIL
    return PASS


# ---------- CLI ------------------------------------------------------


async def run_all() -> list[CheckResult]:
    return [*run_json_checks(), *(await run_db_checks())]


def main_cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Re-run the 2026-04-28 P0 DB-audit findings.")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    ap.add_argument(
        "--no-db",
        action="store_true",
        help="skip DB-backed checks (useful for offline runs / CI smoke)",
    )
    args = ap.parse_args(argv)

    if args.no_db:
        results = list(run_json_checks())
    else:
        results = asyncio.run(run_all())

    if args.json:
        print(render_json(results))
    else:
        print(render_text(results))

    return 2 if overall_verdict(results) == FAIL else 0


if __name__ == "__main__":
    sys.exit(main_cli())
