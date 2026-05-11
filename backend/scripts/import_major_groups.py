import asyncio
import json
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.database import AsyncSessionLocal, Base, engine
from app.models import MajorGroup

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def import_major_groups():
    """Import major groups with UNT subject requirements"""
    json_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "dataset", "major_groups_subjects.json"
    )

    if not os.path.exists(json_path):
        print(f"ERROR: File not found at {json_path}")
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # Clear existing data
        from sqlalchemy import delete

        await session.execute(delete(MajorGroup))
        await session.commit()

        count = 0
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)

            for item in data:
                try:
                    major = MajorGroup(
                        group_code=item.get("group_code"),
                        group_name=item.get("group_name"),
                        unt_subjects=item.get("unt_subjects", "Unknown"),
                        url=item.get("url"),
                    )
                    session.add(major)
                    count += 1

                except Exception as e:
                    print(f"Error importing {item.get('group_code')}: {e}")
                    continue

        await session.commit()
        print(f"SUCCESS: Imported {count} major groups with UNT requirements!")


if __name__ == "__main__":
    asyncio.run(import_major_groups())
