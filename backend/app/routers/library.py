"""
app/routers/library.py
----------------------
Smart Library API Router

Handles textbook browsing, PDF file serving, and RAG search functionality.
"""

import asyncio
import logging
import os
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Textbook, User
from ..services.library_retrieval import search_library_chunks

# Import cache utility
from ..utils.cache import cache, cache_key
from ..utils.sanitization import sanitize_filename, sanitize_text
from ..utils.textbook_metadata import build_catalog_title
from .auth import ALGORITHM, SECRET_KEY, get_current_user_optional

router = APIRouter(prefix="/library", tags=["library"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# BUG-13 fix (s22): gate PDF + page-thumbnail endpoints behind auth.
#
# Both endpoints are hit by browser primitives that cannot carry
# `Authorization` headers: `<img src>` for thumbnails and
# `<a href target="_blank">` for the full PDF. So we accept the JWT either
# as a Bearer header (normal XHR / fetch paths, e.g. react-pdf's
# httpHeaders) OR as a `?token=<jwt>` query parameter (for img/anchor).
#
# The query-parameter path is conventional for streamed assets that must
# be opened directly by the browser (cf. presigned S3 URLs, JWT-in-URL
# pattern on ShareX / Grafana / Nextcloud). The token is short-lived
# (ACCESS_TOKEN_EXPIRE_MINUTES) and never leaves the same-origin
# frontend → same-origin backend hop.
# ---------------------------------------------------------------------------


async def require_library_access(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> "User":
    """Require a valid JWT via Bearer header OR ``?token=`` query parameter.

    Raises 401 on any failure.
    """
    from jose import JWTError, jwt  # local import to avoid circular loop

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required to access library files",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # 1. Try Authorization: Bearer …
    token: str | None = None
    authorization = request.headers.get("Authorization") or ""
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip() or None

    # 2. Fallback: ?token=… (needed for <img src> / <a href target=_blank>)
    if not token:
        qp = request.query_params.get("token")
        if qp:
            token = qp.strip() or None

    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise credentials_exception
        # v3.3: refresh tokens are not access tokens. See routers/auth.py.
        if payload.get("type") == "refresh":
            raise credentials_exception
    except JWTError:
        raise credentials_exception from None
    except HTTPException:
        raise
    except Exception:
        raise credentials_exception from None

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception
    return user


def build_clean_title(
    title: str | None,
    file_name: str | None,
    subject: str | None,
    grade: int | None,
) -> str:
    return build_catalog_title(title, None, file_name or "", subject, grade)


def choose_best_textbook_versions(textbooks: list[Textbook]) -> list[Textbook]:
    """
    Deduplicate repeated textbook rows by catalog identity.

    The ingestion history contains placeholder and partial duplicates for the
    same PDF, and some duplicates arrived under different filenames. Prefer
    the version with real chunk coverage, then richer metadata, then the latest
    row.
    """
    grouped: dict[str, list[Textbook]] = defaultdict(list)
    ordered_keys: list[str] = []

    for textbook in textbooks:
        catalog_title = build_clean_title(
            textbook.title,
            textbook.file_name,
            textbook.subject,
            textbook.grade,
        )
        key = f"{textbook.subject or ''}|{textbook.grade or ''}|{catalog_title}".casefold()
        if key not in grouped:
            ordered_keys.append(key)
        grouped[key].append(textbook)

    chosen: list[Textbook] = []
    for key in ordered_keys:
        variants = grouped[key]
        best = max(
            variants,
            key=lambda tb: (
                1 if (tb.total_chunks or 0) > 0 else 0,
                tb.total_chunks or 0,
                tb.total_pages or 0,
                tb.updated_at.isoformat() if tb.updated_at else "",
                tb.id,
            ),
        )
        chosen.append(best)

    return chosen


# Helper function to resolve file paths
def resolve_pdf_path(stored_path: str) -> Path:
    """
    Resolve a file path from the database to an absolute path.
    Handles both absolute and relative paths.

    Args:
        stored_path: Path stored in database (may be absolute or relative)

    Returns:
        Resolved absolute Path object
    """
    if not stored_path:
        raise ValueError("Empty file path")

    # Normalize Windows paths - convert backslashes to forward slashes for Path
    # Path() handles both, but this ensures consistency
    normalized_path = (
        stored_path.replace("\\", "/") if os.sep == "\\" and "\\" in stored_path else stored_path
    )
    file_path = Path(normalized_path)

    # If already absolute, just resolve it (normalizes .. and .)
    if file_path.is_absolute():
        resolved = file_path.resolve()
        return resolved

    # If relative, try multiple resolution strategies
    # Strategy 1: Resolve relative to project root
    # Project root is 3 levels up from app/routers/library.py
    # app/routers/library.py -> app/routers -> app -> project_root
    backend_root = Path(__file__).parent.parent.parent
    resolved = (backend_root / file_path).resolve()

    # Strategy 2: If that doesn't exist, try from current working directory
    if not resolved.exists():
        cwd_resolved = Path(stored_path).resolve()
        if cwd_resolved.exists():
            resolved = cwd_resolved
        else:
            # Strategy 3: Try resolving from backend directory
            backend_dir = Path(__file__).parent.parent
            backend_resolved = (backend_dir / file_path).resolve()
            if backend_resolved.exists():
                resolved = backend_resolved

    return resolved


# --- PYDANTIC SCHEMAS ---


class BookResponse(BaseModel):
    id: int
    title: str
    subject: str
    grade: int
    total_pages: int
    total_chunks: int
    file_name: str
    created_at: str | None = None
    updated_at: str | None = None


class BookDetailResponse(BookResponse):
    file_path: str  # Only in detail response, not in list


class SearchRequest(BaseModel):
    query: str
    subject: str | None = None
    grade: int | None = None
    limit: int | None = 5


class CitationResponse(BaseModel):
    book_id: int
    book_title: str
    subject: str
    grade: int
    page_number: int
    snippet: str
    relevance_score: float


# --- ENDPOINTS ---


@router.get("/books", response_model=list[BookResponse])
async def get_books(
    subject: str | None = Query(None, description="Filter by subject (e.g., 'Mathematics')"),
    grade: int | None = Query(None, description="Filter by grade (e.g., 10)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a list of all available textbooks with 1-hour caching.

    Supports optional filtering by subject and/or grade.
    Textbook list is static data, so aggressive caching is appropriate.
    """
    # Generate cache key including filters
    key = f"books_list:{cache_key(subject, grade)}"

    # Check cache first
    cached_books = await cache.get(key)
    if cached_books is not None:
        return cached_books

    # Cache miss - query database
    stmt = select(Textbook)

    # Apply filters
    conditions = []
    if subject:
        conditions.append(Textbook.subject.ilike(f"%{subject}%"))
    if grade is not None:
        conditions.append(Textbook.grade == grade)

    if conditions:
        stmt = stmt.where(*conditions)

    # Order by subject, then grade, then title
    stmt = stmt.order_by(Textbook.subject, Textbook.grade, Textbook.title)

    result = await db.execute(stmt)
    textbooks = choose_best_textbook_versions(result.scalars().all())

    books_list = [
        BookResponse(
            id=tb.id,
            title=build_clean_title(tb.title, tb.file_name, tb.subject, tb.grade),
            subject=tb.subject,
            grade=tb.grade,
            total_pages=tb.total_pages,
            total_chunks=tb.total_chunks,
            file_name=tb.file_name,
            created_at=tb.created_at.isoformat() if tb.created_at else None,
            updated_at=tb.updated_at.isoformat() if tb.updated_at else None,
        )
        for tb in textbooks
    ]

    # Store in cache for 1 hour (textbooks rarely change)
    await cache.set(key, books_list, ttl_seconds=3600)

    return books_list


@router.get("/books/{book_id}", response_model=BookDetailResponse)
async def get_book(book_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get detailed information about a specific textbook.

    Returns full metadata including file_path.
    """
    stmt = select(Textbook).where(Textbook.id == book_id)
    result = await db.execute(stmt)
    textbook = result.scalars().first()

    if not textbook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Textbook with ID {book_id} not found"
        )

    return BookDetailResponse(
        id=textbook.id,
        title=build_clean_title(
            textbook.title, textbook.file_name, textbook.subject, textbook.grade
        ),
        subject=textbook.subject,
        grade=textbook.grade,
        total_pages=textbook.total_pages,
        total_chunks=textbook.total_chunks,
        file_name=textbook.file_name,
        file_path=textbook.file_path,
        created_at=textbook.created_at.isoformat() if textbook.created_at else None,
        updated_at=textbook.updated_at.isoformat() if textbook.updated_at else None,
    )


@router.get("/books/{book_id}/pdf")
async def get_book_pdf(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_library_access),
):
    """
    Stream the PDF file for a textbook.

    **Security:** File path is looked up from database (LFI protection).
    Only files that were ingested via our secure script can be accessed.

    Returns the PDF file as a binary response with appropriate headers.
    """
    # Look up textbook in database
    stmt = select(Textbook).where(Textbook.id == book_id)
    result = await db.execute(stmt)
    textbook = result.scalars().first()

    if not textbook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Textbook with ID {book_id} not found"
        )

    # Get file path from database (secure - no user input in path)
    stored_path = textbook.file_path

    if not stored_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Textbook file_path is empty in database",
        )

    # v3.48 (2026-05-02): replaced 19 print() calls in this endpoint
    # with logger.debug/info/warning. The previous shape leaked
    # absolute filesystem paths, CWD, and stored DB paths to stdout
    # AND to the HTTP error response body — both are path-disclosure
    # smells. Server-side detail now goes through `logger`; the
    # client gets a generic 404/500. The diagnostics still exist
    # at DEBUG level for operator triage.
    logger.debug(
        "library.serve_pdf: resolving book_id=%s title=%r stored_path=%r cwd=%s",
        book_id,
        textbook.title,
        stored_path,
        os.getcwd(),
    )

    # Resolve path to absolute - handle both absolute and relative paths
    try:
        file_path = resolve_pdf_path(stored_path)
    except Exception as exc:
        logger.exception(
            "library.serve_pdf: failed to resolve path for book_id=%s stored_path=%r",
            book_id,
            stored_path,
        )
        # Generic message — do NOT echo the exception string back to
        # the client; it can carry the absolute path that triggered
        # the failure. The chain (`from exc`) is kept so the
        # logger.exception trace and __cause__ correlate.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resolve textbook file path",
        ) from exc

    logger.debug(
        "library.serve_pdf: resolved book_id=%s path=%s exists=%s is_file=%s",
        book_id,
        file_path,
        file_path.exists(),
        file_path.is_file() if file_path.exists() else False,
    )

    # Check if file exists
    if not file_path.exists():
        # Server-side: full detail in logs for triage.
        # Client-side: generic 404 — no path leak.
        logger.warning(
            "library.serve_pdf: file missing book_id=%s stored_path=%r resolved=%s cwd=%s",
            book_id,
            stored_path,
            file_path,
            os.getcwd(),
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Textbook file not found",
        )

    # Handle case where database has .md file but we need .pdf
    # If stored path is .md, try to find corresponding .pdf in raw_library
    if file_path.suffix.lower() == ".md":
        logger.info(
            "library.serve_pdf: book_id=%s has .md path; searching for corresponding .pdf",
            book_id,
        )
        # Try to find PDF in raw_library with same structure
        # e.g., converted_library/Mathematics/10/algebra_10.md -> raw_library/Mathematics/10/algebra_10.pdf
        path_str = str(file_path)
        if "converted_library" in path_str:
            # Replace converted_library with raw_library and .md with .pdf
            pdf_path_str = path_str.replace("converted_library", "raw_library").replace(
                ".md", ".pdf"
            )
            pdf_path = Path(pdf_path_str)
            logger.debug(
                "library.serve_pdf: book_id=%s probing for sibling pdf at %s",
                book_id,
                pdf_path,
            )
            if pdf_path.exists():
                logger.info(
                    "library.serve_pdf: book_id=%s found sibling pdf at %s",
                    book_id,
                    pdf_path,
                )
                file_path = pdf_path
            else:
                logger.warning(
                    "library.serve_pdf: book_id=%s md present but sibling pdf missing md=%s pdf=%s",
                    book_id,
                    file_path,
                    pdf_path,
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Textbook PDF not found",
                )
        else:
            logger.warning(
                "library.serve_pdf: book_id=%s md path outside converted_library tree path=%s",
                book_id,
                file_path,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot resolve textbook PDF location",
            )

    # Verify it's actually a PDF file (after potential conversion from .md)
    if file_path.suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"File is not a PDF: {file_path.suffix}"
        )

    # Security: Ensure path is within allowed directories (prevent directory traversal)
    # Since we're resolving from DB paths, this should be safe, but double-check
    # that the resolved path doesn't contain suspicious patterns
    path_str = str(file_path).lower()

    # Block access to system directories only (not all Windows paths)
    # After resolve(), '..' should be normalized away, so we only check the resolved path
    blocked_prefixes = [
        "/etc/",
        "/usr/bin/",
        "/bin/",
        "/sbin/",
        "c:\\windows\\system32",
        "c:\\windows\\syswow64",
        "c:\\program files",
        "c:\\programdata",
    ]

    # Check if resolved path is in blocked system directories
    if any(path_str.startswith(prefix) for prefix in blocked_prefixes):
        # Security event — keep at WARNING so it shows up in
        # standard log scraping. Path goes to log only, never the
        # response body.
        logger.warning(
            "library.serve_pdf: blocked system-directory access book_id=%s path=%s",
            book_id,
            file_path,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Invalid file path"
        )

    logger.debug("library.serve_pdf: serving book_id=%s path=%s", book_id, file_path)

    # Sanitize filename for Content-Disposition header
    safe_filename = sanitize_filename(textbook.file_name)

    # Return file with appropriate headers
    # Add CORS headers explicitly for PDF files
    headers = {
        "Content-Disposition": f'inline; filename="{safe_filename}"',
        "Access-Control-Allow-Origin": "*",  # Allow CORS for PDF files
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
    }

    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=textbook.file_name,
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Phase A (s20c): PDF page thumbnail endpoint.
#
# Backing renderer: PyMuPDF (fitz), already in requirements.txt and used by
# the ingest pipeline. We render one page to PNG at a bounded width, then
# cache the bytes to `backend/.cache/pdf_thumbs/{book_id}/{page}_w{width}.png`
# so repeat hits are a cheap file read.
#
# Used by the frontend `CitationChip` hover popover to show the exact page
# before the user clicks through to the full PDF.
# ---------------------------------------------------------------------------

