"""
Database Migration: Normalize Subject Names to Canonical English
==================================================================

This script normalizes all subject names in the database to use canonical
English names from the subjects constants.

Updates:
1. activity_log.metadata_blob->>'subject'
2. student_profiles.chosen_subjects

Run with: python -m app.migrations.normalize_subjects
"""

import asyncio
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings
from ..constants.subjects import is_valid_subject, normalize_subject_name
from ..models import ActivityLog, StudentProfile


class MigrationLogger:
    """Logger for migration operations"""

    def __init__(self):
        self.changes = []
        self.errors = []

    def log_change(self, table: str, record_id: int, field: str, old_value: str, new_value: str):
        """Log a successful change"""
        self.changes.append(
            {
                "table": table,
                "record_id": record_id,
                "field": field,
                "old_value": old_value,
                "new_value": new_value,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def log_error(self, table: str, record_id: int, error: str):
        """Log an error"""
        self.errors.append(
            {
                "table": table,
                "record_id": record_id,
                "error": error,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def save_log(self, filepath: str = "migration_log.json"):
        """Save log to file"""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "changes": self.changes,
                    "errors": self.errors,
                    "total_changes": len(self.changes),
                    "total_errors": len(self.errors),
                },
                f,
                indent=2,
                ensure_ascii=False,
            )

    def print_summary(self):
        """Print migration summary"""
        print("\n" + "=" * 80)
        print("MIGRATION SUMMARY")
        print("=" * 80)
        print(f"Total changes: {len(self.changes)}")
        print(f"Total errors: {len(self.errors)}")

        if self.changes:
            print("\nChanges by table:")
            tables = {}
            for change in self.changes:
                table = change["table"]
                tables[table] = tables.get(table, 0) + 1
            for table, count in tables.items():
                print(f"  {table}: {count} records updated")

        if self.errors:
            print("\nErrors:")
            for error in self.errors[:10]:  # Show first 10 errors
                print(f"  [{error['table']}:{error['record_id']}] {error['error']}")
            if len(self.errors) > 10:
                print(f"  ... and {len(self.errors) - 10} more errors")

        print("=" * 80)


async def migrate_activity_logs(
    session: AsyncSession, logger: MigrationLogger, dry_run: bool = True
):
    """
    Normalize subject names in activity_log table.

    Args:
        session: Database session
        logger: Migration logger
        dry_run: If True, don't commit changes (default: True)
    """
    print("\n[1/2] Migrating activity_log records...")

    # Query all TEST_COMPLETED activities
    result = await session.execute(
        select(ActivityLog).where(ActivityLog.activity_type == "TEST_COMPLETED")
    )
    activities = result.scalars().all()

    print(f"Found {len(activities)} TEST_COMPLETED activities")

    updated_count = 0

    for activity in activities:
        if not activity.metadata_blob or not isinstance(activity.metadata_blob, dict):
            continue

        old_subject = activity.metadata_blob.get("subject")
        if not old_subject:
            continue

        # Normalize the subject name
        new_subject = normalize_subject_name(old_subject)

        # Only update if the name changed
        if old_subject != new_subject:
            # Validate that the new name is valid
            if not is_valid_subject(new_subject):
                logger.log_error("activity_log", activity.id, f"Invalid subject: {new_subject}")
                continue

            # Update metadata
            activity.metadata_blob["subject"] = new_subject

            # Mark as modified (SQLAlchemy JSON field update)
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(activity, "metadata_blob")

            logger.log_change(
                "activity_log", activity.id, "metadata_blob->>'subject'", old_subject, new_subject
            )
            updated_count += 1

            if updated_count % 10 == 0:
                print(f"  Processed {updated_count} updates...")

    print(f"✓ Updated {updated_count} activity_log records")

    if not dry_run:
        await session.flush()

    return updated_count


async def migrate_student_profiles(
    session: AsyncSession, logger: MigrationLogger, dry_run: bool = True
):
    """
    Normalize chosen_subjects in student_profiles table.

    Args:
        session: Database session
        logger: Migration logger
        dry_run: If True, don't commit changes (default: True)
    """
    print("\n[2/2] Migrating student_profiles records...")

    # Query all student profiles
    result = await session.execute(select(StudentProfile))
    profiles = result.scalars().all()

    print(f"Found {len(profiles)} student profiles")

    updated_count = 0

    for profile in profiles:
        if not profile.chosen_subjects:
            continue

        old_subjects = list(profile.chosen_subjects)
        new_subjects = []
        changed = False

        for old_subject in old_subjects:
            new_subject = normalize_subject_name(old_subject)

            if new_subject != old_subject:
                changed = True

                # Validate
                if not is_valid_subject(new_subject):
                    logger.log_error(
                        "student_profiles", profile.id, f"Invalid subject: {new_subject}"
                    )
                    new_subjects.append(old_subject)  # Keep old if invalid
                    continue

            new_subjects.append(new_subject)

        if changed:
            profile.chosen_subjects = new_subjects

            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(profile, "chosen_subjects")

            logger.log_change(
                "student_profiles",
                profile.id,
                "chosen_subjects",
                str(old_subjects),
                str(new_subjects),
            )
            updated_count += 1

    print(f"✓ Updated {updated_count} student_profiles records")

    if not dry_run:
        await session.flush()

    return updated_count


async def run_migration(dry_run: bool = True):
    """
    Run the complete migration.

    Args:
        dry_run: If True, show what would be changed without committing (default: True)
    """
    print("=" * 80)
    print("SUBJECT NAME NORMALIZATION MIGRATION")
    print("=" * 80)
    print(
        f"Mode: {'DRY RUN (no changes will be saved)' if dry_run else 'LIVE RUN (changes will be committed)'}"
    )
    print("=" * 80)

    logger = MigrationLogger()

    # Create async engine
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as session:
            # Run migrations
            await migrate_activity_logs(session, logger, dry_run)
            await migrate_student_profiles(session, logger, dry_run)

            if dry_run:
                print("\n⚠️  DRY RUN MODE: Changes not committed")
                await session.rollback()
            else:
                print("\n✓ Committing changes...")
                await session.commit()
                print("✓ Migration completed successfully!")

            # Print summary
            logger.print_summary()

            # Save log
            log_file = f"migration_log_{'dry_run' if dry_run else 'live'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            logger.save_log(log_file)
            print(f"\n📝 Migration log saved to: {log_file}")

    except Exception as e:
        print(f"\n❌ Migration failed with error: {e}")
        import traceback

        traceback.print_exc()
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    import sys

    # Parse command line arguments
    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "--live":
        dry_run = False
        print("\n⚠️  WARNING: Running in LIVE mode. Changes will be committed to database!")
        response = input("Are you sure? Type 'yes' to continue: ")
        if response.lower() != "yes":
            print("Migration cancelled.")
            sys.exit(0)

    # Run migration
    asyncio.run(run_migration(dry_run=dry_run))
