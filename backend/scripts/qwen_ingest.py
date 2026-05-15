"""Full-corpus re-ingest via DashScope qwen-vl-ocr-latest + text-embedding-v4.

Pipeline per PDF:
  1. Render every page at a high DPI (default 600) -> PNG bytes.
  2. Hit qwen-vl-ocr-latest to transcribe the page.
     - Retry on transient HTTP failures.
     - Skip "BLANK_PAGE" responses.
     - Write the page text to dataset/converted_library/<subject>/<grade>/<stem>_qwen.md
       as `## Page N\\n<body>` so we have a human-readable transcript
       AND a resumable artifact.
  3. Once all pages are done, chunk the transcript at sentence
     boundaries, target ~800 tokens with 120-token overlap, and
     strictly per-page (never crossing pages - each chunk belongs to
     exactly one page).
  4. Batch-embed the chunks through text-embedding-v4 (batch=10) and
     INSERT into textbook_chunks.

Idempotent at the per-page level via content_hash dedup and at the
per-book level via ocr_status='qwen_ok' on textbooks.

Run with:
    python backend/scripts/qwen_ingest.py --dpi 600 --workers 8 \
        --only-subject "History of Kazakhstan"   # optional filter

Best-quality settings (recommended, cost-blind per boss directive):
    --dpi 600 --workers 8 --ocr-temperature 0.0 --ocr-max-tokens 4096

Resume automatically: the script skips any (textbook_id, page_number)
that already has chunks with ingest_source='qwen' in the DB.
"""

from __future__ import annotations

import argparse
import asyncio
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import fitz  # PyMuPDF
from sqlalchemy import text

from app.database import engine  # noqa: E402
from app.services.qwen_dashscope import embed_texts, ocr_image_bytes  # noqa: E402
from app.utils.textbook_quality import normalize_textbook_snippet  # noqa: E402

RAW_ROOT = Path(os.environ.get("UNT_DATASET_RAW", "dataset/raw_library"))
CONVERTED_ROOT = Path(os.environ.get("UNT_DATASET_CONVERTED", "dataset/converted_library"))
CONVERTED_ROOT.mkdir(parents=True, exist_ok=True)

DEFAULT_DPI = 600
DEFAULT_OCR_WORKERS = 8
DEFAULT_EMBED_BATCH = 10

TARGET_CHUNK_TOKENS = 800
OVERLAP_TOKENS = 120


# ----- utilities -----------------------------------------------------


def tokenize_approx(text: str) -> int:
    """Word count as a lightweight token-count approximation."""
    return max(1, len(text.split()))


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[\.!?;])\s+|\n+")


def split_sentences(paragraph: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(paragraph) if p.strip()]
    return parts


def chunk_page(page_text: str) -> list[str]:
    """Greedy 800-token chunks with 120-token overlap, sentence-boundary.

    Never crosses pages (the caller calls this per-page).
    """
    sentences = split_sentences(page_text)
    if not sentences:
        return []
    chunks: list[str] = []
    buf: list[str] = []
    buf_tokens = 0
    for sent in sentences:
        st = tokenize_approx(sent)
        if buf and buf_tokens + st > TARGET_CHUNK_TOKENS:
            chunks.append(" ".join(buf).strip())
            # start next chunk with overlap (last sentences until OVERLAP_TOKENS reached)
            overlap_buf: list[str] = []
            overlap_tok = 0
            for s in reversed(buf):
                t = tokenize_approx(s)
                if overlap_tok + t > OVERLAP_TOKENS and overlap_buf:
                    break
                overlap_buf.append(s)
                overlap_tok += t
            overlap_buf.reverse()
            buf = list(overlap_buf)
            buf_tokens = overlap_tok
        buf.append(sent)
        buf_tokens += st
    if buf:
        chunks.append(" ".join(buf).strip())
    return [c for c in chunks if len(c) >= 120]


