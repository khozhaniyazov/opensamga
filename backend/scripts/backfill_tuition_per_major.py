"""Per-major tuition backfill v2:
  - univision_prices.json has per-OP (6B01101) tuition
  - op_to_group_map.json maps 6B01101 -> B001
  - university_data has uni_name + major_code (group level)

For each university_data row, compute median tuition of all OPs that
(a) map to that same group_code and (b) come from that same uni.

This is strictly better than the v1 per-uni median: if a university
has B001 (pedagogy) at 900k and B088 (medicine) at 3M, we now store
the right number per row.

Run with --commit.
"""

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text

from app.database import AsyncSessionLocal

ROOT = Path(os.environ.get("UNT_PLATFORM_ROOT", "."))
PRICES = ROOT / "tmp_scripts" / "session_2026-04-18" / "univision_prices.json"
OP_MAP = ROOT / "tmp_scripts" / "session_2026-04-18" / "op_to_group_map.json"


async def run(commit: bool):
    prices = json.loads(PRICES.read_text(encoding="utf-8"))
    op_to_grp = json.loads(OP_MAP.read_text(encoding="utf-8"))

    # Build (slug_id_prefix, group_code) -> list of tuition_min
    per_pair = defaultdict(list)
    for slug, v in prices.items():
        if not v or not v.get("programs"):
            continue
        slug_id = slug.split("-", 1)[0]
        if not slug_id.isdigit():
            continue
        for p in v["programs"]:
            op = p.get("code")
            if not op:
                continue
            grp = op_to_grp.get(op)
            if not grp:
                continue
            price = p.get("tuition_min")
            if price and 100_000 <= price <= 10_000_000:
                per_pair[(slug_id, grp)].append(price)

    print(f"(slug_id, group) pairs with tuition = {len(per_pair)}")

    # Compute medians
    pair_median = {k: int(statistics.median(v)) for k, v in per_pair.items()}

    async with AsyncSessionLocal() as db:
        details = (
            await db.execute(text("SELECT id, full_name, source_url FROM university_details"))
        ).fetchall()

        # Map full_name -> slug_id
        name_to_slugid = {}
        for r in details:
            sid, full, src = r
            m = re.search(r"/univ/(\d+)-", src or "")
            if m:
                name_to_slugid[full] = m.group(1)

        # Iterate over university_data rows and compute new tuition
        ud_rows = (
            await db.execute(
                text("SELECT id, uni_name, major_code, tuition_per_year FROM university_data")
            )
        ).fetchall()
        print(f"university_data rows = {len(ud_rows)}")

        updates = []
        no_match = 0
        for r in ud_rows:
            ud_id, uni_name, major_code, cur = r
            slug_id = name_to_slugid.get(uni_name)
            if not slug_id or not major_code:
                no_match += 1
                continue
            key = (slug_id, major_code)
            med = pair_median.get(key)
            if med:
                if med != cur:
                    updates.append((ud_id, med))

        print(f"rows_to_update = {len(updates)}")
        print(f"rows_without_match = {no_match}")

        if not commit:
            print("[DRY] --commit to write")
            return

        # Bulk update
        n = 0
        for ud_id, med in updates:
            await db.execute(
                text("UPDATE university_data SET tuition_per_year=:m WHERE id=:i"),
                {"m": med, "i": ud_id},
            )
            n += 1
            if n % 500 == 0:
                await db.commit()
                print(f"  updated {n} / {len(updates)}")
        await db.commit()

        pos = (
            await db.execute(text("SELECT COUNT(*) FROM university_data WHERE tuition_per_year>0"))
        ).scalar()
        distinct = (
            await db.execute(
                text(
                    "SELECT COUNT(DISTINCT tuition_per_year) FROM university_data "
                    "WHERE tuition_per_year>0"
                )
            )
        ).scalar()
        print(f"\nuniversity_data rows with tuition>0: {pos}")
        print(f"distinct tuition values: {distinct}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    asyncio.run(run(commit=args.commit))


main()
