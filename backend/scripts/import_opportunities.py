"""
Opportunity Importer Script

Import opportunities from CSV files (e.g., from university career centers).
Supports batch import with validation and embedding generation.

Usage:
    python scripts/import_opportunities.py data/opportunities.csv --poster-id 1
"""

import argparse
import asyncio
import csv
import io
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import os

from openai import AsyncOpenAI
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Opportunity, OpportunityStatus, OpportunityType, User

# OpenAI client for embedding generation
openai_api_key = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None


# =============================================================================
# SAMPLE CSV FORMAT
# =============================================================================
"""
title,description,opportunity_type,required_skills,location,is_remote,is_paid,commitment_hours,duration_weeks,company_name
"Junior Python Developer Intern","Join our team to build AI products...","INTERNSHIP","Python,Django,SQL","Almaty",false,true,20,12,"TechStartup KZ"
"Marketing Project Lead","Lead our social media campaign...","PROJECT","Marketing,Social Media,Analytics","Remote",true,false,10,8,"Student Club"
"""


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def parse_opportunity_type(value: str) -> OpportunityType:
    """Parse opportunity type from string."""
    type_map = {
        "internship": OpportunityType.INTERNSHIP,
        "part_time": OpportunityType.PART_TIME,
        "part-time": OpportunityType.PART_TIME,
        "full_time": OpportunityType.FULL_TIME,
        "full-time": OpportunityType.FULL_TIME,
        "project": OpportunityType.PROJECT,
        "club": OpportunityType.CLUB,
        "hackathon": OpportunityType.HACKATHON,
        "cofounder": OpportunityType.COFOUNDER,
        "mentorship": OpportunityType.MENTORSHIP,
        "research": OpportunityType.RESEARCH,
    }
    return type_map.get(value.lower().strip(), OpportunityType.PROJECT)


def parse_skills(value: str) -> list:
    """Parse comma-separated skills into list."""
    if not value:
        return []
    return [s.strip() for s in value.split(",") if s.strip()]


def parse_bool(value: str) -> bool:
    """Parse boolean from string."""
    return value.lower().strip() in ("true", "yes", "1", "да", "иә")


def parse_int(value: str) -> int | None:
    """Parse integer from string."""
    try:
        return int(value) if value else None
    except ValueError:
        return None


async def generate_embedding(text: str) -> list:
    """Generate embedding for text using OpenAI."""
    if not openai_client:
        return []

    try:
        response = await openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text[:8000],  # Truncate to avoid token limits
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"  ⚠️  Embedding generation failed: {e}")
        return []


def build_opportunity_text(opp: dict) -> str:
    """Build text representation for embedding."""
    parts = [
        opp.get("title", ""),
        opp.get("description", ""),
        f"Type: {opp.get('opportunity_type', '')}",
        f"Skills: {', '.join(opp.get('required_skills', []))}",
        f"Location: {opp.get('location', '')}",
        opp.get("company_name", ""),
    ]
    return " ".join(parts)


# =============================================================================
# MAIN IMPORT FUNCTION
# =============================================================================


