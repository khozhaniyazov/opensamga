"""
Seed university, major, grant, and acceptance-score reference data.

Run after `alembic upgrade head`.

Usage:
    python scripts/seed_universities.py
    python scripts/seed_universities.py --commit
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    AcceptanceScore,
    HistoricalGrantThreshold,
    MajorGroup,
    UniversityData,
    UniversityDetail,
)

DATABASE_DIR = Path(__file__).parent.parent.parent / "database"


def _load_records(filename: str) -> list[dict[str, Any]]:
    path = DATABASE_DIR / filename
    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return [row for row in data["records"] if isinstance(row, dict)]
    raise ValueError(f"{filename} must contain a JSON list or a records list")


def _clean_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clean_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(str(value).replace(" ", "").replace(",", "").strip()))
    except (TypeError, ValueError):
        return None


def _set_present(row: Any, record: dict[str, Any], fields: list[str]) -> None:
    for field in fields:
        if field in record and record[field] is not None:
            setattr(row, field, record[field])


async def seed_university_details(session, data: list[dict[str, Any]]) -> int:
    count = 0
    for record in data:
        university_code = _clean_str(record.get("university_code"))
        if not university_code:
            continue

        result = await session.execute(
            select(UniversityDetail)
            .where(UniversityDetail.university_code == university_code)
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = UniversityDetail(university_code=university_code, full_name="")
            session.add(row)

        _set_present(
            row,
            record,
            [
                "full_name",
                "website",
                "total_students",
                "grant_students",
                "paid_students",
                "military_chair",
                "has_dorm",
                "contacts_raw",
                "source_url",
                "search_keywords",
            ],
        )
        count += 1
    await session.flush()
    return count


async def seed_major_groups(session, data: list[dict[str, Any]]) -> int:
    count = 0
    for record in data:
        group_code = _clean_str(record.get("group_code"))
        if not group_code:
            continue

        result = await session.execute(
            select(MajorGroup).where(MajorGroup.group_code == group_code).limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = MajorGroup(group_code=group_code)
            session.add(row)

        _set_present(row, record, ["group_name", "unt_subjects", "url", "search_keywords"])
        count += 1
    await session.flush()
    return count


async def seed_acceptance_scores(session, data: list[dict[str, Any]]) -> int:
    count = 0
    for record in data:
        university_code = _clean_str(record.get("university_code"))
        major_code = _clean_str(record.get("major_code"))
        year = _clean_int(record.get("year"))
        quota_type = _clean_str(record.get("quota_type")) or "GENERAL"
        min_score = _clean_int(record.get("min_score"))
        if not all([university_code, major_code, year]) or min_score is None:
            continue

        result = await session.execute(
            select(AcceptanceScore)
            .where(
                AcceptanceScore.university_code == university_code,
                AcceptanceScore.major_code == major_code,
                AcceptanceScore.year == year,
                AcceptanceScore.quota_type == quota_type,
            )
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = AcceptanceScore(
                university_code=university_code,
                major_code=major_code,
                year=year,
                quota_type=quota_type,
                min_score=min_score,
            )
            session.add(row)

        row.min_score = min_score
        row.grants_awarded = _clean_int(record.get("grants_awarded"))
        count += 1
    await session.flush()
    return count


async def seed_historical_grant_thresholds(session, data: list[dict[str, Any]]) -> int:
    count = 0
    for record in data:
        uni_name = _clean_str(record.get("uni_name") or record.get("university_code"))
        major_code = _clean_str(record.get("major_code"))
        data_year = _clean_int(record.get("data_year") or record.get("year"))
        quota_type = _clean_str(record.get("quota_type")) or "GENERAL"
        min_score = _clean_int(record.get("min_score"))
        is_admission_score = _clean_str(record.get("is_admission_score")) or "False"
        if not all([uni_name, major_code, data_year]) or min_score is None:
            continue

        result = await session.execute(
            select(HistoricalGrantThreshold)
            .where(
                HistoricalGrantThreshold.uni_name == uni_name,
                HistoricalGrantThreshold.major_code == major_code,
                HistoricalGrantThreshold.data_year == data_year,
                HistoricalGrantThreshold.quota_type == quota_type,
                HistoricalGrantThreshold.is_admission_score == is_admission_score,
            )
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = HistoricalGrantThreshold(
                uni_name=uni_name,
                major_code=major_code,
                data_year=data_year,
                quota_type=quota_type,
                is_admission_score=is_admission_score,
            )
            session.add(row)

        row.min_score = min_score
        row.grants_awarded_count = _clean_int(
            record.get("grants_awarded_count", record.get("grants_awarded"))
        )
        count += 1
    await session.flush()
    return count


async def seed_university_data(session, data: list[dict[str, Any]]) -> int:
    count = 0
    for record in data:
        uni_name = _clean_str(record.get("uni_name"))
        major_code = _clean_str(record.get("major_code"))
        if not uni_name or not major_code:
            continue

        result = await session.execute(
            select(UniversityData)
            .where(
                UniversityData.uni_name == uni_name,
                UniversityData.major_code == major_code,
            )
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = UniversityData(uni_name=uni_name, major_code=major_code)
            session.add(row)

        _set_present(
            row,
            record,
            [
                "major_name",
                "min_score_paid",
                "grant_threshold_general",
                "grant_threshold_rural",
                "tuition_per_year",
                "city",
            ],
        )
        count += 1
    await session.flush()
    return count


async def main(dry_run: bool = True) -> None:
    university_details = _load_records("university_details.json") or _load_records(
        "universities.json"
    )
    major_groups = _load_records("major_groups.json")
    acceptance_scores = _load_records("acceptance_scores.json")
    historical_thresholds = _load_records("historical_grant_thresholds.json") or _load_records(
        "grants_2024.json"
    )
    university_data = _load_records("university_data.json")

    counts = {
        "university_details": len(university_details),
        "major_groups": len(major_groups),
        "acceptance_scores": len(acceptance_scores),
        "historical_grant_thresholds": len(historical_thresholds),
        "university_data": len(university_data),
    }

    print("OpenSamga reference-data seeder")
    print(f"Database dir: {DATABASE_DIR}")
    print(f"Mode: {'DRY RUN' if dry_run else 'COMMIT'}")
    for name, count in counts.items():
        print(f"{name}: {count}")

    if dry_run:
        print("No data written. Re-run with --commit to write.")
        return

    async with AsyncSessionLocal() as session:
        seeded = {
            "university_details": await seed_university_details(session, university_details),
            "major_groups": await seed_major_groups(session, major_groups),
            "acceptance_scores": await seed_acceptance_scores(session, acceptance_scores),
            "historical_grant_thresholds": await seed_historical_grant_thresholds(
                session, historical_thresholds
            ),
            "university_data": await seed_university_data(session, university_data),
        }
        await session.commit()

    print("Seed complete.")
    for name, count in seeded.items():
        print(f"{name}: {count}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(dry_run="--commit" not in sys.argv))