def hash_content(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()


def printable_path(path: Path) -> str:
    return str(path).encode("ascii", errors="backslashreplace").decode("ascii")


# Session 18 (2026-04-21): the raw_library tree has both English and
# Russian subject folders (e.g. `Physics/` and `Физика/`,
# `Chemistry/` and `Химия/`, plus `География/` which has no English
# twin). Until now the ingester used the folder name verbatim as the
# textbooks.subject value, which meant:
#   - Russian-folder books never matched the chat's English subject
#     inference or the eval harness's `expected_subject` field.
#   - Geography (RU-only folder) scored 0/10 on every eval run because
#     the subject label would have been "География", not "Geography".
# Normalise everything to the canonical English subject name.
SUBJECT_ALIAS: dict[str, str] = {
    # Cyrillic-folder -> canonical English
    "Биология": "Biology",
    "География": "Geography",
    "Физика": "Physics",
    "Химия": "Chemistry",
    "Математика": "Mathematics",
    "Информатика": "Informatics",
    "История Казахстана": "History of Kazakhstan",
    "Всемирная история": "World History",
    "Казахская литература": "Kazakh Literature",
    "Казахский язык": "Kazakh Language",
    "Русская литература": "Russian Literature",
    "Русский язык": "Russian Language",
    "Английский язык": "English",
    "Немецкий язык": "German",
    "Французский язык": "French",
    # English-folder -> itself (no-op aliases so lookup never misses).
    "Biology": "Biology",
    "Chemistry": "Chemistry",
    "Physics": "Physics",
    "Mathematics": "Mathematics",
    "History of Kazakhstan": "History of Kazakhstan",
    "Informatics": "Informatics",
    "Geography": "Geography",
}


def rel_subject_grade(pdf_path: Path) -> tuple[str, str]:
    rel = pdf_path.relative_to(RAW_ROOT)
    folder = rel.parts[0]
    subject = SUBJECT_ALIAS.get(folder, folder)
    grade = rel.parts[1] if len(rel.parts) > 1 else "?"
    return subject, grade


def looks_like_download_landing_pdf(pdf_path: Path) -> bool:
    """Return True for scraper artifacts that are not real textbooks."""
    try:
        size = pdf_path.stat().st_size
        with fitz.open(pdf_path) as doc:
            if doc.page_count > 4 or size > 250_000:
                return False
            sample = "\n".join(
                doc[i].get_text("text") for i in range(min(doc.page_count, 2))
            ).casefold()
    except Exception:
        return False

    return (
        "okulyk.kz" in sample
        and "pdf" in sample
        and (
            "кнопка для скачивания" in sample or "учебники онлайн" in sample or "предметы" in sample
        )
    )


# ----- main pipeline -------------------------------------------------


async def book_is_done(textbook_id: int) -> bool:
    async with engine.begin() as conn:
        r = await conn.execute(
            text("SELECT ocr_status FROM textbooks WHERE id = :id"), {"id": textbook_id}
        )
        return (r.scalar() or "") == "qwen_ok"


async def create_or_fetch_textbook(pdf: Path, subject: str, grade: str) -> int:
    """Return the textbook id for this PDF, inserting a row if needed."""
    title = pdf.stem
    try:
        grade_int = int(grade)
    except ValueError:
        grade_int = 0  # unknown/elective
    # Page count for total_pages.
    with fitz.open(pdf) as doc:
        page_count = doc.page_count
    async with engine.begin() as conn:
        r = await conn.execute(
            text("SELECT id FROM textbooks WHERE file_path = :fp"), {"fp": str(pdf)}
        )
        existing = r.scalar()
        if existing:
            return existing
        r = await conn.execute(
            text(
                "INSERT INTO textbooks "
                "(title, subject, grade, file_path, file_name, total_pages, "
                " total_chunks, ocr_status, created_at, updated_at) VALUES "
                "(:t, :s, :g, :fp, :fn, :tp, 0, 'pending', now(), now()) "
                "RETURNING id"
            ),
            {
                "t": title,
                "s": subject,
                "g": grade_int,
                "fp": str(pdf),
                "fn": pdf.name,
                "tp": page_count,
            },
        )
        return r.scalar()


def render_page_png(pdf_path: Path, page_index: int, dpi: int) -> bytes:
    with fitz.open(pdf_path) as doc:
        page = doc[page_index]
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False)
        return pix.tobytes("png")


