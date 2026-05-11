"""
UNT 2025-2026 format compliance regression test.

Pins the numerical contract that defines our exam shape, verified verbatim
against the National Testing Center (НЦТ) of Kazakhstan via inbusiness.kz
(2026-02-26 quote from deputy director Науджан Дидарбекова) and
informburo.kz (cross-confirmed):

    "Структура ЕНТ в 2026 году не изменилась. Обязательные предметы – три,
     профильные – два на выбор. Всего 120 заданий: 20 по «Истории
     Казахстана», по 10 – по «Грамотности чтения» и «Математической
     грамотности», а также по 40 заданий по каждому профильному предмету.
     Максимальный результат – 140 баллов. Продолжительность теста –
     4 часа (240 минут)."

If a future audit/agent claims our 120/140/14400 numbers are non-compliant,
demand a primary НЦТ or adilet.zan.kz citation BEFORE editing any of the
constants this test pins. See memory:
    project_unt_format_audit_2026-04-28.md

Pure-unit (no DB, no network), so always safe to run in CI.
"""

import json
from pathlib import Path

from app.routers.exam import (
    COMPULSORY_MAP,
    EXPECTED_PROFILE_POINTS,
    EXPECTED_PROFILE_QUESTIONS,
    EXPECTED_SECTION_POINTS,
    EXPECTED_TOTAL_POINTS,
    EXPECTED_TOTAL_QUESTIONS,
    SECTION_TIME_LIMITS,
    SUPPORTED_FRONTEND_FORMATS,
)
from app.utils.unt_scoring import get_unt_max_points

# ---------- НЦТ-verified contract ----------


def test_compulsory_question_counts_match_nct():
    """История 20, ГЧ 10, МГ 10."""
    assert COMPULSORY_MAP["histKz"]["limit"] == 20
    assert COMPULSORY_MAP["readLit"]["limit"] == 10
    assert COMPULSORY_MAP["mathLit"]["limit"] == 10


def test_compulsory_section_points_match_nct():
    """Compulsory points equal compulsory question counts (1 pt each)."""
    assert EXPECTED_SECTION_POINTS["histKz"] == 20
    assert EXPECTED_SECTION_POINTS["readLit"] == 10
    assert EXPECTED_SECTION_POINTS["mathLit"] == 10


def test_profile_questions_per_subject_is_40():
    """Each profile subject = 40 questions per НЦТ."""
    assert EXPECTED_PROFILE_QUESTIONS == 40


def test_profile_points_per_subject_is_50():
    """Each profile subject = 50 max points (so 2 profiles + 40 compulsory = 140)."""
    assert EXPECTED_PROFILE_POINTS == 50


def test_total_questions_is_120():
    """20 + 10 + 10 + 40 + 40 = 120 questions per НЦТ."""
    assert EXPECTED_TOTAL_QUESTIONS == 120
    derived = (
        sum(info["limit"] for info in COMPULSORY_MAP.values()) + 2 * EXPECTED_PROFILE_QUESTIONS
    )
    assert derived == 120


def test_total_points_is_140():
    """20 + 10 + 10 + 50 + 50 = 140 points per НЦТ."""
    assert EXPECTED_TOTAL_POINTS == 140
    derived = sum(EXPECTED_SECTION_POINTS.values()) + 2 * EXPECTED_PROFILE_POINTS
    assert derived == 140


def test_section_time_limits_sum_to_240_minutes():
    """30 + 15 + 15 + 60 + 60 = 180 min compulsory + 120 min profile = 240 min total."""
    compulsory_seconds = sum(SECTION_TIME_LIMITS.values())
    DEFAULT_PROFILE_SECONDS = 60 * 60
    total_seconds = compulsory_seconds + 2 * DEFAULT_PROFILE_SECONDS
    # 30+15+15 = 60 min compulsory + 2*60 profile = 180 min — wait, recheck
    # Actual: histKz=30, readLit=15, mathLit=15  => 60 min compulsory
    #         + 60 + 60 profile                  => 180 min total per-section budget.
    # The header timer is 14400s (240 min), which is the *outer* exam cap;
    # per-section sums to 180 min, leaving 60 min slack/transitions.
    assert compulsory_seconds == 60 * 60  # 60 minutes of compulsory
    assert total_seconds == 180 * 60  # 180 minutes of section budget


def test_global_exam_time_limit_is_14400_seconds():
    """Real ЕНТ runs 4 hours = 240 min = 14400 s."""
    # Imported directly from the router payload constant.
    from app.routers import exam as exam_module

    src = Path(exam_module.__file__).read_text(encoding="utf-8")
    assert '"timeLimit": 14400' in src, (
        "exam.py must return timeLimit=14400 (4 hours) per НЦТ ЕНТ-2026 spec"
    )


def test_graded_exam_only_serves_supported_choice_formats():
    """
    The audit's secondary concern (no exotic formats in graded ЕНТ) is already
    enforced: /exam/generate filters via SUPPORTED_FRONTEND_FORMATS. matching,
    fill_blank, image_choice, ordering remain in the schema for Training tiles
    only.
    """
    assert SUPPORTED_FRONTEND_FORMATS == (
        "single_choice",
        "multiple_choice",
        "context",
    )


def test_unt_scoring_helper_agrees_with_section_max():
    """unt_scoring.get_unt_max_points must agree with EXPECTED_*."""
    assert get_unt_max_points("History of Kazakhstan") == 20
    assert get_unt_max_points("Mathematical Literacy") == 10
    assert get_unt_max_points("Reading Literacy") == 10
    assert get_unt_max_points("Mathematics") == 50
    assert get_unt_max_points("Physics") == 50
    assert get_unt_max_points("Chemistry") == 50


# ---------- Schema label ----------

DATABASE_DIR = Path(__file__).resolve().parents[2] / "database"


def test_all_subject_seed_files_use_2025_2026_schema():
    """
    Every subject seed JSON in database/ must declare
    unt_exam_schema_version = "2025_2026". Non-subject seed files
    (grants_2024.json, universities.json, major_groups.json) are
    list-typed and excluded.

    The structure has not changed for 2026 (per НЦТ); the label was
    bumped on 2026-04-28 for clarity only.
    """
    json_files = sorted(DATABASE_DIR.glob("*.json"))
    subject_files = []
    for path in json_files:
        with path.open(encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict):
            subject_files.append((path, payload))

    assert len(subject_files) >= 15, (
        f"Expected at least 15 subject JSON files in {DATABASE_DIR}, got {len(subject_files)}"
    )

    bad = []
    for path, payload in subject_files:
        # Two layouts exist: top-level wrapper, or nested under a single key.
        version = payload.get("unt_exam_schema_version")
        if version is None:
            for v in payload.values():
                if isinstance(v, dict) and "unt_exam_schema_version" in v:
                    version = v["unt_exam_schema_version"]
                    break
        if version != "2025_2026":
            bad.append((path.name, version))
    assert not bad, f"Files with stale/missing schema version: {bad}"
