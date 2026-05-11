"""
UNT Platform — University & Grant Threshold Seeder
==================================================
Seeds university details and historical grant thresholds from JSON files.
Run AFTER `seed_questions.py`.

Usage:
    python scripts/seed_universities.py         # Dry run
    python scripts/seed_universities.py --commit # Write to DB
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

from app.database import async_session_maker
from app.models import HistoricalGrantThreshold, MajorGroup, UniversityDetail

DATABASE_DIR = Path(__file__).parent.parent.parent / "database"


async def seed_universities(session, data: list[dict[str, Any]], dry_run: bool) -> int:
    """Seed UniversityDetail records."""
    count = 0
    for record in data:
        university_code = record.get("university_code")
        if not university_code:
            continue

        result = await session.execute(
            select(UniversityDetail).where(UniversityDetail.university_code == university_code)
        )
        existing = result.scalar_one_or_none()
        if existing:
            # Update existing record
            for key in [
                "full_name",
                "website",
                "total_students",
                "grant_students",
                "paid_students",
                "has_dorm",
                "military_chair",
                "search_keywords",
            ]:
                if key in record and record[key] is not None:
                    setattr(existing, key, record[key])
            if "contacts_raw" in record:
                existing.contacts_raw = record["contacts_raw"]
            print(f"  ~ {record['full_name'][:50]}")
        else:
            row = UniversityDetail(
                university_code=university_code,
                full_name=record.get("full_name", ""),
                website=record.get("website"),
                total_students=record.get("total_students", 0),
                grant_students=record.get("grant_students", 0),
                paid_students=record.get("paid_students", 0),
                military_chair=record.get("military_chair"),
                has_dorm=record.get("has_dorm", "Нет"),
                contacts_raw=record.get("contacts_raw"),
                search_keywords=record.get("search_keywords"),
            )
            session.add(row)
            print(f"  + {record['full_name'][:50]}")
        count += 1

    if not dry_run:
        await session.flush()
    return count


async def seed_grants(session, data: list[dict[str, Any]], dry_run: bool) -> int:
    """Seed HistoricalGrantThreshold records."""
    count = 0
    for record in data:
        university_code = record.get("university_code")
        major_code = record.get("major_code")
        year = record.get("year")
        quota_type = record.get("quota_type", "GENERAL")

        if not all([university_code, major_code, year]):
            continue

        result = await session.execute(
            select(HistoricalGrantThreshold).where(
                HistoricalGrantThreshold.university_code == university_code,
                HistoricalGrantThreshold.major_code == major_code,
                HistoricalGrantThreshold.data_year == year,
                HistoricalGrantThreshold.quota_type == quota_type,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.min_score = record.get("min_score", existing.min_score)
            existing.grants_awarded_count = record.get("grants_awarded")
            print(f"  ~ [{year}] {university_code}/{quota_type} → {record.get('min_score')}")
        else:
            row = HistoricalGrantThreshold(
                university_code=university_code,
                major_code=major_code,
                data_year=year,
                quota_type=quota_type,
                min_score=record.get("min_score", 0),
                grants_awarded_count=record.get("grants_awarded", 0),
            )
            session.add(row)
            print(f"  + [{year}] {university_code}/{quota_type} → {record.get('min_score')}")
        count += 1

    if not dry_run:
        await session.flush()
    return count


async def seed_major_groups(session, data: list[dict[str, Any]], dry_run: bool) -> int:
    """Seed MajorGroup records."""
    count = 0
    for record in data:
        group_code = record.get("group_code")
        if not group_code:
            continue

        result = await session.execute(
            select(MajorGroup).where(MajorGroup.group_code == group_code)
        )
        existing = result.scalar_one_or_none()
        if existing:
            for key in ["group_name", "unt_subjects", "url", "search_keywords"]:
                if key in record and record[key] is not None:
                    setattr(existing, key, record[key])
            print(f"  ~ {record['group_name']}")
        else:
            row = MajorGroup(
                group_code=group_code,
                group_name=record.get("group_name", ""),
                unt_subjects=record.get("unt_subjects"),
                url=record.get("url"),
                search_keywords=record.get("search_keywords"),
            )
            session.add(row)
            print(f"  + {record['group_name']}")
        count += 1

    if not dry_run:
        await session.flush()
    return count


async def main(dry_run: bool = True):
    print("\n=== UNT Platform — University & Grant Seeder ===\n")
    print(f"Database dir: {DATABASE_DIR}")
    print(f"Mode: {'DRY RUN' if dry_run else 'COMMIT'}\n")

    # Load universities
    uni_path = DATABASE_DIR / "universities.json"
    if uni_path.exists():
        with open(uni_path, encoding="utf-8") as f:
            uni_data = json.load(f)
        print(f"📍 Universities: {len(uni_data)} records")
    else:
        print("  [SKIP] universities.json not found")
        uni_data = []

    # Load grant thresholds
    grant_path = DATABASE_DIR / "grants_2024.json"
    if grant_path.exists():
        with open(grant_path, encoding="utf-8") as f:
            grant_data = json.load(f)
        print(f"📊 Grant thresholds: {len(grant_data)} records")
    else:
        print("  [SKIP] grants_2024.json not found")
        grant_data = []

    # Load major groups
    major_path = DATABASE_DIR / "major_groups.json"
    if major_path.exists():
        with open(major_path, encoding="utf-8") as f:
            major_data = json.load(f)
        print(f"📚 Major groups: {len(major_data)} records")
    else:
        print("  [SKIP] major_groups.json not found")
        major_data = []

    if dry_run:
        print("\n⚠️  Dry run — no data written. Run with --commit to write.")
        return

    async with async_session_maker() as session:
        uni_count = await seed_universities(session, uni_data, dry_run)
        grant_count = await seed_grants(session, grant_data, dry_run)
        major_count = await seed_major_groups(session, major_data, dry_run)
        await session.commit()

        print(
            f"\n✅ Seeded {uni_count} universities + {grant_count} grant thresholds + {major_count} major groups."
        )


if __name__ == "__main__":
    commit = "--commit" in sys.argv
    asyncio.run(main(dry_run=not commit))
