import asyncio
import os
import sys
from pathlib import Path

from tqdm import tqdm

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import and_, delete, func, or_, select
from textbook_markdown_utils import cleanup_markdown_document, split_markdown_pages

from app.constants.subjects import normalize_subject_name
from app.database import AsyncSessionLocal
from app.models import GeneratedQuestion, MistakeReview, Textbook, TextbookChunk
from app.services.vector_search import get_embedding
from app.utils.textbook_metadata import build_markdown_source_metadata

# --- CONFIGURATION ---
CHUNK_SIZE = 800
BATCH_SIZE = 20


async def get_or_create_textbook(db, metadata: dict) -> Textbook:
    desired_path = Path(metadata["file_path"]).resolve()
    desired_name = Path(metadata["file_name"]).name.casefold()
    desired_stem = Path(metadata["file_name"]).stem.casefold()
    desired_title = str(metadata["title"]).strip().casefold()
    stmt = select(Textbook).where(
        or_(
            Textbook.file_path == str(desired_path),
            func.lower(Textbook.file_name) == desired_name,
            and_(
                Textbook.subject == metadata["subject"],
                Textbook.grade == metadata["grade"],
            ),
        )
    )
    result = await db.execute(stmt)
    textbook = None

    for candidate in result.scalars().all():
        candidate_path = Path(candidate.file_path).resolve() if candidate.file_path else None
        if candidate_path and candidate_path == desired_path:
            textbook = candidate
            break

        candidate_name = (candidate.file_name or "").casefold()
        if candidate_name and candidate_name == desired_name:
            textbook = candidate
            break

        candidate_stem = Path(candidate.file_name or "").stem.casefold()
        if candidate_stem and candidate_stem == desired_stem:
            textbook = candidate
            break

        candidate_title = (candidate.title or "").strip().casefold()
        if candidate_title and candidate_title == desired_title:
            textbook = candidate

    if not textbook:
        textbook = Textbook(
            title=metadata["title"],
            subject=metadata["subject"],
            grade=metadata["grade"],
            file_path=str(metadata["file_path"]),
            file_name=metadata["file_name"],
            total_pages=1,
            total_chunks=0,
        )
        db.add(textbook)
        await db.commit()
        await db.refresh(textbook)
    else:
        textbook.title = metadata["title"]
        textbook.subject = metadata["subject"]
        textbook.grade = metadata["grade"]
        textbook.file_path = str(desired_path)
        textbook.file_name = metadata["file_name"]
        await db.commit()
        await db.refresh(textbook)
    return textbook


def chunk_text(text: str, target_size: int = CHUNK_SIZE) -> list[str]:
    paragraphs = text.split("\n\n")
    chunks = []
    current_chunk = []
    current_length = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if current_length + len(para) > target_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = []
            current_length = 0
        current_chunk.append(para)
        current_length += len(para)
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))
    return chunks


def load_markdown_pages(file_path: Path) -> list[tuple[int | None, str]]:
    raw_content = file_path.read_text(encoding="utf-8", errors="ignore")
    cleaned_content, _ = cleanup_markdown_document(raw_content)
    if not cleaned_content.strip():
        return []
    return [
        (page_number, content)
        for page_number, content in split_markdown_pages(cleaned_content)
        if content.strip()
    ]


async def clear_existing_chunks(db, textbook: Textbook) -> bool:
    chunk_ids = (
        (await db.execute(select(TextbookChunk.id).where(TextbookChunk.textbook_id == textbook.id)))
        .scalars()
        .all()
    )
    if not chunk_ids:
        return True

    mistake_refs = await db.scalar(
        select(func.count())
        .select_from(MistakeReview)
        .where(MistakeReview.textbook_chunk_id.in_(chunk_ids))
    )
    if mistake_refs:
        tqdm.write(
            f"WARNING: Skipping refresh for {textbook.file_name}: {mistake_refs} mistake reviews still reference its chunks"
        )
        return False

    await db.execute(
        delete(GeneratedQuestion).where(GeneratedQuestion.anchor_chunk_id.in_(chunk_ids))
    )
    await db.execute(delete(TextbookChunk).where(TextbookChunk.textbook_id == textbook.id))
    textbook.total_chunks = 0
    await db.commit()
    return True


