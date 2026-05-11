from openai import AsyncOpenAI
from sentence_transformers import SentenceTransformer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import MockQuestion

# Import cache utility
from app.utils.cache import cache, cache_key

_local_model: SentenceTransformer | None = None
# BUG-12 (2026-04-19): multilingual shadow encoder, lazy-loaded.
_multilingual_model: SentenceTransformer | None = None


def get_local_embedding_model() -> SentenceTransformer:
    global _local_model
    if _local_model is None:
        _local_model = SentenceTransformer(settings.LIBRARY_EMBEDDING_MODEL)
    return _local_model


def get_multilingual_embedding_model() -> SentenceTransformer:
    """Lazy-load the multilingual shadow encoder used for RU<->KZ
    cross-lingual retrieval. Same embedding dim (384) as the legacy
    all-MiniLM-L6-v2 encoder, so the existing pgvector column width
    does not need to change."""
    global _multilingual_model
    if _multilingual_model is None:
        _multilingual_model = SentenceTransformer(settings.LIBRARY_EMBEDDING_MULTILINGUAL_MODEL)
    return _multilingual_model


def get_local_embedding(text: str) -> list[float]:
    model = get_local_embedding_model()
    vector = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0]
    return vector.tolist()


def get_multilingual_embedding(text: str) -> list[float]:
    model = get_multilingual_embedding_model()
    vector = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0]
    return vector.tolist()


async def get_embedding(text: str) -> list[float]:
    """Generate an embedding for `text` with 7-day caching.

    Session-10 rewrite: the primary path is DashScope
    text-embedding-v4 (multilingual, 1024-dim). Legacy paths
    (OpenAI, local MiniLM, local multilingual shadow) are still
    reachable through the existing settings for dev / fallback.

    Embeddings are deterministic (same text = same embedding), so we
    cache aggressively to reduce API latency + cost.
    """
    normalized_text = (text or "").lower().strip()

    # The cache namespace encodes the provider so we never serve a
    # 384-dim legacy vector to a 1024-dim reader (or vice versa).
    provider = (settings.LIBRARY_EMBEDDING_PROVIDER or "").lower()
    if provider == "dashscope":
        namespace = "embedding:qwen_v4"
    elif settings.RAG_USE_MULTILINGUAL:
        namespace = "embedding:ml"
    else:
        namespace = "embedding"
    key = f"{namespace}:{cache_key(normalized_text)}"

    cached_embedding = await cache.get(key)
    if cached_embedding is not None:
        return cached_embedding

    if provider == "dashscope":
        # Lazy import keeps unit tests lightweight.
        from app.services.qwen_dashscope import embed_text

        embedding = embed_text(text, dimensions=settings.EMBEDDING_DIMENSION)
    elif settings.RAG_USE_MULTILINGUAL:
        embedding = get_multilingual_embedding(text)
    elif provider == "local":
        embedding = get_local_embedding(text)
    else:
        client_kwargs = {
            "api_key": settings.EMBEDDING_API_KEY.get_secret_value()
            or settings.OPENAI_API_KEY.get_secret_value()
        }
        if settings.EMBEDDING_BASE_URL or settings.OPENAI_BASE_URL:
            client_kwargs["base_url"] = settings.EMBEDDING_BASE_URL or settings.OPENAI_BASE_URL
        async with AsyncOpenAI(**client_kwargs) as client:
            response = await client.embeddings.create(
                model=settings.EMBEDDING_MODEL,
                input=text,
            )
        if not response.data or not response.data[0].embedding:
            raise ValueError("No embedding data received")
        embedding = response.data[0].embedding

    await cache.set(key, embedding, ttl_seconds=7 * 24 * 3600)
    return embedding


async def search_textbooks(db: AsyncSession, query: str, limit: int = 5) -> list[dict]:
    """
    Search textbook chunks using vector similarity across all books.

    Args:
        db: Database session
        query: Search query string
        limit: Maximum number of results to return

    Returns:
        List of dictionaries with content, title, page, and similarity score
    """
    # Generate embedding for the query
    query_embedding = await get_embedding(query)
    query_vector = "[" + ",".join(str(float(value)) for value in query_embedding) + "]"

    # Build SQL query with pgvector cosine similarity
    # Use LEFT JOIN to handle orphaned chunks (where parent textbook is missing)
    sql = """
        SELECT
            tc.id,
            t.title,
            t.subject,
            tc.content,
            tc.page_number,
            (tc.chunk_embedding <=> CAST(:query_vector AS vector)) AS distance
        FROM textbook_chunks tc
        LEFT JOIN textbooks t ON tc.textbook_id = t.id
    """

    params = {"query_vector": query_vector}

    # Order by distance (ASC = most similar first) and apply limit
    sql += " ORDER BY distance ASC LIMIT :limit"
    params["limit"] = limit

    # Execute query
    result = await db.execute(text(sql), params)
    rows = result.fetchall()

    # Format results according to specification
    return [
        {
            "content": row.content,
            "title": row.title,
            "page": row.page_number,
            "similarity": 1 - row.distance,
        }
        for row in rows
    ]


async def store_question_with_embedding(
    db: AsyncSession,
    topic_tag: str,
    question_text: str,
    options: dict[str, str],
    correct_answer: str,
    difficulty: str = "MEDIUM",
) -> MockQuestion:
    """

    Helper to add a new question to the database with its embedding.

    Used by seeding scripts.

    """

    # Generate embedding

    embedding = await get_embedding(question_text)

    # Create question object

    question = MockQuestion(
        topic_tag=topic_tag,
        question_text=question_text,
        options=options,
        correct_answer=correct_answer,
        difficulty=difficulty,
        question_embedding=embedding,
    )

    db.add(question)

    await db.commit()

    await db.refresh(question)

    return question
