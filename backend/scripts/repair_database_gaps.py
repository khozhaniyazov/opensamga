"""
Repair deterministic data gaps found by the database health audit.

Default mode is a dry run:
    python scripts/repair_database_gaps.py

Apply changes:
    python scripts/repair_database_gaps.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import select, update

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.constants.subjects import normalize_subject_name
from app.database import AsyncSessionLocal
from app.models import (
    AcceptanceScore,
    ExamAttempt,
    ExamQuestion,
    HistoricalGrantThreshold,
    StudentProfile,
    UniversityData,
    UniversityDetail,
)
from app.services.university_catalog import (
    canonicalize_university_name,
    choose_city,
    normalize_name,
    sanitize_city,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATABASE_DIR = PROJECT_ROOT / "database"
SKIP_EXAM_JSON = {"universities.json", "grants_2024.json", "major_groups.json"}
EXAM_SUBJECT_ALIASES = {
    "histKz": "History of Kazakhstan",
    "readLit": "Reading Literacy",
    "mathLit": "Mathematical Literacy",
    "math": "Mathematics",
    "physics": "Physics",
    "chemistry": "Chemistry",
    "biology": "Biology",
    "geography": "Geography",
    "worldHist": "World History",
    "langLit": "Kazakh Literature",
    "foreignLang": "Foreign Language",
    "law": "Fundamentals of Law",
    "compSci": "Informatics",
}


def iter_exam_source_questions() -> dict[str, dict[str, Any]]:
    questions: dict[str, dict[str, Any]] = {}
    for path in sorted(DATABASE_DIR.glob("*.json")):
        if path.name in SKIP_EXAM_JSON:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for subject_data in data.get("subjects", []):
            raw_subject_name = (
                subject_data.get("subject_name_ru")
                or subject_data.get("subject_name_kz")
                or "Unknown"
            )
            canonical_subject = normalize_subject_name(raw_subject_name)

            for question in subject_data.get("questions", []):
                source_id = question.get("question_id")
                if not source_id:
                    continue
                questions[source_id] = {
                    "subject": canonical_subject,
                    "source_id": source_id,
                    "format": question.get("format", "single_choice"),
                    "max_points": question.get("max_points", 1),
                    "question_text_kz": question.get("question_text_kz", ""),
                    "question_text_ru": question.get("question_text_ru", ""),
                    "options_kz": question.get("options_kz", []),
                    "options_ru": question.get("options_ru", []),
                    "correct_answers_indices": question.get("correct_answers_indices", []),
                    "context_stimulus_kz": None,
                    "context_stimulus_ru": None,
                    "context_group_id": None,
                }

            for cluster in subject_data.get("context_clusters", []):
                for question in cluster.get("child_questions", []):
                    source_id = question.get("question_id")
                    if not source_id:
                        continue
                    questions[source_id] = {
                        "subject": canonical_subject,
                        "source_id": source_id,
                        "format": "context",
                        "max_points": question.get("max_points", 1),
                        "question_text_kz": question.get("question_text_kz", ""),
                        "question_text_ru": question.get("question_text_ru", ""),
                        "options_kz": question.get("options_kz", []),
                        "options_ru": question.get("options_ru", []),
                        "correct_answers_indices": question.get("correct_answers_indices", []),
                        "context_stimulus_kz": cluster.get("stimulus_kz"),
                        "context_stimulus_ru": cluster.get("stimulus_ru"),
                        "context_group_id": cluster.get("cluster_id"),
                    }
    return questions


def object_diff(row: Any, values: dict[str, Any]) -> dict[str, tuple[Any, Any]]:
    diff: dict[str, tuple[Any, Any]] = {}
    for key, new_value in values.items():
        old_value = getattr(row, key)
        if old_value != new_value:
            diff[key] = (old_value, new_value)
    return diff


async def sync_exam_questions(db, apply: bool) -> dict[str, int]:
    source_questions = iter_exam_source_questions()
    existing = {
        row.source_id: row for row in (await db.execute(select(ExamQuestion))).scalars().all()
    }

    updated = 0
    missing_in_db = 0
    missing_in_source = 0
    changed_fields = 0
    updatable_fields = (
        "subject",
        "format",
        "max_points",
        "question_text_kz",
        "question_text_ru",
        "options_kz",
        "options_ru",
        "correct_answers_indices",
        "context_stimulus_kz",
        "context_stimulus_ru",
        "context_group_id",
    )

    for source_id, values in source_questions.items():
        row = existing.get(source_id)
        if not row:
            missing_in_db += 1
            continue
        diff = object_diff(row, {key: values[key] for key in updatable_fields})
        if not diff:
            continue
        updated += 1
        changed_fields += len(diff)
        if apply:
            for key, (_old, new_value) in diff.items():
                setattr(row, key, new_value)

    missing_in_source = len(set(existing) - set(source_questions))
    return {
        "source_questions": len(source_questions),
        "updated_rows": updated,
        "changed_fields": changed_fields,
        "missing_in_db": missing_in_db,
        "missing_in_source": missing_in_source,
    }


async def normalize_quota_types(db, apply: bool) -> dict[str, int]:
    acceptance_rows = (
        (await db.execute(select(AcceptanceScore).where(AcceptanceScore.quota_type == "SPECIAL")))
        .scalars()
        .all()
    )
    history_rows = (
        (
            await db.execute(
                select(HistoricalGrantThreshold).where(
                    HistoricalGrantThreshold.quota_type == "SPECIAL"
                )
            )
        )
        .scalars()
        .all()
    )

    if apply:
        await db.execute(
            update(AcceptanceScore)
            .where(AcceptanceScore.quota_type == "SPECIAL")
            .values(quota_type="ORPHAN")
        )
        await db.execute(
            update(HistoricalGrantThreshold)
            .where(HistoricalGrantThreshold.quota_type == "SPECIAL")
            .values(quota_type="ORPHAN")
        )

    return {
        "acceptance_scores_special_to_orphan": len(acceptance_rows),
        "historical_special_to_orphan": len(history_rows),
    }


async def load_university_name_context(db):
    details = (await db.execute(select(UniversityDetail))).scalars().all()
    canonical_names = {detail.full_name for detail in details if detail.full_name}
    canonical_by_normalized = {
        normalize_name(detail.full_name): detail.full_name
        for detail in details
        if normalize_name(detail.full_name)
    }
    details_by_name = {detail.full_name: detail for detail in details if detail.full_name}
    return canonical_names, canonical_by_normalized, details_by_name


def canonical_name_or_none(
    raw_name: str | None,
    canonical_by_normalized: dict[str, str],
    canonical_names: set[str],
) -> str | None:
    canonical = canonicalize_university_name(raw_name, canonical_by_normalized)
    if canonical in canonical_names:
        return canonical
    return None


async def canonicalize_reference_names(db, apply: bool) -> dict[str, int]:
    canonical_names, canonical_by_normalized, _details_by_name = await load_university_name_context(
        db
    )

    history_rows = (await db.execute(select(HistoricalGrantThreshold))).scalars().all()
    university_rows = (await db.execute(select(UniversityData))).scalars().all()

    history_updates = 0
    university_updates = 0

    for row in history_rows:
        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        if canonical and canonical != row.uni_name:
            history_updates += 1
            if apply:
                row.uni_name = canonical

    for row in university_rows:
        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        if canonical and canonical != row.uni_name:
            university_updates += 1
            if apply:
                row.uni_name = canonical

    return {
        "historical_name_updates": history_updates,
        "university_data_name_updates": university_updates,
    }


async def backfill_university_thresholds(db, apply: bool) -> dict[str, int]:
    canonical_names, canonical_by_normalized, _details_by_name = await load_university_name_context(
        db
    )
    history_rows = (await db.execute(select(HistoricalGrantThreshold))).scalars().all()
    university_rows = (await db.execute(select(UniversityData))).scalars().all()

    latest: dict[tuple[str, str, str], tuple[int, int]] = {}
    for row in history_rows:
        quota_type = (row.quota_type or "").upper()
        if quota_type not in {"GENERAL", "RURAL"}:
            continue
        if not row.major_code or not row.min_score or row.min_score <= 0:
            continue
        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        if not canonical:
            continue
        year = row.data_year or 0
        key = (canonical, row.major_code, quota_type)
        if key not in latest or year > latest[key][0]:
            latest[key] = (year, row.min_score)

    general_updates = 0
    rural_updates = 0
    for row in university_rows:
        if not row.major_code:
            continue
        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        if not canonical:
            continue

        general = latest.get((canonical, row.major_code, "GENERAL"))
        if (row.grant_threshold_general is None or row.grant_threshold_general <= 0) and general:
            general_updates += 1
            if apply:
                row.grant_threshold_general = general[1]

        rural = latest.get((canonical, row.major_code, "RURAL"))
        if (row.grant_threshold_rural is None or row.grant_threshold_rural <= 0) and rural:
            rural_updates += 1
            if apply:
                row.grant_threshold_rural = rural[1]

    return {
        "grant_threshold_general_backfills": general_updates,
        "grant_threshold_rural_backfills": rural_updates,
    }


async def clean_university_cities(db, apply: bool) -> dict[str, int]:
    canonical_names, canonical_by_normalized, details_by_name = await load_university_name_context(
        db
    )
    university_rows = (await db.execute(select(UniversityData))).scalars().all()

    rows_by_canonical: dict[str, list[UniversityData]] = defaultdict(list)
    for row in university_rows:
        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        if canonical:
            rows_by_canonical[canonical].append(row)

    updates = 0
    cleared = 0
    for row in university_rows:
        current = (row.city or "").strip()
        if not current or sanitize_city(current):
            continue

        canonical = canonical_name_or_none(row.uni_name, canonical_by_normalized, canonical_names)
        replacement = None
        if canonical and canonical in details_by_name:
            replacement = choose_city(
                details_by_name[canonical], rows_by_canonical.get(canonical, [])
            )

        if replacement and replacement != current:
            updates += 1
            if apply:
                row.city = replacement
        elif not replacement:
            cleared += 1
            if apply:
                row.city = None

    return {
        "dirty_city_replacements": updates,
        "dirty_city_cleared": cleared,
    }


async def clean_student_profiles(db, apply: bool) -> dict[str, int]:
    valid_ids = {
        row_id for row_id in (await db.execute(select(UniversityDetail.id))).scalars().all()
    }
    profiles = (await db.execute(select(StudentProfile))).scalars().all()

    target_id_cleared = 0
    target_array_trimmed = 0
    for profile in profiles:
        if profile.target_university_id and profile.target_university_id not in valid_ids:
            target_id_cleared += 1
            if apply:
                profile.target_university_id = None

        if profile.target_universities:
            cleaned = [item for item in profile.target_universities if item in valid_ids]
            if cleaned != profile.target_universities:
                target_array_trimmed += 1
                if apply:
                    profile.target_universities = cleaned or None

    return {
        "invalid_target_university_id_cleared": target_id_cleared,
        "invalid_target_universities_trimmed": target_array_trimmed,
    }


async def clean_exam_attempt_subjects(db, apply: bool) -> dict[str, int]:
    attempts = (await db.execute(select(ExamAttempt))).scalars().all()
    updated = 0
    for attempt in attempts:
        normalized = [
            EXAM_SUBJECT_ALIASES.get(subject, normalize_subject_name(subject))
            for subject in (attempt.subjects or [])
        ]
        if normalized != (attempt.subjects or []):
            updated += 1
            if apply:
                attempt.subjects = normalized

    return {"exam_attempt_subject_arrays_normalized": updated}


async def run_repairs(apply: bool) -> dict[str, dict[str, int]]:
    async with AsyncSessionLocal() as db:
        results = {
            "exam_questions": await sync_exam_questions(db, apply),
            "quota_types": await normalize_quota_types(db, apply),
            "university_names": await canonicalize_reference_names(db, apply),
            "thresholds": await backfill_university_thresholds(db, apply),
            "cities": await clean_university_cities(db, apply),
            "student_profiles": await clean_student_profiles(db, apply),
            "exam_attempts": await clean_exam_attempt_subjects(db, apply),
        }

        if apply:
            await db.commit()
        else:
            await db.rollback()
        return results


def print_results(results: dict[str, dict[str, int]], apply: bool) -> None:
    print("mode:", "apply" if apply else "dry-run")
    for section, metrics in results.items():
        print(f"\n[{section}]")
        for key, value in metrics.items():
            print(f"{key}: {value}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write repairs to the database")
    args = parser.parse_args()

    results = asyncio.run(run_repairs(args.apply))
    print_results(results, args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
