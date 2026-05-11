"""
Library Ingestion Service for Samga.ai

Processes PDF textbooks and ingests them into the database with vector embeddings
for RAG (Retrieval-Augmented Generation) functionality.
"""

import logging
import os
import re

import fitz  # PyMuPDF
import tiktoken
from openai import AsyncOpenAI
from sentence_transformers import SentenceTransformer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Textbook, TextbookChunk

logger = logging.getLogger(__name__)

# Initialize tiktoken encoder for token counting
try:
    encoding = tiktoken.encoding_for_model("gpt-4")
except Exception:
    # Fallback to cl100k_base if gpt-4 encoding not available
    encoding = tiktoken.get_encoding("cl100k_base")

# Target chunk size in tokens (~500 tokens per chunk)
TARGET_CHUNK_TOKENS = 500
OVERLAP_TOKENS = 50  # Overlap between chunks for context preservation
_local_model: SentenceTransformer | None = None


def get_local_embedding_model() -> SentenceTransformer:
    global _local_model
    if _local_model is None:
        _local_model = SentenceTransformer(settings.LIBRARY_EMBEDDING_MODEL)
    return _local_model


def clean_text(text: str) -> str:
    """
    Clean extracted text from PDF:
    - Remove excessive whitespace
    - Remove common header/footer patterns
    - Normalize line breaks
    """
    if not text:
        return ""

    # Remove excessive whitespace
    text = re.sub(r"\s+", " ", text)

    # Remove common header/footer patterns (page numbers, repeated titles)
    # This is a simple heuristic - can be improved with more sophisticated patterns
    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        line = line.strip()
        # Skip lines that are just page numbers or very short repeated text
        if len(line) < 3:
            continue
        # Skip lines that are just numbers (likely page numbers)
        if line.isdigit() and len(line) < 5:
            continue
        cleaned_lines.append(line)

    text = " ".join(cleaned_lines)

    # Final cleanup
    text = text.strip()
    return text


def chunk_text(
    text: str, target_tokens: int = TARGET_CHUNK_TOKENS, overlap: int = OVERLAP_TOKENS
) -> list[tuple[str, int]]:
    """
    Split text into chunks of approximately target_tokens size.
    Returns list of (chunk_text, token_count) tuples.

    Uses sentence boundaries when possible to avoid breaking mid-sentence.
    """
    if not text:
        return []

    # Count tokens in the text
    tokens = encoding.encode(text)
    total_tokens = len(tokens)

    # If text is smaller than target, return as single chunk
    if total_tokens <= target_tokens:
        return [(text, total_tokens)]

    chunks = []

    # Split by sentences first (better for context preservation)
    sentences = re.split(r"([.!?]\s+)", text)
    # Recombine sentences with their punctuation
    combined_sentences = []
    for i in range(0, len(sentences) - 1, 2):
        if i + 1 < len(sentences):
            combined_sentences.append(sentences[i] + sentences[i + 1])
        else:
            combined_sentences.append(sentences[i])

    current_chunk = []
    current_tokens = 0

    for sentence in combined_sentences:
        sentence_tokens = len(encoding.encode(sentence))

        # If adding this sentence would exceed target, finalize current chunk
        if current_tokens + sentence_tokens > target_tokens and current_chunk:
            chunk_str = " ".join(current_chunk)
            chunks.append((chunk_str, current_tokens))

            # Start new chunk with overlap (last few sentences of previous chunk)
            overlap_sentences = []
            overlap_token_count = 0
            for s in reversed(current_chunk):
                s_tokens = len(encoding.encode(s))
                if overlap_token_count + s_tokens <= overlap:
                    overlap_sentences.insert(0, s)
                    overlap_token_count += s_tokens
                else:
                    break

            current_chunk = overlap_sentences + [sentence]
            current_tokens = overlap_token_count + sentence_tokens
        else:
            current_chunk.append(sentence)
            current_tokens += sentence_tokens

    # Add remaining chunk
    if current_chunk:
        chunk_str = " ".join(current_chunk)
        chunks.append((chunk_str, current_tokens))

    return chunks


