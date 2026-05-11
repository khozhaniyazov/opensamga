"""Deep university-data repair pass.

Dry-run by default:
    python scripts/repair_university_data_depth.py

Apply changes:
    python scripts/repair_university_data_depth.py --commit

This script fixes sentinel-style missing data in the university catalog without
inventing values. Unknown tuition stays NULL; the script only removes fake 0s
and backfills values that are already present in trusted local tables or the
cached Russian Univision 2025 scrape.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.database import AsyncSessionLocal  # noqa: E402
from app.services.university_admission_minimums import official_paid_min_score  # noqa: E402
from app.services.university_aliases import build_university_alias_map  # noqa: E402

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "univision_min_scores_2025.json"

TRANSLIT_MAP = str.maketrans(
    {
        "ә": "а",
        "қ": "к",
        "ғ": "г",
        "ң": "н",
        "ү": "у",
        "ұ": "у",
        "ө": "о",
        "і": "и",
        "һ": "х",
    }
)


def normalize_name(value: str | None) -> str:
    text_value = (value or "").lower().replace("ё", "е").translate(TRANSLIT_MAP)
    text_value = re.sub(r"\s*\([^)]*\)\s*", " ", text_value)
    text_value = text_value.replace("имени", "им").replace("им.", "им")
    text_value = re.sub(r"[^0-9a-zа-я\s]", " ", text_value)
    return re.sub(r"\s+", " ", text_value).strip()


ALIAS_MAP = build_university_alias_map(normalize_name)


def canonical_name(value: str | None) -> str:
    normalized = normalize_name(value)
    return normalize_name(ALIAS_MAP.get(normalized, value or ""))


def positive_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(float(str(value).replace(" ", "").replace(",", "").strip()))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def load_univision_min_scores() -> dict[tuple[str, str], int]:
    if not DATA_FILE.exists():
        return {}

    with DATA_FILE.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    scores: dict[tuple[str, str], int] = {}
    for record in payload.get("records", []):
        major_code = str(record.get("major_code") or "").strip().upper()
        uni_key = canonical_name(record.get("uni_name"))
        paid = positive_int(record.get("min_score_paid_full"))
        if not major_code or not uni_key or paid is None:
            continue
        key = (uni_key, major_code)
        scores[key] = max(scores.get(key, 0), paid)
    return scores


def city_from_contacts(contacts: Any) -> str | None:
    if not contacts:
        return None
    if isinstance(contacts, str):
        text_value = contacts
    else:
        text_value = json.dumps(contacts, ensure_ascii=False)

    cities = [
        "Алматы",
        "Астана",
        "Шымкент",
        "Караганда",
        "Актобе",
        "Тараз",
        "Павлодар",
        "Костанай",
        "Кокшетау",
        "Усть-Каменогорск",
        "Уральск",
        "Атырау",
        "Актау",
        "Кызылорда",
        "Талдыкорган",
        "Семей",
        "Петропавловск",
        "Туркестан",
        "Жезказган",
    ]
    lowered = text_value.lower()
    for city in cities:
        if city.lower() in lowered:
            return city
    return None


async def scalar_count(db, sql: str, params: dict[str, Any] | None = None) -> int:
    return int((await db.execute(text(sql), params or {})).scalar_one())


async def count_duplicate_detail_rows(db) -> int:
    return await scalar_count(
        db,
        """
        SELECT COALESCE(SUM(n - 1), 0)
          FROM (
            SELECT COUNT(*) AS n
              FROM university_details
             WHERE full_name IS NOT NULL AND btrim(full_name) <> ''
             GROUP BY full_name
            HAVING COUNT(*) > 1
          ) dup
        """,
    )


async def repair_duplicate_water_university(db, apply: bool) -> int:
    name = "Казахский национальный университет водного хозяйства и ирригации"
    rows = (
        (
            await db.execute(
                text(
                    """
                SELECT id, university_code
                  FROM university_details
                 WHERE full_name = :name
                 ORDER BY
                   CASE WHEN university_code = '529' THEN 0 ELSE 1 END,
                   id
                """
                ),
                {"name": name},
            )
        )
        .mappings()
        .all()
    )
    if len(rows) <= 1:
        return 0
    rows[0]["id"]
    delete_ids = [row["id"] for row in rows[1:]]
    if apply:
        await db.execute(
            text("DELETE FROM university_details WHERE id = ANY(:ids)"),
            {"ids": delete_ids},
        )
    return len(delete_ids)


async def insert_missing_2025_pairs(db, apply: bool) -> int:
    rows = (
        (
            await db.execute(
                text(
                    """
                SELECT d.full_name AS uni_name,
                       a.major_code,
                       mg.group_name AS major_name,
                       MAX(d.contacts_raw::text) AS contacts_raw,
                       MAX(a.min_score) FILTER (WHERE a.quota_type = 'GENERAL') AS general_score,
                       MAX(a.min_score) FILTER (WHERE a.quota_type = 'RURAL') AS rural_score
                  FROM acceptance_scores a
                  JOIN university_details d ON d.university_code = a.university_code
                  JOIN major_groups mg ON mg.group_code = a.major_code
                  LEFT JOIN university_data ud
                    ON ud.uni_name = d.full_name AND ud.major_code = a.major_code
                 WHERE a.year = 2025
                   AND a.major_code LIKE 'B%'
                   AND ud.id IS NULL
                 GROUP BY d.full_name, a.major_code, mg.group_name
                 ORDER BY d.full_name, a.major_code
                """
                )
            )
        )
        .mappings()
        .all()
    )
    if apply:
        for row in rows:
            await db.execute(
                text(
                    """
                    INSERT INTO university_data (
                        uni_name,
                        major_code,
                        major_name,
                        min_score_paid,
                        grant_threshold_general,
                        grant_threshold_rural,
                        tuition_per_year,
                        city
                    )
                    VALUES (
                        :uni_name,
                        :major_code,
                        :major_name,
                        :min_score_paid,
                        :general_score,
                        :rural_score,
                        NULL,
                        :city
                    )
                    """
                ),
                {
                    "uni_name": row["uni_name"],
                    "major_code": row["major_code"],
                    "major_name": row["major_name"],
                    "min_score_paid": official_paid_min_score(row["uni_name"], row["major_code"]),
                    "general_score": row["general_score"],
                    "rural_score": row["rural_score"],
                    "city": city_from_contacts(row["contacts_raw"]),
                },
            )
    return len(rows)


async def backfill_thresholds_from_2025_acceptance(db, apply: bool) -> int:
    sql = """
        WITH best AS (
            SELECT d.full_name AS uni_name,
                   a.major_code,
                   MAX(a.min_score) FILTER (WHERE a.quota_type = 'GENERAL') AS general_score,
                   MAX(a.min_score) FILTER (WHERE a.quota_type = 'RURAL') AS rural_score
              FROM acceptance_scores a
              JOIN university_details d ON d.university_code = a.university_code
             WHERE a.year = 2025
             GROUP BY d.full_name, a.major_code
        ),
        todo AS (
            SELECT ud.id,
                   best.general_score,
                   best.rural_score
              FROM university_data ud
              JOIN best ON best.uni_name = ud.uni_name AND best.major_code = ud.major_code
             WHERE (COALESCE(ud.grant_threshold_general, 0) <= 0 AND best.general_score IS NOT NULL)
                OR (COALESCE(ud.grant_threshold_rural, 0) <= 0 AND best.rural_score IS NOT NULL)
        )
        SELECT COUNT(*) FROM todo
    """
    count = await scalar_count(db, sql)
    if apply and count:
        await db.execute(
            text(
                """
                WITH best AS (
                    SELECT d.full_name AS uni_name,
                           a.major_code,
                           MAX(a.min_score) FILTER (WHERE a.quota_type = 'GENERAL') AS general_score,
                           MAX(a.min_score) FILTER (WHERE a.quota_type = 'RURAL') AS rural_score
                      FROM acceptance_scores a
                      JOIN university_details d ON d.university_code = a.university_code
                     WHERE a.year = 2025
                     GROUP BY d.full_name, a.major_code
                )
                UPDATE university_data ud
                   SET grant_threshold_general = CASE
                         WHEN COALESCE(ud.grant_threshold_general, 0) <= 0
                         THEN best.general_score
                         ELSE ud.grant_threshold_general
                       END,
                       grant_threshold_rural = CASE
                         WHEN COALESCE(ud.grant_threshold_rural, 0) <= 0
                         THEN best.rural_score
                         ELSE ud.grant_threshold_rural
                       END
                  FROM best
                 WHERE best.uni_name = ud.uni_name
                   AND best.major_code = ud.major_code
                   AND (
                        (COALESCE(ud.grant_threshold_general, 0) <= 0 AND best.general_score IS NOT NULL)
                     OR (COALESCE(ud.grant_threshold_rural, 0) <= 0 AND best.rural_score IS NOT NULL)
                   )
                """
            )
        )
    return count


async def repair_paid_min_scores(db, apply: bool) -> int:
    scraped_scores = load_univision_min_scores()
    rows = (
        (
            await db.execute(
                text(
                    """
                SELECT id, uni_name, major_code, min_score_paid
                  FROM university_data
                 WHERE major_code IS NOT NULL
                 ORDER BY id
                """
                )
            )
        )
        .mappings()
        .all()
    )

    updates: list[tuple[int, int]] = []
    for row in rows:
        major_code = str(row["major_code"] or "").strip().upper()
        floor = official_paid_min_score(row["uni_name"], major_code)
        scraped = scraped_scores.get((canonical_name(row["uni_name"]), major_code))
        target = max(floor, scraped or 0)
        current = row["min_score_paid"] or 0
        if current < target:
            updates.append((row["id"], target))

    if apply:
        for row_id, target in updates:
            await db.execute(
                text("UPDATE university_data SET min_score_paid = :target WHERE id = :id"),
                {"target": target, "id": row_id},
            )
    return len(updates)


async def repair_missing_cities(db, apply: bool) -> int:
    rows = (
        (
            await db.execute(
                text(
                    """
                SELECT id, uni_name
                  FROM university_data
                 WHERE city IS NULL OR btrim(city) = '' OR city = '0'
                """
                )
            )
        )
        .mappings()
        .all()
    )
    if not rows:
        return 0

    known = (
        (
            await db.execute(
                text(
                    """
                SELECT uni_name, MAX(city) AS city
                  FROM university_data
                 WHERE city IS NOT NULL AND btrim(city) <> '' AND city <> '0'
                 GROUP BY uni_name
                """
                )
            )
        )
        .mappings()
        .all()
    )
    city_by_name = {row["uni_name"]: row["city"] for row in known}

    updates = [(row["id"], city_by_name.get(row["uni_name"])) for row in rows]
    updates = [(row_id, city) for row_id, city in updates if city]
    if apply:
        for row_id, city in updates:
            await db.execute(
                text("UPDATE university_data SET city = :city WHERE id = :id"),
                {"city": city, "id": row_id},
            )
    return len(updates)


async def count_and_apply(
    db, label: str, report: dict[str, int], count_sql: str, apply_sql: str, apply: bool
) -> None:
    count = await scalar_count(db, count_sql)
    if apply and count:
        await db.execute(text(apply_sql))
    report[label] = count


async def run(apply: bool) -> dict[str, int]:
    report: dict[str, int] = {}
    async with AsyncSessionLocal() as db:
        report["duplicate_detail_rows_deleted"] = await repair_duplicate_water_university(db, apply)
        report["acceptance_backed_university_data_inserts"] = await insert_missing_2025_pairs(
            db, apply
        )
        report[
            "threshold_backfills_from_acceptance"
        ] = await backfill_thresholds_from_2025_acceptance(db, apply)
        report["min_score_paid_updates"] = await repair_paid_min_scores(db, apply)
        report["city_updates"] = await repair_missing_cities(db, apply)

        await count_and_apply(
            db,
            "tuition_zero_to_null",
            report,
            "SELECT COUNT(*) FROM university_data WHERE tuition_per_year = 0",
            "UPDATE university_data SET tuition_per_year = NULL WHERE tuition_per_year = 0",
            apply,
        )
        await count_and_apply(
            db,
            "acceptance_grants_zero_to_null",
            report,
            "SELECT COUNT(*) FROM acceptance_scores WHERE grants_awarded = 0",
            "UPDATE acceptance_scores SET grants_awarded = NULL WHERE grants_awarded = 0",
            apply,
        )
        await count_and_apply(
            db,
            "historical_grants_zero_to_null",
            report,
            "SELECT COUNT(*) FROM historical_grant_thresholds WHERE grants_awarded_count = 0",
            "UPDATE historical_grant_thresholds SET grants_awarded_count = NULL WHERE grants_awarded_count = 0",
            apply,
        )
        await count_and_apply(
            db,
            "detail_zero_totals_nulled",
            report,
            """
            SELECT COUNT(*) FROM university_details
             WHERE total_students = 0
               AND grant_students = 0
               AND paid_students = 0
            """,
            """
            UPDATE university_details
               SET total_students = NULL,
                   grant_students = NULL,
                   paid_students = NULL
             WHERE total_students = 0
               AND grant_students = 0
               AND paid_students = 0
            """,
            apply,
        )
        await count_and_apply(
            db,
            "detail_empty_student_splits_nulled",
            report,
            """
            SELECT COUNT(*) FROM university_details
             WHERE total_students > 0
               AND grant_students = 0
               AND paid_students = 0
            """,
            """
            UPDATE university_details
               SET grant_students = NULL,
                   paid_students = NULL
             WHERE total_students > 0
               AND grant_students = 0
               AND paid_students = 0
            """,
            apply,
        )
        await count_and_apply(
            db,
            "invalid_historical_rows_deleted",
            report,
            """
            SELECT COUNT(*) FROM historical_grant_thresholds
             WHERE min_score IS NULL
                OR min_score <= 0
                OR btrim(COALESCE(uni_name, '')) IN ('', '0', 'Творческий экзамен')
            """,
            """
            DELETE FROM historical_grant_thresholds
             WHERE min_score IS NULL
                OR min_score <= 0
                OR btrim(COALESCE(uni_name, '')) IN ('', '0', 'Творческий экзамен')
            """,
            apply,
        )

        if apply:
            await db.commit()
        else:
            await db.rollback()

    report["remaining_duplicate_detail_rows"] = 0
    async with AsyncSessionLocal() as db:
        report["remaining_duplicate_detail_rows"] = await count_duplicate_detail_rows(db)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="apply repairs")
    args = parser.parse_args()

    report = asyncio.run(run(args.commit))
    mode = "COMMIT" if args.commit else "DRY_RUN"
    print(json.dumps({"mode": mode, "report": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