async def process_markdown_file(db, file_path: Path, pbar_main, refresh_existing: bool = False):
    try:
        try:
            grade_dir = file_path.parent
            subject_dir = grade_dir.parent
            grade = int(grade_dir.name)
            subject = normalize_subject_name(subject_dir.name)
        except ValueError:
            return

        current_dir = Path(__file__).resolve().parent
        project_root = current_dir.parent.parent
        metadata = build_markdown_source_metadata(
            md_path=file_path,
            subject=subject,
            grade=grade,
            project_root=project_root,
        )

        textbook = await get_or_create_textbook(db, metadata)

        # Check if chunks exist
        stmt = (
            select(func.count())
            .select_from(TextbookChunk)
            .where(TextbookChunk.textbook_id == textbook.id)
        )
        chunk_count = await db.scalar(stmt)

        if chunk_count and chunk_count > 0:
            if not refresh_existing:
                return
            if not await clear_existing_chunks(db, textbook):
                return
            chunk_count = 0

        if chunk_count and chunk_count > 0:
            return

        markdown_pages = load_markdown_pages(file_path)
        if not markdown_pages:
            tqdm.write(
                f"WARNING: Skipping {file_path.name}: markdown cleanup produced no usable content"
            )
            return

        new_chunks = []
        total_chunks = 0
        max_page_number = 0

        page_iterator = tqdm(
            markdown_pages,
            desc=f"   -> {metadata['title'][:15]}...",
            leave=False,
            unit="pg",
            ascii=True,
            ncols=80,
        )

        for fallback_index, (page_marker, page_content) in enumerate(page_iterator, start=1):
            page_number = page_marker + 1 if page_marker is not None else fallback_index
            max_page_number = max(max_page_number, page_number)

            for chunk_index, chunk_content in enumerate(chunk_text(page_content)):
                vector = await get_embedding(chunk_content)

                if vector:
                    new_chunks.append(
                        TextbookChunk(
                            textbook_id=textbook.id,
                            page_number=page_number,
                            chunk_index=chunk_index,
                            content=chunk_content,
                            token_count=len(chunk_content) // 4,
                            chunk_embedding=vector,
                        )
                    )
                    total_chunks += 1

                if len(new_chunks) >= BATCH_SIZE:
                    db.add_all(new_chunks)
                    await db.commit()
                    new_chunks = []

        if new_chunks:
            db.add_all(new_chunks)
            await db.commit()

        textbook.total_chunks = total_chunks
        textbook.total_pages = max_page_number or len(markdown_pages)
        await db.commit()

    except Exception as e:
        tqdm.write(f"ERROR: {e}")
    finally:
        pbar_main.update(1)


async def main(match: str | None = None, refresh_existing: bool = False):
    current_dir = Path(__file__).resolve().parent
    project_root = current_dir.parent.parent
    converted_dir = project_root / "dataset" / "converted_library"

    if not converted_dir.exists():
        print(f"ERROR: Directory not found: {converted_dir}")
        return

    md_files = list(converted_dir.rglob("*.md"))
    if match:
        match_text = match.casefold()
        md_files = [
            path
            for path in md_files
            if match_text in str(path.relative_to(converted_dir)).casefold()
        ]
    print(f"Found {len(md_files)} converted books.")
    print("Starting vector ingestion...")

    async with AsyncSessionLocal() as db:
        # FIX: Added ascii=True here too
        with tqdm(total=len(md_files), desc="Total Progress", ascii=True, ncols=80) as pbar:
            for md_file in md_files:
                await process_markdown_file(db, md_file, pbar, refresh_existing=refresh_existing)

    print("\nIngestion complete.")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    import argparse

    parser = argparse.ArgumentParser(
        description="Ingest OCR markdown textbooks into pgvector chunks"
    )
    parser.add_argument(
        "--match",
        default=None,
        help="Only ingest markdown files whose relative path contains this text",
    )
    parser.add_argument(
        "--refresh-matched",
        action="store_true",
        help="For matched books only, replace existing chunks when they have no mistake-review dependencies",
    )
    args = parser.parse_args()
    asyncio.run(main(match=args.match, refresh_existing=args.refresh_matched))
