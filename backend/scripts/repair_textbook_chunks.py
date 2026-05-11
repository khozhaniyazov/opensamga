"""
Database Repair Script for textbook_chunks table

Fixes the corrupted block 1975 in textbook_chunks table that causes
DataCorruptedError during RAG vector searches.

Run this script with: python scripts/repair_textbook_chunks.py
"""

import asyncio
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import engine


async def repair_textbook_chunks():
    """Repair corrupted textbook_chunks table using REINDEX and VACUUM."""

    print("=" * 60)
    print("DATABASE REPAIR: textbook_chunks table")
    print("=" * 60)
    print()

    async with engine.connect() as conn:
        # Step 1: REINDEX the table
        print("Step 1: Reindexing textbook_chunks table...")
        try:
            # Need to run outside transaction for REINDEX
            await conn.execute(text("COMMIT"))
            await conn.execute(text("REINDEX TABLE textbook_chunks"))
            print("   ✅ REINDEX completed successfully!")
        except Exception as e:
            print(f"   ⚠️ REINDEX failed: {e}")
            print("   Trying alternative approach...")

        # Step 2: VACUUM ANALYZE
        print("\nStep 2: Running VACUUM ANALYZE...")
        try:
            await conn.execute(text("COMMIT"))
            # VACUUM cannot run inside a transaction block with asyncpg
            # We need to use raw connection
            raw_conn = await conn.get_raw_connection()
            await raw_conn.execute("VACUUM ANALYZE textbook_chunks")
            print("   ✅ VACUUM ANALYZE completed successfully!")
        except Exception as e:
            print(f"   ⚠️ VACUUM ANALYZE failed: {e}")
            print("   You may need to run this manually in psql or pgAdmin:")
            print("   VACUUM FULL textbook_chunks;")

    print()
    print("=" * 60)
    print("REPAIR COMPLETE")
    print("=" * 60)
    print()
    print("If errors persist, run manually in PostgreSQL:")
    print("  1. Connect to your database using psql or pgAdmin")
    print("  2. Run: VACUUM FULL textbook_chunks;")
    print("  3. Run: REINDEX TABLE textbook_chunks;")
    print()


if __name__ == "__main__":
    asyncio.run(repair_textbook_chunks())
