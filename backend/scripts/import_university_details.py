import asyncio
import json
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.database import AsyncSessionLocal, Base, engine
from app.models import UniversityDetail

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def import_university_details():
    """Import university details with facilities and metadata"""
    # Use university_details_with_majors.json as it has more complete data (total students count)
    json_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "dataset", "university_details_with_majors.json"
    )

    if not os.path.exists(json_path):
        print(f"ERROR: File not found at {json_path}")
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # Clear existing data
        from sqlalchemy import delete

        await session.execute(delete(UniversityDetail))
        await session.commit()

        count = 0
        seen_codes = set()

        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)

            for item in data:
                try:
                    students = item.get("students", {})
                    uni_code = item.get("university_code", "000")

                    # Handle duplicate codes
                    if uni_code in seen_codes:
                        # Generate unique code
                        uni_code = f"{uni_code}_{count}"
                    seen_codes.add(uni_code)

                    uni = UniversityDetail(
                        full_name=item.get("full_name"),
                        university_code=uni_code,
                        website=item.get("website"),
                        total_students=students.get("total", 0),
                        grant_students=students.get("grant", 0),
                        paid_students=students.get("paid", 0),
                        military_chair=str(item.get("military_chair", False)),
                        has_dorm=str(item.get("has_dorm", False)),
                        contacts_raw=item.get("contacts_raw"),
                        source_url=item.get("source_url"),
                    )
                    session.add(uni)
                    count += 1

                except Exception as e:
                    print(f"Error importing {item.get('full_name')}: {e}")
                    continue

        await session.commit()
        print(f"SUCCESS: Imported {count} university details!")


if __name__ == "__main__":
    asyncio.run(import_university_details())
