import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

# --- PATH SETUP ---
current_file_path = Path(__file__).resolve()
backend_dir = current_file_path.parent.parent
sys.path.insert(0, str(backend_dir))

from app.database import AsyncSessionLocal
from app.models import Textbook


def normalize_title(title: str) -> str:
    """
    Normalizes titles to find matches between 'algebra_10' and 'Algebra 10'.
    Removes spaces, underscores, and casing.
    """
    return title.lower().replace("_", "").replace(" ", "")


async def clean_duplicates():
    async with AsyncSessionLocal() as db:
        print("🧹 Starting Surgical Cleanup...")

        result = await db.execute(select(Textbook))
        all_books = result.scalars().all()

        # Group by Subject + Grade + Normalized Title
        # This ensures 'Algebra' and 'Geometry' are NOT grouped together.
        grouped = {}
        for book in all_books:
            # Key: "mathematics_10_algebra10"
            norm_title = normalize_title(book.title)
            key = f"{book.subject}_{book.grade}_{norm_title}"

            if key not in grouped:
                grouped[key] = []
            grouped[key].append(book)

        deleted_count = 0

        for _key, books in grouped.items():
            if len(books) > 1:
                # We found duplicates (e.g. 'algebra_10.pdf' and 'Algebra 10.md')

                # Strategy:
                # 1. Prefer .md files (converted) over .pdf
                # 2. Prefer more chunks
                # 3. Prefer newer ID

                # Sort: Best books First
                # Criteria: Is Markdown? (1/0), Chunk Count (Desc), ID (Desc)
                books.sort(
                    key=lambda x: (1 if x.file_name.endswith(".md") else 0, x.total_chunks, x.id),
                    reverse=True,
                )

                winner = books[0]
                losers = books[1:]

                print(f"\nFound duplicates for '{winner.title}':")
                print(
                    f"   ✅ KEEPING: ID {winner.id} [{winner.file_name}] ({winner.total_chunks} chunks)"
                )

                for loser in losers:
                    print(
                        f"   ❌ DELETING: ID {loser.id} [{loser.file_name}] ({loser.total_chunks} chunks)"
                    )
                    await db.delete(loser)
                    deleted_count += 1

        if deleted_count > 0:
            await db.commit()
            print(f"\n✅ Cleanup Complete. Deleted {deleted_count} garbage records.")
        else:
            print("\n✅ No duplicates found (Strict matching).")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(clean_duplicates())