_THUMB_CACHE_DIR = (Path(__file__).parent.parent.parent / ".cache" / "pdf_thumbs").resolve()
_THUMB_MIN_WIDTH = 120
_THUMB_MAX_WIDTH = 720
_THUMB_DEFAULT_WIDTH = 360


def _thumb_cache_path(book_id: int, page: int, width: int) -> Path:
    return _THUMB_CACHE_DIR / str(book_id) / f"{page}_w{width}.png"


def _render_pdf_page_png(pdf_path: Path, page_number_1_based: int, width: int) -> bytes:
    """Synchronously render one PDF page to PNG bytes at ~`width` px wide.

    Uses PyMuPDF. Clamped by caller; raises if page out of range.
    """
    import fitz  # PyMuPDF (already used by ingest pipeline)

    doc = fitz.open(str(pdf_path))
    try:
        if page_number_1_based < 1 or page_number_1_based > doc.page_count:
            raise IndexError(f"page {page_number_1_based} out of range 1..{doc.page_count}")
        page = doc.load_page(page_number_1_based - 1)
        rect = page.rect
        if rect.width <= 0:
            raise ValueError("page has zero width")
        zoom = width / rect.width
        # Clamp zoom to something sensible so freakish pages don't OOM us.
        zoom = max(0.1, min(zoom, 4.0))
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


