"""Kimi (Moonshot) OCR gap-filler.

Session 22c, 2026-04-22.

Problem
-------
DashScope's qwen-vl-ocr enforces a 20 MB-per-data-URI limit, so pages
with full-bleed illustrations (kids' English textbooks, Geography
maps) get rejected in bulk even at DPI=600. The resulting _qwen.md
files contain `__OCR_ERROR__` placeholders where those pages should
be. We identified 9 in-scope (g>=7) books with >10% error rate.

Moonshot's moonshot-v1-128k-vision-preview has no such size limit,
verified on a 14.7 MB base64 page from Malcolm Mann English 11 — it
returned a clean transcript in ~5s.

This script:
  1. Parses a _qwen.md file.
  2. Locates every `## Page N` section whose body starts with
     `__OCR_ERROR__`.
  3. Re-renders that page from the source PDF (DPI configurable, 300
     default — smaller is fine, Kimi decodes everything).
  4. Sends it to Moonshot vision for OCR.
  5. Replaces the error body with the new transcript (or keeps the
     error if Kimi also fails).
  6. Writes the md back to disk.
  7. Optionally re-chunks + re-embeds just the healed pages and
     upserts them into textbook_chunks (default OFF; use --reembed).

Idempotent: re-running on an already-healed md is a no-op (no error
markers remain).

Env:
    set KIMI_KEY=sk-...                # Moonshot API key (required)
    set KIMI_BASE=https://api.moonshot.ai/v1   # optional override

CLI:
    python backend/scripts/kimi_gapfill.py --md "<path_to_qwen.md>" \\
        --pdf "<path_to_pdf>" --dpi 300 --workers 4 --reembed

Batch mode (gapfill all in-scope broken books):
    python backend/scripts/kimi_gapfill.py --auto --reembed
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import concurrent.futures as cf
import hashlib
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import fitz  # PyMuPDF
from openai import OpenAI  # type: ignore
from sqlalchemy import text

from app.database import engine  # noqa: E402
from app.services.qwen_dashscope import embed_texts  # noqa: E402

RAW_ROOT = Path(os.environ.get("UNT_DATASET_RAW", "dataset/raw_library"))
CONVERTED_ROOT = Path(os.environ.get("UNT_DATASET_CONVERTED", "dataset/converted_library"))

KIMI_BASE = os.environ.get("KIMI_BASE", "https://api.moonshot.ai/v1")
KIMI_MODEL = os.environ.get("KIMI_MODEL", "moonshot-v1-128k-vision-preview")
KIMI_DPI = 300  # Moonshot accepts big images; smaller keeps tokens down
KIMI_WORKERS = 4
KIMI_MAX_TOKENS = 4096
KIMI_MAX_RETRIES = 3

# These 9 in-scope books were flagged by data_health.py
# check_ocr_content_integrity (>10% error rate). Priority order matches
# worst-first (most broken pages first, so we heal the biggest gaps
# first and the boss sees immediate visible progress).
AUTO_TARGETS: list[tuple[str, str]] = [
    # (md_rel_path_under_CONVERTED_ROOT, pdf_rel_path_under_RAW_ROOT)
    (
        r"Английский язык\11\Английский язык_11_Malcolm Mann_АНГ_qwen.md",
        r"Английский язык\11\Английский язык_11_Malcolm Mann_АНГ.pdf",
    ),
    (
        r"Geography\9\География_9_Каратабанов Р._КЗ_qwen.md",
        r"География\9\География_9_Каратабанов Р._КЗ.pdf",
    ),
    (
        r"Informatics\9\Информатика_9_P. HealthCote_АНГ_qwen.md",
        r"Информатика\9\Информатика_9_P. HealthCote_АНГ.pdf",
    ),
    (
        r"Informatics\9\Информатика_9_Мухаметжанова С.Т._РУ_qwen.md",
        r"Информатика\9\Информатика_9_Мухаметжанова С.Т._РУ.pdf",
    ),
]


# ---------- markdown parsing ----------------------------------------

PAGE_SPLIT_RE = re.compile(
    r"^##\s*Page\s+(\d+)\s*\n(.*?)(?=^##\s*Page\s+\d+|\Z)",
    re.M | re.S,
)


@dataclass
class PageEntry:
    number: int
    body: str

    @property
    def is_error(self) -> bool:
        return self.body.lstrip().startswith("__OCR_ERROR__")


def parse_md(md_path: Path) -> list[PageEntry]:
    txt = md_path.read_text(encoding="utf-8", errors="replace")
    out: list[PageEntry] = []
    for m in PAGE_SPLIT_RE.finditer(txt):
        out.append(PageEntry(number=int(m.group(1)), body=m.group(2).strip()))
    out.sort(key=lambda p: p.number)
    return out


def write_md(md_path: Path, pages: list[PageEntry]) -> None:
    buf = []
    for p in sorted(pages, key=lambda x: x.number):
        buf.append(f"## Page {p.number}\n\n{p.body}\n")
    md_path.write_text("\n".join(buf), encoding="utf-8")


# ---------- Kimi client ---------------------------------------------


def make_kimi_client() -> OpenAI:
    key = os.environ.get("KIMI_KEY")
    if not key:
        raise RuntimeError("KIMI_KEY env var is required")
    return OpenAI(api_key=key, base_url=KIMI_BASE, timeout=120)


OCR_PROMPT = (
    "You are an OCR engine for a Kazakhstan school textbook page. "
    "Transcribe ALL readable text on this page in natural reading order. "
    "Preserve headings, lists, numbered items, and short tables (as "
    "markdown). Do NOT add commentary, summaries, or meta-text like "
    "'Here is the transcription'. If the page is blank or purely "
    "decorative, output exactly: BLANK_PAGE. If a block is unreadable, "
    "skip it silently. Output only the transcribed text."
)


def render_page_png(pdf_path: Path, page_idx: int, dpi: int) -> bytes:
    doc = fitz.open(str(pdf_path))
    try:
        pg = doc[page_idx]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = pg.get_pixmap(matrix=mat, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def kimi_ocr_one_page(
    client: OpenAI,
    pdf_path: Path,
    page_number: int,  # 1-indexed
    dpi: int = KIMI_DPI,
) -> tuple[int, str]:
    """Return (page_number, body). On final failure returns __OCR_ERROR__.

    Shrinks DPI on failure to work around any residual size issues.
    """
    last_err = "unknown"
    for attempt in range(KIMI_MAX_RETRIES):
        try_dpi = dpi if attempt == 0 else max(150, dpi - 75 * attempt)
        try:
            png = render_page_png(pdf_path, page_number - 1, try_dpi)
            b64 = base64.b64encode(png).decode()
            uri = f"data:image/png;base64,{b64}"
            r = client.chat.completions.create(
                model=KIMI_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": uri}},
                            {"type": "text", "text": OCR_PROMPT},
                        ],
                    }
                ],
                max_tokens=KIMI_MAX_TOKENS,
                temperature=0,
            )
            body = (r.choices[0].message.content or "").strip()
            if not body:
                last_err = "empty_response"
                continue
            return page_number, body
        except Exception as e:
            last_err = f"{type(e).__name__}: {str(e)[:200]}"
            time.sleep(0.8 * (attempt + 1))
    return page_number, f"__OCR_ERROR__ kimi: {last_err}"


# ---------- chunking + embedding (copied from qwen_ingest to stay
#            consistent with how the rest of the library was ingested) -

TARGET_CHUNK_TOKENS = 800
OVERLAP_TOKENS = 120
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[\.!?;])\s+|\n+")


def tokenize_approx(s: str) -> int:
    return max(1, len(s.split()))


def chunk_page(page_text: str) -> list[str]:
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(page_text) if s.strip()]
    if not sentences:
        return []
    chunks: list[str] = []
    buf: list[str] = []
    buf_tok = 0
    for sent in sentences:
        st = tokenize_approx(sent)
        if buf and buf_tok + st > TARGET_CHUNK_TOKENS:
            chunks.append(" ".join(buf).strip())
            overlap_buf: list[str] = []
            ot = 0
            for s in reversed(buf):
                t = tokenize_approx(s)
                if ot + t > OVERLAP_TOKENS and overlap_buf:
                    break
                overlap_buf.append(s)
                ot += t
            overlap_buf.reverse()
            buf = list(overlap_buf)
            buf_tok = ot
        buf.append(sent)
        buf_tok += st
    if buf:
        chunks.append(" ".join(buf).strip())
    return [c for c in chunks if len(c) >= 120]


def hash_content(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()


# ---------- per-book orchestration ----------------------------------


async def fetch_textbook_id(pdf_path: Path) -> int | None:
    async with engine.begin() as conn:
        r = await conn.execute(
            text("SELECT id FROM textbooks WHERE file_path = :fp"),
            {"fp": str(pdf_path)},
        )
        return r.scalar()


async def replace_chunks_for_pages(
    textbook_id: int, page_numbers: list[int], page_bodies: dict
) -> int:
    """Delete old chunks for these pages (regardless of ingest_source),
    then re-chunk + re-embed + insert. Returns count of new chunks.
    """
    pending: list[tuple[int, int, str, str]] = []  # (pn, ci, content, hash)
    for pn in page_numbers:
        body = page_bodies.get(pn, "")
        if not body or body.startswith("__OCR_ERROR__") or body.strip() == "BLANK_PAGE":
            continue
        for ci, ck in enumerate(chunk_page(body)):
            pending.append((pn, ci, ck, hash_content(ck)))

    async with engine.begin() as conn:
        # purge any prior chunks on those pages (this covers both
        # qwen-source chunks that might exist and leftovers)
        await conn.execute(
            text(
                "DELETE FROM textbook_chunks  WHERE textbook_id = :t AND page_number = ANY(:pages)"
            ),
            {"t": textbook_id, "pages": page_numbers},
        )

    if not pending:
        return 0

    BATCH = 10
    total = 0
    async with engine.begin() as conn:
        for i in range(0, len(pending), BATCH):
            batch = pending[i : i + BATCH]
            texts_only = [b[2] for b in batch]
            # embeddings come from DashScope text-embedding-v4 (same
            # model the rest of the library uses — we DO NOT switch
            # embedding models; only OCR backend).
            embeddings = await asyncio.to_thread(embed_texts, texts_only)
            for (pn, ci, content, h), emb in zip(batch, embeddings, strict=False):
                vec_literal = "[" + ",".join(f"{float(v):.6f}" for v in emb) + "]"
                await conn.execute(
                    text(
                        "INSERT INTO textbook_chunks "
                        " (textbook_id, page_number, chunk_index, content, "
                        "  token_count, chunk_embedding, ingest_source, "
                        "  content_hash, created_at) "
                        " VALUES (:tid, :pn, :ci, :c, :tok, CAST(:e AS vector), "
                        "         'kimi_gapfill', :h, now())"
                    ),
                    {
                        "tid": textbook_id,
                        "pn": pn,
                        "ci": ci,
                        "c": content,
                        "tok": tokenize_approx(content),
                        "e": vec_literal,
                        "h": h,
                    },
                )
                total += 1

    # Resync textbooks.total_chunks to reality (there's a data_health
    # check that will WARN otherwise).
    async with engine.begin() as conn:
        new_total = (
            await conn.execute(
                text("SELECT COUNT(*) FROM textbook_chunks WHERE textbook_id=:t"),
                {"t": textbook_id},
            )
        ).scalar_one()
        await conn.execute(
            text("UPDATE textbooks SET total_chunks=:n, updated_at=now()  WHERE id=:id"),
            {"id": textbook_id, "n": new_total},
        )
    return total


def _kimi_heal_error_pages(
    client: OpenAI,
    pdf_path: Path,
    pages: list[PageEntry],
    dpi: int,
    workers: int,
    limit: int | None,
) -> tuple[list[PageEntry], list[int]]:
    """Re-OCR every error page via Kimi. Returns (updated pages list,
    list of healed page numbers).
    """
    error_pages = [p for p in pages if p.is_error]
    if limit:
        error_pages = error_pages[:limit]
    if not error_pages:
        return pages, []

    by_num = {p.number: p for p in pages}
    healed_nums: list[int] = []

    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(kimi_ocr_one_page, client, pdf_path, ep.number, dpi): ep.number
            for ep in error_pages
        }
        done = 0
        for fut in cf.as_completed(futures):
            page_no = futures[fut]
            try:
                pn, body = fut.result()
            except Exception as e:
                body = f"__OCR_ERROR__ kimi_driver: {e}"
                pn = page_no
            prev = by_num[pn]
            if body.startswith("__OCR_ERROR__"):
                pass  # keep marker
            else:
                prev.body = body
                healed_nums.append(pn)
            done += 1
            if done % 5 == 0 or done == len(error_pages):
                el = time.time() - t0
                rate = done / max(el, 1e-6)
                eta = (len(error_pages) - done) / max(rate, 1e-6)
                print(
                    f"     Kimi {done}/{len(error_pages)} "
                    f"rate={rate:.2f}/s eta={int(eta)}s "
                    f"healed={len(healed_nums)}"
                )
    return list(by_num.values()), healed_nums


async def process_book(
    md_path: Path,
    pdf_path: Path,
    dpi: int,
    workers: int,
    limit: int | None,
    reembed: bool,
    dry_run: bool,
) -> dict:
    print("\n=== BOOK ===")
    print(f"  md:  {md_path}")
    print(f"  pdf: {pdf_path}")
    if not md_path.exists():
        return {"ok": False, "reason": "md_not_found"}
    if not pdf_path.exists():
        return {"ok": False, "reason": "pdf_not_found"}

    pages = parse_md(md_path)
    total_pages = len(pages)
    error_pages = [p for p in pages if p.is_error]
    print(f"  pages={total_pages}  error_pages={len(error_pages)}")

    if not error_pages:
        print("  no errors; skipping")
        return {"ok": True, "healed": 0, "error_pages": 0, "total_pages": total_pages}

    if dry_run:
        print(f"  DRY-RUN: would heal up to {limit or len(error_pages)} pages")
        return {"ok": True, "healed": 0, "error_pages": len(error_pages), "dry_run": True}

    client = make_kimi_client()
    updated_pages, healed_nums = _kimi_heal_error_pages(
        client,
        pdf_path,
        pages,
        dpi=dpi,
        workers=workers,
        limit=limit,
    )

    # Write healed md back
    backup = md_path.with_suffix(md_path.suffix + ".pre_kimi.bak")
    if not backup.exists():
        backup.write_bytes(md_path.read_bytes())
    write_md(md_path, updated_pages)
    print(f"  wrote healed md ({len(healed_nums)} pages transcribed)")

    result = {
        "ok": True,
        "healed": len(healed_nums),
        "error_pages": len(error_pages),
        "total_pages": total_pages,
    }

    if reembed and healed_nums:
        textbook_id = await fetch_textbook_id(pdf_path)
        if textbook_id is None:
            print("  WARN: no textbooks row matches this PDF path; skipping re-embed")
            result["reembed"] = "skipped_no_row"
        else:
            page_bodies = {p.number: p.body for p in updated_pages}
            new_chunks = await replace_chunks_for_pages(
                textbook_id,
                healed_nums,
                page_bodies,
            )
            print(f"  re-embedded {new_chunks} chunks for textbook_id={textbook_id}")
            result["reembed_chunks"] = new_chunks
            result["textbook_id"] = textbook_id

    return result


# ---------- cli -----------------------------------------------------


def resolve_pair(md_arg: str | None, pdf_arg: str | None) -> list[tuple[Path, Path]]:
    if md_arg:
        md = Path(md_arg) if os.path.isabs(md_arg) else CONVERTED_ROOT / md_arg
        pdf = (
            Path(pdf_arg)
            if (pdf_arg and os.path.isabs(pdf_arg))
            else (RAW_ROOT / pdf_arg if pdf_arg else None)
        )
        if pdf is None:
            # Try to infer pdf from md name
            stem = md.name.removesuffix("_qwen.md")
            # md is under CONVERTED_ROOT/<subject>/<grade>/
            rel = (
                md.relative_to(CONVERTED_ROOT) if str(md).startswith(str(CONVERTED_ROOT)) else None
            )
            if rel:
                rel.parts[0]
                grade_dir = rel.parts[1]
                # RAW_ROOT may use a different subject folder name
                candidates = list(RAW_ROOT.glob(f"*/{grade_dir}/{stem}.pdf"))
                if candidates:
                    pdf = candidates[0]
        if pdf is None or not pdf.exists():
            raise SystemExit(f"could not locate PDF for md={md}")
        return [(md, pdf)]

    # --auto
    pairs: list[tuple[Path, Path]] = []
    for md_rel, pdf_rel in AUTO_TARGETS:
        pairs.append((CONVERTED_ROOT / md_rel, RAW_ROOT / pdf_rel))
    return pairs


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--md", type=str, default=None, help="path to _qwen.md (abs or under CONVERTED_ROOT)"
    )
    p.add_argument(
        "--pdf", type=str, default=None, help="path to source PDF (abs or under RAW_ROOT)"
    )
    p.add_argument(
        "--auto", action="store_true", help="process all 4 in-scope broken books in AUTO_TARGETS"
    )
    p.add_argument("--dpi", type=int, default=KIMI_DPI)
    p.add_argument("--workers", type=int, default=KIMI_WORKERS)
    p.add_argument(
        "--limit", type=int, default=None, help="max error pages to heal per book (for smoke tests)"
    )
    p.add_argument(
        "--reembed",
        action="store_true",
        help="re-chunk + re-embed healed pages into textbook_chunks",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="parse and count only; no API calls, no writes"
    )
    args = p.parse_args()

    if not args.auto and not args.md:
        p.error("provide --md/--pdf or --auto")

    pairs = resolve_pair(args.md, args.pdf) if not args.auto else resolve_pair(None, None)
    print(f"books to process: {len(pairs)}")

    results = []
    for md, pdf in pairs:
        r = asyncio.run(
            process_book(
                md_path=md,
                pdf_path=pdf,
                dpi=args.dpi,
                workers=args.workers,
                limit=args.limit,
                reembed=args.reembed,
                dry_run=args.dry_run,
            )
        )
        results.append((md.name, r))

    print("\n=== summary ===")
    for name, r in results:
        print(f"  {name}: {r}")


if __name__ == "__main__":
    main()
