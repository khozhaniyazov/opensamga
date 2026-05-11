"""
Bulk Library Ingestion Script for Samga.ai

Walks through dataset/library/ directory structure and ingests all PDF textbooks
into the database with vector embeddings for RAG functionality.

Directory structure expected:
    dataset/library/
        {subject}/
            {grade}/
                {book_name}.pdf

Example:
    dataset/library/
        Mathematics/
            10/
                algebra_10.pdf
                geometry_10.pdf
            11/
                algebra_11.pdf
        Physics/
            10/
                mechanics_10.pdf
"""

import asyncio
import os
import sys
from pathlib import Path

from tqdm import tqdm

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Textbook
from app.services.library_ingestion import process_pdf


def discover_pdfs(library_root: str) -> list[dict[str, any]]:
    """
    Walk through the library directory and discover all PDF files.

    Returns:
        List of dictionaries with file_path, subject, grade, and title
    """
    library_path = Path(library_root)

    if not library_path.exists():
        raise FileNotFoundError(f"Library directory not found: {library_root}")

    pdfs = []

    # Walk through directory structure: {subject}/{grade}/*.pdf
    for subject_dir in library_path.iterdir():
        if not subject_dir.is_dir():
            continue

        subject = subject_dir.name

        for grade_dir in subject_dir.iterdir():
            if not grade_dir.is_dir():
                continue

            # Try to parse grade as integer
            try:
                grade = int(grade_dir.name)
            except ValueError:
                print(f"⚠️  Warning: Could not parse grade from '{grade_dir.name}', skipping...")
                continue

            # Find all PDFs in this grade directory
            for pdf_file in grade_dir.glob("*.pdf"):
                # Extract title from filename (remove extension)
                # Format: Make title more descriptive by including subject context
                # Example: "algebra_10" -> "Algebra" or keep as-is if already descriptive
                title = pdf_file.stem

                # Clean up title: remove grade suffix if present (e.g., "algebra_10" -> "Algebra")
                # But preserve descriptive names (e.g., "geometry_advanced" stays as-is)
                title_clean = title.replace(f"_{grade}", "").replace(f"{grade}", "")
                # Capitalize first letter for better readability
                if title_clean:
                    title_clean = title_clean.replace("_", " ").title()
                else:
                    title_clean = title.replace("_", " ").title()

                pdfs.append(
                    {
                        "file_path": str(pdf_file.absolute()),
                        "subject": subject,
                        "grade": grade,
                        "title": title_clean,  # Use cleaned title for better citations
                    }
                )

    return pdfs


async def ingest_library(
    library_root: str = "dataset/library", skip_existing: bool = True, dry_run: bool = False
):
    """
    Main ingestion function.

    Args:
        library_root: Root directory containing the library structure
        skip_existing: If True, skip files that already exist in database
        dry_run: If True, only discover files without processing
    """
    print("🔍 Discovering PDF files...")
    pdfs = discover_pdfs(library_root)

    if not pdfs:
        print(f"❌ No PDF files found in {library_root}")
        print("   Expected structure: {subject}/{grade}/*.pdf")
        return

    print(f"✅ Found {len(pdfs)} PDF file(s)")

    if dry_run:
        print("\n📋 Files to be processed (DRY RUN):")
        for pdf in pdfs:
            print(f"   - {pdf['subject']}/Grade {pdf['grade']}: {pdf['title']}")
        return

    # Group by subject and grade for better progress tracking
    print("\n📚 Starting ingestion...")

    async with AsyncSessionLocal() as db:
        total_processed = 0
        total_chunks = 0
        total_skipped = 0
        errors = []

        # Process each PDF with progress bar
        for pdf_info in tqdm(pdfs, desc="Processing PDFs", unit="file"):
            try:
                # Check if already exists
                if skip_existing:
                    existing = await db.execute(
                        select(Textbook).where(Textbook.file_path == pdf_info["file_path"])
                    )
                    if existing.scalar_one_or_none():
                        total_skipped += 1
                        continue

                # Process the PDF
                metadata = {
                    "subject": pdf_info["subject"],
                    "grade": pdf_info["grade"],
                    "title": pdf_info["title"],
                }

                textbook, num_chunks = await process_pdf(
                    pdf_info["file_path"], metadata, db, skip_existing=skip_existing
                )

                total_processed += 1
                total_chunks += num_chunks

                tqdm.write(
                    f"✅ Processed: {pdf_info['subject']}/Grade {pdf_info['grade']} - "
                    f"{pdf_info['title']} ({textbook.total_pages} pages, {num_chunks} chunks)"
                )

            except Exception as e:
                error_msg = f"❌ Error processing {pdf_info['file_path']}: {e}"
                tqdm.write(error_msg)
                errors.append({"file": pdf_info["file_path"], "error": str(e)})
                continue

        # Print summary
        print("\n" + "=" * 60)
        print("📊 INGESTION SUMMARY")
        print("=" * 60)
        print(f"✅ Successfully processed: {total_processed} file(s)")
        print(f"📦 Total chunks created: {total_chunks:,}")
        print(f"⏭️  Skipped (already exist): {total_skipped} file(s)")
        print(f"❌ Errors: {len(errors)} file(s)")

        if errors:
            print("\n⚠️  ERRORS:")
            for error in errors:
                print(f"   - {os.path.basename(error['file'])}: {error['error']}")

        print("=" * 60)


async def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Bulk ingest PDF textbooks into Samga.ai library database"
    )
    parser.add_argument(
        "--library-root",
        type=str,
        default="dataset/library",
        help="Root directory containing library structure (default: dataset/library)",
    )
    parser.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="Re-process files that already exist in database",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Only discover files without processing (dry run)"
    )

    args = parser.parse_args()

    # Resolve library root path (relative to project root)
    project_root = Path(__file__).parent.parent.parent
    library_root = project_root / args.library_root

    if not library_root.exists():
        print(f"❌ Library directory not found: {library_root}")
        print(
            f"   Please create the directory structure: {library_root}/{{subject}}/{{grade}}/*.pdf"
        )
        return

    await ingest_library(
        library_root=str(library_root),
        skip_existing=not args.no_skip_existing,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    asyncio.run(main())
