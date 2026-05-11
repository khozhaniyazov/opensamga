import asyncio

from sqlalchemy import func, select, text

from app.database import AsyncSessionLocal
from app.models import Textbook, TextbookChunk


async def health_check():
    async with AsyncSessionLocal() as db:
        print("🏥 Starting Database Health Check...")

        # 1. Count Textbooks
        result = await db.execute(select(func.count()).select_from(Textbook))
        book_count = result.scalar()
        print(f"📚 Textbooks in DB: {book_count}")

        # 2. Count Chunks
        result = await db.execute(select(func.count()).select_from(TextbookChunk))
        chunk_count = result.scalar()
        print(f"🧩 Chunks in DB:    {chunk_count}")

        if chunk_count == 0:
            print("\n❌ CRITICAL ERROR: Your chunk table is EMPTY.")
            print("   The app has nothing to search.")
            print("   Please run your ingestion script again.")
        else:
            print(
                f"\n✅ Data exists. Average chunks per book: {chunk_count / (book_count or 1):.0f}"
            )

            # 3. Test a Search
            print("\n🔎 Running Test Search (History)...")
            sql = text("""
                SELECT content, (chunk_embedding <=> (SELECT chunk_embedding FROM textbook_chunks LIMIT 1)) as dist
                FROM textbook_chunks
                ORDER BY dist LIMIT 3
            """)
            try:
                rows = (await db.execute(sql)).fetchall()
                for row in rows:
                    print(f"   - Found chunk (Dist: {row.dist:.4f}): {row.content[:50]}...")
            except Exception as e:
                print(f"   ⚠️ Search failed: {e}")


if __name__ == "__main__":
    asyncio.run(health_check())
