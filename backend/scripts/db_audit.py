import asyncio
import os
import sys

from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.db.session import engine


async def audit():
    async with engine.begin() as conn:
        print("--- Database Audit ---")
        # List all tables
        res = await conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        )
        tables = [row[0] for row in res]
        print(f"Tables found: {', '.join(tables)}")

        # Check specific library tables
        for table in [
            "documents",
            "document_chunks",
            "vector_embeddings",
            "historical_grant_thresholds",
        ]:
            if table in tables:
                count = await conn.execute(text(f"SELECT count(*) FROM {table}"))
                print(f"{table}: {count.scalar()} records")


if __name__ == "__main__":
    asyncio.run(audit())