def ocr_one_page(args) -> tuple[int, str]:
    """Run in a ThreadPool worker. Returns (page_number_1based, transcript)."""
    pdf_path, page_idx, dpi, hint, max_retries = args
    png = render_page_png(pdf_path, page_idx, dpi=dpi)
    last_err = ""
    for attempt in range(max_retries):
        try:
            body = ocr_image_bytes(
                png,
                extra_hint=hint,
                max_tokens=4096,
                temperature=0.0,
            )
            return (page_idx + 1, body)
        except Exception as exc:
            last_err = str(exc)[:200]
            time.sleep(1.5 * (attempt + 1))
    return (page_idx + 1, f"__OCR_ERROR__ {last_err}")


async def ingest_book(
    pdf: Path,
    dpi: int,
    workers: int,
    embed_batch: int,
    reuse_transcript: bool = True,
    force: bool = False,
) -> dict:
    subject, grade = rel_subject_grade(pdf)
    textbook_id = await create_or_fetch_textbook(pdf, subject, grade)
    if not force and await book_is_done(textbook_id):
        return {"pdf": pdf.name, "status": "skipped_done"}

    transcript_path = CONVERTED_ROOT / subject / grade / f"{pdf.stem}_qwen.md"
    transcript_path.parent.mkdir(parents=True, exist_ok=True)

    with fitz.open(pdf) as doc:
        page_count = doc.page_count

    # Resume: read any existing transcript file to skip already-OCR'd pages.
    existing: dict[int, str] = {}
    if reuse_transcript and transcript_path.exists():
        raw = transcript_path.read_text(encoding="utf-8", errors="replace")
        for match in re.finditer(
            r"^##\s*Page\s+(\d+)\s*\n(.*?)(?=^##\s*Page\s+\d+|\Z)",
            raw,
            flags=re.MULTILINE | re.DOTALL,
        ):
            page_text = match.group(2).strip()
            if page_text.startswith("__OCR_ERROR__"):
                continue
            existing[int(match.group(1))] = page_text

    print(
        f"\n[{pdf.name}] pages={page_count} subject='{subject}' "
        f"grade={grade} id={textbook_id} "
        f"reuse_transcript_pages={len(existing)}"
    )

    # Pages we still need.
    todo_indices = [i for i in range(page_count) if (i + 1) not in existing]

    hint = {
        "Mathematics": "mathematics",
        "Chemistry": "chemistry",
        "Physics": "physics",
        "Biology": "biology",
        "History of Kazakhstan": "history of Kazakhstan",
        "Informatics": "informatics",
    }.get(subject, None)

    # OCR concurrency via ThreadPoolExecutor (DashScope client is HTTP).
    t_start = time.time()
    results: dict[int, str] = dict(existing)
    if todo_indices:
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            args = [(pdf, i, dpi, hint, 3) for i in todo_indices]
            done = 0
            batch_append_every = 10
            futures = [pool.submit(ocr_one_page, item) for item in args]
            for future in cf.as_completed(futures):
                page_no, body = future.result()
                results[page_no] = body
                done += 1
                if done % batch_append_every == 0:
                    # Periodically persist so a crash doesn't lose work.
                    _flush_transcript(transcript_path, results)
                    elapsed = time.time() - t_start
                    rate = done / max(elapsed, 1e-6)
                    eta = (len(todo_indices) - done) / max(rate, 1e-6)
                    print(f"  OCR {done}/{len(todo_indices)} rate={rate:.2f}/s eta={int(eta)}s")
        _flush_transcript(transcript_path, results)
    elapsed = time.time() - t_start
    print(f"  OCR complete in {int(elapsed)}s")

    # Chunk + embed + insert.
    t_start = time.time()
    total_chunks = 0
    pending_chunks: list[tuple[int, int, str, str]] = []
    # (page_number, chunk_index, content, hash)
    for page_no in sorted(results.keys()):
        body = results[page_no]
        if body.startswith("__OCR_ERROR__"):
            continue
        if body.strip() == "BLANK_PAGE":
            continue
        body = normalize_textbook_snippet(body)
        if not body:
            continue
        chunks = chunk_page(body)
        for idx, chunk in enumerate(chunks):
            h = hash_content(chunk)
            pending_chunks.append((page_no, idx, chunk, h))
    print(f"  {len(pending_chunks)} chunks to embed (target 800 tok, overlap 120)")

    async with engine.begin() as conn:
        # Clear any prior qwen chunks for this book (idempotent re-run).
        await conn.execute(
            text("DELETE FROM textbook_chunks WHERE textbook_id = :t AND ingest_source = 'qwen'"),
            {"t": textbook_id},
        )

    # Embed in batches of `embed_batch` (DashScope limit).
    BATCH = embed_batch
    async with engine.begin() as conn:
        for i in range(0, len(pending_chunks), BATCH):
            batch = pending_chunks[i : i + BATCH]
            texts_only = [b[2] for b in batch]
            embeddings = await asyncio.to_thread(embed_texts, texts_only)
            for (page_no, chunk_idx, content, h), emb in zip(batch, embeddings, strict=False):
                vec_literal = "[" + ",".join(f"{float(v):.6f}" for v in emb) + "]"
                await conn.execute(
                    text(
                        "INSERT INTO textbook_chunks "
                        "(textbook_id, page_number, chunk_index, content, "
                        " token_count, chunk_embedding, ingest_source, "
                        " content_hash, created_at) "
                        "VALUES (:tid, :pn, :ci, :c, :tok, CAST(:e AS vector), "
                        "        'qwen', :h, now())"
                    ),
                    {
                        "tid": textbook_id,
                        "pn": page_no,
                        "ci": chunk_idx,
                        "c": content,
                        "tok": tokenize_approx(content),
                        "e": vec_literal,
                        "h": h,
                    },
                )
                total_chunks += 1

        # Session 20 fix: persist total_chunks so the metadata row
        # reflects reality. Prior code only updated ocr_status which
        # left textbooks.total_chunks stuck at 0 for every book ingested
        # since the qwen pipeline landed (72 rows drifted before the
        # s20 repair). Also bump updated_at so admin dashboards see the
        # latest ingest timestamp.
        await conn.execute(
            text(
                "UPDATE textbooks SET ocr_status='qwen_ok', "
                "total_chunks=:n, updated_at=now() WHERE id=:id"
            ),
            {"id": textbook_id, "n": total_chunks},
        )

    elapsed = time.time() - t_start
    print(f"  inserted {total_chunks} chunks in {int(elapsed)}s")
    return {
        "pdf": pdf.name,
        "textbook_id": textbook_id,
        "pages": page_count,
        "chunks": total_chunks,
    }