@router.get("/books/{book_id}/pages/{page}/thumbnail")
async def get_book_page_thumbnail(
    book_id: int,
    page: int,
    w: int = Query(
        _THUMB_DEFAULT_WIDTH,
        ge=_THUMB_MIN_WIDTH,
        le=_THUMB_MAX_WIDTH,
        description="Target width in px (clamped).",
    ),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_library_access),
):
    """
    Return a PNG thumbnail of page ``page`` (1-based) of textbook ``book_id``.

    Thumbnails are disk-cached under ``backend/.cache/pdf_thumbs/``. First hit
    renders with PyMuPDF (~50-200 ms for typical pages); subsequent hits are
    just a file read.
    """
    if page < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="page must be a positive 1-based integer",
        )

    # Look up textbook
    stmt = select(Textbook).where(Textbook.id == book_id)
    result = await db.execute(stmt)
    textbook = result.scalars().first()
    if not textbook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Textbook with ID {book_id} not found",
        )

    # Upper bound check against known total_pages (best-effort; PyMuPDF
    # will also raise if we overshoot).
    total_pages = textbook.total_pages or 0
    if total_pages and page > total_pages:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"page {page} exceeds total_pages={total_pages}",
        )

    # Clamp width defensively (Query validator should have done this).
    width = max(_THUMB_MIN_WIDTH, min(int(w), _THUMB_MAX_WIDTH))
    cache_path = _thumb_cache_path(book_id, page, width)

    cache_headers = {
        # 1 day browser cache, 1 week CDN. Thumbnails are immutable per
        # (book_id, page, width) triple so aggressive caching is safe.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
        "Access-Control-Allow-Origin": "*",
    }

    if cache_path.exists():
        try:
            data = cache_path.read_bytes()
            return Response(
                content=data,
                media_type="image/png",
                headers={**cache_headers, "X-Thumb-Cache": "hit"},
            )
        except Exception as e:
            logger.warning("thumb cache read failed for %s: %s", cache_path, e)

    # Resolve + sanity-check PDF (reuse PDF-endpoint logic).
    stored_path = textbook.file_path
    if not stored_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Textbook file_path is empty in database",
        )
    try:
        pdf_path = resolve_pdf_path(stored_path)
    except Exception as e:
        # v3.48: same fix as the PDF endpoint — never echo the
        # exception string back to the client (carries absolute
        # path). Stack lives in the logger.
        logger.exception("resolve_pdf_path failed for book_id=%s", book_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resolve textbook file path",
        ) from e
    if not pdf_path.exists():
        # v3.48: include the book_id (a public-ish identifier) but
        # not the stored path or the resolved absolute path.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Textbook file not found for book {book_id}",
        )
    # .md->.pdf redirect (same as PDF endpoint)
    if pdf_path.suffix.lower() == ".md":
        if "converted_library" in str(pdf_path):
            candidate = Path(
                str(pdf_path).replace("converted_library", "raw_library").replace(".md", ".pdf")
            )
            if candidate.exists():
                pdf_path = candidate
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Corresponding PDF not found for thumbnail",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot derive PDF path from stored .md path",
            )
    if pdf_path.suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File is not a PDF: {pdf_path.suffix}",
        )

    # Render off the event loop — PyMuPDF is CPU-bound C code.
    try:
        png_bytes = await asyncio.to_thread(_render_pdf_page_png, pdf_path, page, width)
    except IndexError as e:
        # IndexError message is constructed by _render_pdf_page_png as
        # "page X out of range 1..Y" — a validation string we own.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except Exception as e:
        logger.exception("thumbnail render failed for book_id=%s page=%s", book_id, page)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"thumbnail render failed: {type(e).__name__}",
        ) from e

    # Persist to cache (best-effort; serving never blocks on cache write).
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(png_bytes)
    except Exception as e:
        logger.warning("thumb cache write failed for %s: %s", cache_path, e)

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={**cache_headers, "X-Thumb-Cache": "miss"},
    )


