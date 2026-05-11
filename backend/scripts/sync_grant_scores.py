import asyncio
import os
import sys

from sqlalchemy import and_, select

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from difflib import SequenceMatcher

from app.database import AsyncSessionLocal
from app.models import HistoricalGrantThreshold, UniversityData


async def sync_scores():
    async with AsyncSessionLocal() as session:
        print("Starting sync with fuzzy matching...")

        # Get all UniversityData records
        result = await session.execute(select(UniversityData))
        uni_data_list = result.scalars().all()

        updated_count = 0

        # Cache historical data by major_code to avoid repeated queries
        # Dict[major_code, List[HistoricalGrantThreshold]]
        hist_cache = {}

        print("Loading historical data...")
        hist_query = select(HistoricalGrantThreshold).where(
            and_(
                HistoricalGrantThreshold.quota_type == "GENERAL",
                HistoricalGrantThreshold.data_year == 2024,
            )
        )
        hist_result = await session.execute(hist_query)
        all_hist = hist_result.scalars().all()

        for h in all_hist:
            if h.major_code not in hist_cache:
                hist_cache[h.major_code] = []
            hist_cache[h.major_code].append(h)

        print(f"Loaded {len(all_hist)} historical records.")

        for uni_data in uni_data_list:
            candidates = hist_cache.get(uni_data.major_code, [])
            if not candidates:
                continue

            best_match = None
            best_score = 0.0

            for cand in candidates:
                # Try exact match first
                if cand.uni_name == uni_data.uni_name:
                    best_match = cand
                    best_score = 1.0
                    break

                # Fuzzy match
                score = SequenceMatcher(None, uni_data.uni_name, cand.uni_name).ratio()
                if score > best_score:
                    best_score = score
                    best_match = cand

            # Threshold for fuzzy match
            if (
                best_match and best_score > 0.6
            ):  # 0.6 is fairly loose but safe within same major_code
                if best_match.min_score is not None and best_match.min_score > 0:
                    uni_data.grant_threshold_general = best_match.min_score
                    updated_count += 1

            if updated_count % 100 == 0 and updated_count > 0:
                print(f"Updated {updated_count} records...")

        await session.commit()
        print(f"Sync complete. Updated {updated_count} records.")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(sync_scores())