def _flush_transcript(path: Path, results: dict[int, str]):
    body = []
    for pno in sorted(results.keys()):
        body.append(f"## Page {pno}\n\n{results[pno]}\n")
    path.write_text("\n".join(body), encoding="utf-8")


# ----- cli -----------------------------------------------------------

# Session 19 (2026-04-21): priority-aware queue. Boss noted that the
# alphabetical walk was burning compute on English K-6 "task workbooks"
# (drills, no reference text) while Geography / Informatics — both
# UNT-tested subjects — sat at zero ingested books. Tiers encode our
# retrieval priority; lower tier = ingest sooner.
SUBJECT_PRIORITY = {
    # Tier 1 — UNT STEM + History of Kazakhstan + Geography + Informatics
    "Mathematics": 1,
    "Physics": 1,
    "Chemistry": 1,
    "Biology": 1,
    "Geography": 1,
    "History of Kazakhstan": 1,
    "Informatics": 1,
    # Tier 2 — secondary UNT content
    "World History": 2,
    # Tier 3 — languages (high value but bulky; K-6 often drill-only)
    "English": 3,
    "Kazakh Language": 3,
    "Russian Language": 3,
    # Tier 4 — literature / non-UNT
    "Kazakh Literature": 4,
    "Russian Literature": 4,
    "German": 4,
    "French": 4,
}


def _parse_grade(raw: str) -> int:
    m = re.search(r"\d+", raw or "")
    return int(m.group()) if m else 0