@router.post("/search", response_model=list[CitationResponse])
async def search_textbooks(
    search_request: SearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """
    RAG Search Endpoint

    Search textbook chunks using vector similarity.
    Returns citations with book metadata, page numbers, and relevance scores.

    **Input:**
    - query: Search query string
    - subject: Optional subject filter
    - grade: Optional grade filter
    - limit: Number of results (default: 5)

    **Output:**
    - List of citations with book_id, page_number, snippet, and relevance_score
    """
    try:
        sanitized_query = sanitize_text(search_request.query)
        results = await search_library_chunks(
            db,
            sanitized_query,
            subject=search_request.subject,
            grade=search_request.grade,
            limit=search_request.limit or 5,
            snippet_limit=200,
            user_id=current_user.id if current_user else None,
        )

        return [
            CitationResponse(
                book_id=item["book_id"],
                book_title=item["book_title"],
                subject=item["subject"],
                grade=item["grade"],
                page_number=item["page_number"],
                snippet=item["snippet"],
                relevance_score=item["relevance_score"],
            )
            for item in results
        ]

    except Exception:
        # Catch any other unexpected errors
        logger.exception("Unexpected error in search_textbooks")
        # CRITICAL: Rollback the session to clean it
        await db.rollback()
        # Return empty list (failed search = 0 results)
        return []