async def get_embedding(text: str) -> list[float]:
    """
    Generate vector embedding for text using OpenAI.
    Returns 1536-dimensional vector (text-embedding-3-small).
    """
    try:
        if settings.LIBRARY_EMBEDDING_PROVIDER.lower() == "local":
            model = get_local_embedding_model()
            return model.encode(
                [text],
                convert_to_numpy=True,
                normalize_embeddings=True,
            )[0].tolist()

        client_kwargs = {
            "api_key": settings.EMBEDDING_API_KEY.get_secret_value()
            or settings.OPENAI_API_KEY.get_secret_value()
        }
        if settings.EMBEDDING_BASE_URL or settings.OPENAI_BASE_URL:
            client_kwargs["base_url"] = settings.EMBEDDING_BASE_URL or settings.OPENAI_BASE_URL

        async with AsyncOpenAI(**client_kwargs) as client:
            response = await client.embeddings.create(model=settings.EMBEDDING_MODEL, input=text)
            if not response.data or not response.data[0].embedding:
                raise ValueError("No embedding data received")
            return response.data[0].embedding
    except Exception:
        logger.exception("Error generating embedding")
        raise


async def check_textbook_exists(db: AsyncSession, file_path: str) -> Textbook | None:
    """
    Check if a textbook with the given file_path already exists in the database.
    """
    result = await db.execute(select(Textbook).where(Textbook.file_path == file_path))
    return result.scalar_one_or_none()


async def process_pdf(
    file_path: str, metadata: dict[str, any], db: AsyncSession, skip_existing: bool = True
) -> tuple[Textbook, int]:
    """
    Process a PDF file and ingest it into the database.

    Args:
        file_path: Full path to the PDF file
        metadata: Dictionary with keys: subject, grade, title (optional)
        db: Database session
        skip_existing: If True, skip files that already exist in DB

    Returns:
        Tuple of (Textbook object, number of chunks created)

    Raises:
        Exception if processing fails
    """
    # Normalize file path
    file_path = os.path.abspath(file_path)

    # Check if already exists
    if skip_existing:
        existing = await check_textbook_exists(db, file_path)
        if existing:
            logger.info(
                "Skipping %s - already exists in database (id=%s)",
                file_path,
                existing.id,
            )
            return existing, existing.total_chunks

    # Extract metadata
    subject = metadata.get("subject", "Unknown")
    grade = metadata.get("grade", 0)
    title = metadata.get("title") or os.path.basename(file_path)
    file_name = os.path.basename(file_path)

    # Open PDF
    try:
        doc = fitz.open(file_path)
        total_pages = len(doc)
    except Exception as exc:
        raise Exception(f"Failed to open PDF {file_path}: {exc}") from exc

    # Extract text from all pages
    all_chunks = []

    for page_num in range(total_pages):
        try:
            page = doc[page_num]
            text = page.get_text()

            # Clean the text
            cleaned_text = clean_text(text)

            if not cleaned_text:
                continue  # Skip empty pages

            # Chunk the text
            page_chunks = chunk_text(cleaned_text)

            # Add page number to each chunk
            for chunk_index, (chunk_str, token_count) in enumerate(page_chunks):
                all_chunks.append(
                    {
                        "page_number": page_num + 1,  # 1-indexed
                        "chunk_index": chunk_index,
                        "content": chunk_str,
                        "token_count": token_count,
                    }
                )

        except Exception:
            logger.warning(
                "Failed to process page %d of %s",
                page_num + 1,
                file_path,
                exc_info=True,
            )
            continue

    doc.close()

    if not all_chunks:
        raise Exception(f"No text content extracted from {file_path}")

    # Create Textbook record
    textbook = Textbook(
        title=title,
        subject=subject,
        grade=grade,
        file_path=file_path,
        file_name=file_name,
        total_pages=total_pages,
        total_chunks=len(all_chunks),
    )

    db.add(textbook)
    await db.flush()  # Flush to get the ID

    # Generate embeddings and create chunks
    chunk_objects = []

    for chunk_data in all_chunks:
        # Generate embedding
        embedding = await get_embedding(chunk_data["content"])

        # Create chunk object
        chunk = TextbookChunk(
            textbook_id=textbook.id,
            page_number=chunk_data["page_number"],
            chunk_index=chunk_data["chunk_index"],
            content=chunk_data["content"],
            token_count=chunk_data["token_count"],
            chunk_embedding=embedding,
        )

        chunk_objects.append(chunk)

    # Bulk insert chunks
    db.add_all(chunk_objects)

    # Commit everything
    await db.commit()
    await db.refresh(textbook)

    return textbook, len(all_chunks)
