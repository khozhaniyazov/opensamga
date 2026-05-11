"""
Repair broken OKULYK downloads and sync textbook metadata in the database.

What it fixes:
- placeholder HTML pages saved with `.pdf` extension
- textbook rows that still point at repaired files but keep 2-page placeholder metadata
- placeholder chunks created from those HTML files

This script intentionally does NOT regenerate embeddings for repaired books.
Instead it removes corrupt placeholder chunks and keeps the real PDF catalog usable.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import fitz
import requests
from bs4 import BeautifulSoup
from sqlalchemy import delete, select

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.database import AsyncSessionLocal
from app.models import GeneratedQuestion, Textbook, TextbookChunk
from app.utils.textbook_metadata import build_catalog_title

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_LIBRARY_DIR = PROJECT_ROOT / "dataset" / "raw_library"
PDF_SIZE_MIN = 50_000
PLACEHOLDER_PAGE_LIMIT = 2
BASE_URL = "https://okulyk.kz"
BOOKS_CDN = "https://books.okulyk.kz"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Referer": BASE_URL,
}

INVALID_TITLES = {"", "unknown", "untitled", "nan", "none"}
LANGUAGE_SUFFIXES = {"ru", "kz", "en", "eng", "анг", "рус", "ру", "кз", "каз", "қаз"}


def is_html_payload(data: bytes) -> bool:
    prefix = data[:512].lstrip().lower()
    return prefix.startswith(b"<!doctype html") or prefix.startswith(b"<html")


def is_placeholder_pdf(path: Path) -> bool:
    if not path.exists():
        return True
    if path.stat().st_size < PDF_SIZE_MIN:
        try:
            raw = path.read_bytes()
            if is_html_payload(raw):
                return True
        except OSError:
            return True
    try:
        doc = fitz.open(path)
    except Exception:
        return True

    try:
        metadata_title = (doc.metadata or {}).get("title", "")
        if "okulyk.kz" in metadata_title.lower() or "скачать pdf" in metadata_title.lower():
            return True
        if len(doc) <= PLACEHOLDER_PAGE_LIMIT and path.stat().st_size < PDF_SIZE_MIN * 2:
            return True
        return False
    finally:
        doc.close()


def fetch_html(url: str) -> str | None:
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.text


def extract_pdf_url(page_html: str, source_url: str) -> str | None:
    soup = BeautifulSoup(page_html, "html.parser")

    for attr in ("data-src", "data-pdf"):
        for node in soup.find_all(attrs={attr: True}):
            value = str(node.get(attr) or "").strip()
            if ".pdf" not in value.lower():
                continue
            if value.startswith("http"):
                return value
            if value.startswith("/"):
                return f"{BASE_URL}{value}"

    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "").strip()
        if href.startswith(BOOKS_CDN) and ".pdf" in href.lower():
            return href

    book_id = source_url.rstrip("/").split("/")[-1]
    if book_id.isdigit():
        return f"{BOOKS_CDN}/{book_id}/{book_id}.pdf"
    return None


def download_real_pdf(pdf_url: str) -> bytes:
    response = requests.get(pdf_url, headers=HEADERS, timeout=120)
    response.raise_for_status()
    payload = response.content
    if len(payload) < PDF_SIZE_MIN or not payload.startswith(b"%PDF"):
        raise ValueError(f"Downloaded payload is not a valid PDF: {pdf_url}")
    return payload


def repair_placeholder_pdf(pdf_path: Path) -> tuple[str, str]:
    sidecar_path = pdf_path.with_suffix(".json")
    if not sidecar_path.exists():
        return "fail", f"{pdf_path}: missing sidecar JSON"

    try:
        metadata = json.loads(sidecar_path.read_text(encoding="utf-8"))
        source_url = str(metadata.get("source_url") or "").strip()
        if not source_url:
            raise ValueError("sidecar JSON has no source_url")

        page_html = fetch_html(source_url)
        if not page_html:
            raise ValueError("failed to fetch book page")

        pdf_url = extract_pdf_url(page_html, source_url)
        if not pdf_url:
            raise ValueError("could not resolve real PDF URL")

        payload = download_real_pdf(pdf_url)

        tmp_path = pdf_path.with_suffix(".tmp")
        tmp_path.write_bytes(payload)
        try:
            doc = fitz.open(tmp_path)
            page_count = len(doc)
            doc.close()
        except Exception as exc:
            tmp_path.unlink(missing_ok=True)
            raise ValueError(f"downloaded PDF failed validation: {exc}") from exc

        if page_count <= PLACEHOLDER_PAGE_LIMIT:
            tmp_path.unlink(missing_ok=True)
            raise ValueError("downloaded PDF still looks like a placeholder")

        tmp_path.replace(pdf_path)
        return "repaired", str(pdf_path)
    except Exception as exc:
        return "fail", f"{pdf_path}: {exc}"


def repair_placeholder_pdfs(workers: int = 4) -> dict[str, Any]:
    repaired = 0
    skipped = 0
    failed: list[str] = []

    candidates: list[Path] = []
    for pdf_path in sorted(RAW_LIBRARY_DIR.rglob("*.pdf")):
        if is_placeholder_pdf(pdf_path):
            candidates.append(pdf_path)
        else:
            skipped += 1

    if not candidates:
        return {"repaired": repaired, "skipped": skipped, "failed": failed}

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(repair_placeholder_pdf, path): path for path in candidates}
        for future in as_completed(futures):
            status, message = future.result()
            if status == "repaired":
                repaired += 1
            else:
                failed.append(message)

    return {"repaired": repaired, "skipped": skipped, "failed": failed}


def infer_subject_and_grade(pdf_path: Path) -> tuple[str, int | None]:
    relative = pdf_path.relative_to(RAW_LIBRARY_DIR)
    parts = relative.parts
    subject = parts[0] if len(parts) >= 1 else "Unknown"
    grade = None
    if len(parts) >= 2 and parts[1].isdigit():
        grade = int(parts[1])
    return subject, grade


async def sync_textbook_catalog() -> dict[str, int]:
    updated = 0
    inserted = 0
    placeholder_chunks_removed = 0
    placeholder_questions_removed = 0
    placeholder_books_removed = 0

    async with AsyncSessionLocal() as session:
        existing_books = (await session.execute(select(Textbook))).scalars().all()
        books_by_path = {
            Path(book.file_path).resolve(): book for book in existing_books if book.file_path
        }
        books_by_name: dict[str, list[Textbook]] = {}
        for book in existing_books:
            if not book.file_name:
                continue
            books_by_name.setdefault(book.file_name.casefold(), []).append(book)

        placeholder_paths = {
            pdf_path.resolve()
            for pdf_path in sorted(RAW_LIBRARY_DIR.rglob("*.pdf"))
            if is_placeholder_pdf(pdf_path)
        }

        for placeholder_path in placeholder_paths:
            book = books_by_path.get(placeholder_path)
            if book is None:
                continue

            chunk_ids = (
                (
                    await session.execute(
                        select(TextbookChunk.id).where(TextbookChunk.textbook_id == book.id)
                    )
                )
                .scalars()
                .all()
            )

            if chunk_ids:
                deleted_questions = await session.execute(
                    delete(GeneratedQuestion).where(
                        GeneratedQuestion.anchor_chunk_id.in_(chunk_ids)
                    )
                )
                placeholder_questions_removed += deleted_questions.rowcount or 0

            deleted_chunks = await session.execute(
                delete(TextbookChunk).where(TextbookChunk.textbook_id == book.id)
            )
            placeholder_chunks_removed += deleted_chunks.rowcount or 0

            await session.delete(book)
            books_by_path.pop(placeholder_path, None)
            if book.file_name:
                matches = books_by_name.get(book.file_name.casefold(), [])
                books_by_name[book.file_name.casefold()] = [
                    item for item in matches if item.id != book.id
                ]
            placeholder_books_removed += 1

        for pdf_path in sorted(RAW_LIBRARY_DIR.rglob("*.pdf")):
            if is_placeholder_pdf(pdf_path):
                continue

            try:
                doc = fitz.open(pdf_path)
                pdf_title = (doc.metadata or {}).get("title")
                total_pages = len(doc)
                doc.close()
            except Exception:
                continue

            subject, grade = infer_subject_and_grade(pdf_path)
            sidecar_path = pdf_path.with_suffix(".json")
            sidecar_meta = {}
            if sidecar_path.exists():
                try:
                    sidecar_meta = json.loads(sidecar_path.read_text(encoding="utf-8"))
                except Exception:
                    sidecar_meta = {}

            title = build_catalog_title(
                sidecar_meta.get("title"),
                pdf_title,
                pdf_path.name,
                subject,
                grade,
            )

            resolved_path = pdf_path.resolve()
            book = books_by_path.get(resolved_path)
            if book is None:
                same_name_candidates = books_by_name.get(pdf_path.name.casefold(), [])
                if same_name_candidates:
                    book = max(
                        same_name_candidates,
                        key=lambda item: (
                            1 if (item.total_chunks or 0) > 0 else 0,
                            item.total_chunks or 0,
                            item.total_pages or 0,
                            item.id,
                        ),
                    )

            if book is None:
                book = Textbook(
                    title=title,
                    subject=subject,
                    grade=grade or 0,
                    file_path=str(resolved_path),
                    file_name=pdf_path.name,
                    total_pages=total_pages,
                    total_chunks=0,
                )
                session.add(book)
                books_by_path[resolved_path] = book
                books_by_name.setdefault(pdf_path.name.casefold(), []).append(book)
                inserted += 1
                continue

            was_placeholder = (
                book.total_pages <= PLACEHOLDER_PAGE_LIMIT
                or "okulyk.kz" in (book.title or "").lower()
                or "скачать pdf" in (book.title or "").lower()
            )

            previous_path = Path(book.file_path).resolve() if book.file_path else None
            if previous_path and previous_path != resolved_path:
                books_by_path.pop(previous_path, None)

            book.title = title
            book.subject = subject
            book.grade = grade or book.grade
            book.file_path = str(resolved_path)
            book.file_name = pdf_path.name
            book.total_pages = total_pages
            books_by_path[resolved_path] = book

            if was_placeholder and book.total_chunks:
                chunk_ids = (
                    (
                        await session.execute(
                            select(TextbookChunk.id).where(TextbookChunk.textbook_id == book.id)
                        )
                    )
                    .scalars()
                    .all()
                )

                if chunk_ids:
                    deleted_questions = await session.execute(
                        delete(GeneratedQuestion).where(
                            GeneratedQuestion.anchor_chunk_id.in_(chunk_ids)
                        )
                    )
                    placeholder_questions_removed += deleted_questions.rowcount or 0

                deleted = await session.execute(
                    delete(TextbookChunk).where(TextbookChunk.textbook_id == book.id)
                )
                removed_count = deleted.rowcount or 0
                placeholder_chunks_removed += removed_count
                book.total_chunks = 0

            updated += 1

        await session.commit()

    return {
        "updated": updated,
        "inserted": inserted,
        "placeholder_chunks_removed": placeholder_chunks_removed,
        "placeholder_questions_removed": placeholder_questions_removed,
        "placeholder_books_removed": placeholder_books_removed,
    }


async def main(args: argparse.Namespace) -> None:
    repair_stats = {"repaired": 0, "skipped": 0, "failed": []}
    sync_stats = {
        "updated": 0,
        "inserted": 0,
        "placeholder_chunks_removed": 0,
        "placeholder_questions_removed": 0,
        "placeholder_books_removed": 0,
    }

    if not args.sync_only:
        repair_stats = repair_placeholder_pdfs(workers=args.workers)
    if not args.repair_only:
        sync_stats = await sync_textbook_catalog()

    print("=" * 72)
    print("OKULYK library repair completed")
    print("=" * 72)
    print(f"PDFs repaired                : {repair_stats['repaired']}")
    print(f"PDFs already valid           : {repair_stats['skipped']}")
    print(f"Catalog rows updated         : {sync_stats['updated']}")
    print(f"Catalog rows inserted        : {sync_stats['inserted']}")
    print(f"Placeholder books removed    : {sync_stats['placeholder_books_removed']}")
    print(f"Placeholder chunks removed   : {sync_stats['placeholder_chunks_removed']}")
    print(f"Broken questions removed     : {sync_stats['placeholder_questions_removed']}")
    print(f"Repair failures              : {len(repair_stats['failed'])}")
    for item in repair_stats["failed"][:20]:
        print(f"  - {item}")
    if len(repair_stats["failed"]) > 20:
        print(f"  ... and {len(repair_stats['failed']) - 20} more")
    print("=" * 72)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    parser = argparse.ArgumentParser(
        description="Repair broken OKULYK PDFs and sync textbook metadata"
    )
    parser.add_argument("--workers", type=int, default=4, help="Concurrent PDF repair workers")
    parser.add_argument("--repair-only", action="store_true", help="Only repair placeholder PDFs")
    parser.add_argument(
        "--sync-only", action="store_true", help="Only sync textbook metadata/chunks"
    )
    cli_args = parser.parse_args()
    asyncio.run(main(cli_args))