async def import_opportunities(
    csv_path: str,
    poster_id: int,
    auto_publish: bool = False,
    skip_embeddings: bool = False,
):
    """
    Import opportunities from CSV file.

    Args:
        csv_path: Path to CSV file
        poster_id: User ID of the poster (usually an admin or partner account)
        auto_publish: If True, set status to ACTIVE instead of DRAFT
        skip_embeddings: If True, skip embedding generation (faster)
    """
    print("=" * 60)
    print("Opportunity Importer - Student SuperApp")
    print("=" * 60)

    # Validate CSV file exists
    if not Path(csv_path).exists():
        print(f"❌ Error: File not found: {csv_path}")
        return

    # Validate poster exists
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == poster_id))
        poster = result.scalar_one_or_none()

        if not poster:
            print(f"❌ Error: Poster with ID {poster_id} not found")
            return

        print(f"📌 Poster: {poster.name or poster.email} (ID: {poster_id})")

    # Read CSV file
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"📄 Found {len(rows)} opportunities in CSV\n")

    # Import each opportunity
    imported = 0
    errors = 0

    async with AsyncSessionLocal() as session:
        for i, row in enumerate(rows, 1):
            try:
                print(f"[{i}/{len(rows)}] {row.get('title', 'Untitled')[:50]}...")

                # Parse row data
                opp_data = {
                    "title": row.get("title", "").strip(),
                    "description": row.get("description", "").strip(),
                    "opportunity_type": parse_opportunity_type(
                        row.get("opportunity_type", "PROJECT")
                    ),
                    "required_skills": parse_skills(row.get("required_skills", "")),
                    "location": row.get("location", "remote").strip() or "remote",
                    "is_remote": parse_bool(row.get("is_remote", "true")),
                    "is_paid": parse_bool(row.get("is_paid", "false")),
                    "commitment_hours_per_week": parse_int(row.get("commitment_hours", "")),
                    "duration_weeks": parse_int(row.get("duration_weeks", "")),
                    "company_name": row.get("company_name", "").strip(),
                }

                # Validate required fields
                if not opp_data["title"] or not opp_data["description"]:
                    print("  ⚠️  Skipped: Missing title or description")
                    errors += 1
                    continue

                if len(opp_data["description"]) < 50:
                    print("  ⚠️  Skipped: Description too short (min 50 chars)")
                    errors += 1
                    continue

                # Generate embedding
                embedding = None
                if not skip_embeddings:
                    embedding_text = build_opportunity_text(opp_data)
                    embedding = await generate_embedding(embedding_text)

                # Create opportunity
                opportunity = Opportunity(
                    poster_id=poster_id,
                    title=opp_data["title"],
                    description=opp_data["description"],
                    opportunity_type=opp_data["opportunity_type"],
                    required_skills=opp_data["required_skills"],
                    location=opp_data["location"],
                    is_remote=opp_data["is_remote"],
                    is_paid=opp_data["is_paid"],
                    commitment_hours_per_week=opp_data["commitment_hours_per_week"],
                    duration_weeks=opp_data["duration_weeks"],
                    status=OpportunityStatus.ACTIVE if auto_publish else OpportunityStatus.DRAFT,
                    is_verified=True,  # Imported opportunities are pre-verified
                    opportunity_embedding=embedding if embedding else None,
                    expires_at=datetime.now(UTC) + timedelta(days=60),
                    published_at=datetime.now(UTC) if auto_publish else None,
                )

                session.add(opportunity)
                imported += 1
                print("  ✅ Imported")

            except Exception as e:
                print(f"  ❌ Error: {e}")
                errors += 1

        # Commit all
        await session.commit()

    # Summary
    print("\n" + "=" * 60)
    print("Import Summary")
    print("=" * 60)
    print(f"✅ Imported: {imported}")
    print(f"❌ Errors: {errors}")
    print(f"📊 Total processed: {len(rows)}")

    if auto_publish:
        print("\n🚀 All imported opportunities are ACTIVE and visible to students")
    else:
        print("\n📝 Imported opportunities are in DRAFT status")
        print("   Use admin dashboard to review and publish")


# =============================================================================
# CLI
# =============================================================================


def main():
    parser = argparse.ArgumentParser(description="Import opportunities from CSV")
    parser.add_argument("csv_path", help="Path to CSV file")
    parser.add_argument("--poster-id", type=int, required=True, help="User ID of poster")
    parser.add_argument(
        "--auto-publish", action="store_true", help="Automatically publish (ACTIVE status)"
    )
    parser.add_argument("--skip-embeddings", action="store_true", help="Skip embedding generation")

    args = parser.parse_args()

    asyncio.run(
        import_opportunities(
            csv_path=args.csv_path,
            poster_id=args.poster_id,
            auto_publish=args.auto_publish,
            skip_embeddings=args.skip_embeddings,
        )
    )


if __name__ == "__main__":
    main()