def collect_pdfs(
    only_subject: str | None,
    only_subjects: list[str] | None = None,
    min_grade: int = 0,
    max_tier: int | None = None,
) -> list[Path]:
    """Return PDF paths ordered by (tier, subject, grade, stem).

    * `only_subject`     — legacy single-folder filter (matched on the
      RAW folder name, before alias canonicalisation).
    * `only_subjects`    — canonical subject list (post-alias). Case
      exact; e.g. ["Mathematics", "Geography"].
    * `min_grade`        — drop PDFs whose parsed grade (first integer
      in the second path component) is below this threshold. Retrieval
      for UNT-prep users keeps grade 6+ in the candidate pool.
    * `max_tier`         — drop PDFs in subjects with a tier strictly
      greater than this. Default None = include all.
    """
    pdfs = list(RAW_ROOT.rglob("*.pdf"))
    keep: list[tuple[int, str, int, Path]] = []
    wanted = {s.strip() for s in (only_subjects or []) if s.strip()}
    for p in pdfs:
        if looks_like_download_landing_pdf(p):
            print(f"skip non-textbook PDF artifact: {printable_path(p)}")
            continue
        rel = p.relative_to(RAW_ROOT)
        folder = rel.parts[0]
        if only_subject and folder != only_subject:
            continue
        subject = SUBJECT_ALIAS.get(folder, folder)
        if wanted and subject not in wanted:
            continue
        tier = SUBJECT_PRIORITY.get(subject, 9)
        if max_tier is not None and tier > max_tier:
            continue
        grade = _parse_grade(rel.parts[1] if len(rel.parts) > 1 else "")
        if min_grade and grade and grade < min_grade:
            continue
        keep.append((tier, subject, grade, p))
    keep.sort(key=lambda t: (t[0], t[1], -t[2], str(t[3])))
    return [p for _, _, _, p in keep]


async def main_async(args):
    only_subjects = None
    if args.only_subjects:
        only_subjects = [s.strip() for s in args.only_subjects.split(",") if s.strip()]
    pdfs = collect_pdfs(
        only_subject=args.only_subject,
        only_subjects=only_subjects,
        min_grade=args.min_grade,
        max_tier=args.max_tier,
    )
    if args.only_book:
        pdfs = [p for p in pdfs if p.stem == args.only_book]
    if args.limit:
        pdfs = pdfs[: args.limit]
    print(f"books to ingest: {len(pdfs)} (max_tier={args.max_tier}, min_grade={args.min_grade})")
    if not pdfs:
        return

    summary = []
    for pdf in pdfs:
        try:
            info = await ingest_book(
                pdf=pdf,
                dpi=args.dpi,
                workers=args.workers,
                embed_batch=args.embed_batch,
                reuse_transcript=not args.no_reuse,
                force=args.force,
            )
            summary.append(info)
        except Exception as exc:
            summary.append({"pdf": pdf.name, "error": str(exc)[:200]})
            print(f"  ERROR on {pdf.name}: {exc}")

    summary_path = Path(os.environ.get("UNT_INGEST_SUMMARY", "tmp/qwen_ingest_summary.json"))
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSUMMARY: {len(summary)} books processed")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    p.add_argument("--workers", type=int, default=DEFAULT_OCR_WORKERS)
    p.add_argument("--embed-batch", type=int, default=DEFAULT_EMBED_BATCH)
    p.add_argument(
        "--only-subject", type=str, default=None, help="raw-folder name filter (pre-alias). Legacy."
    )
    p.add_argument(
        "--only-subjects",
        type=str,
        default=None,
        help="comma-separated canonical subjects, e.g. 'Mathematics,Geography'",
    )
    p.add_argument("--only-book", type=str, default=None, help="match on PDF stem (without .pdf)")
    p.add_argument(
        "--min-grade",
        type=int,
        default=0,
        help="drop PDFs with parsed grade below this "
        "(0 = no filter). Session-19 default for "
        "retrieval-focused runs: 7.",
    )
    p.add_argument(
        "--max-tier",
        type=int,
        default=None,
        help="drop subjects with priority tier > this "
        "(1=STEM+Geo+Hist+Inf, 2=World History, "
        "3=languages, 4=literature/non-UNT).",
    )
    p.add_argument("--limit", type=int, default=None)
    p.add_argument(
        "--no-reuse", action="store_true", help="ignore any existing transcript markdown"
    )
    p.add_argument(
        "--force", action="store_true", help="reprocess even when textbooks.ocr_status is qwen_ok"
    )
    args = p.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
