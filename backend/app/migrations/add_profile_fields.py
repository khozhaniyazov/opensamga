"""
Database Migration: Add Profile Fields
=======================================

Adds new profile fields to support language preference and target selection.

Updates:
1. users.language_preference (VARCHAR, default 'EN')
2. student_profiles.target_majors (VARCHAR[])
3. student_profiles.target_universities (INTEGER[])

Run with: python -m app.migrations.add_profile_fields
"""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings


async def run_migration(dry_run: bool = True):
    """
    Add new profile fields to database.

    Args:
        dry_run: If True, show SQL without executing (default: True)
    """
    print("=" * 80)
    print("ADD PROFILE FIELDS MIGRATION")
    print("=" * 80)
    print(f"Mode: {'DRY RUN (no changes)' if dry_run else 'LIVE RUN (applying changes)'}")
    print("=" * 80)

    # SQL statements to add new columns
    migrations = [
        # Add language_preference to users table
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS language_preference VARCHAR DEFAULT 'EN'
        """,
        # Add target_majors to student_profiles table
        """
        ALTER TABLE student_profiles
        ADD COLUMN IF NOT EXISTS target_majors VARCHAR[]
        """,
        # Add target_universities to student_profiles table
        """
        ALTER TABLE student_profiles
        ADD COLUMN IF NOT EXISTS target_universities INTEGER[]
        """,
    ]

    rollback_sql = [
        "ALTER TABLE users DROP COLUMN IF EXISTS language_preference",
        "ALTER TABLE student_profiles DROP COLUMN IF EXISTS target_majors",
        "ALTER TABLE student_profiles DROP COLUMN IF EXISTS target_universities",
    ]

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as session:
            print("\nExecuting migrations:")

            for i, sql in enumerate(migrations, 1):
                print(f"\n[{i}/{len(migrations)}] {sql.strip()}")

                if not dry_run:
                    await session.execute(text(sql))
                    print("  Applied")
                else:
                    print("  (dry run - not executed)")

            if dry_run:
                print("\n  DRY RUN MODE: No changes made")
                await session.rollback()
            else:
                await session.commit()
                print("\nMigration completed successfully!")

            print("\n" + "=" * 80)
            print("ROLLBACK SQL (if needed):")
            print("=" * 80)
            for sql in rollback_sql:
                print(f"  {sql}")

    except Exception as e:
        print(f"\nMigration failed: {e}")
        import traceback

        traceback.print_exc()
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    import sys

    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "--live":
        dry_run = False
        print("\n  WARNING: Running in LIVE mode!")
        response = input("Apply changes to database? Type 'yes': ")
        if response.lower() != "yes":
            print("Migration cancelled.")
            sys.exit(0)

    asyncio.run(run_migration(dry_run=dry_run))
