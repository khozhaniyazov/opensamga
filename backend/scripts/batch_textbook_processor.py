import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from textbook_markdown_utils import cleanup_markdown_file, markdown_quality_report
from vision_textbook_extractor import MODEL, OCR_ENGINE, process_pdf

from app.utils.textbook_metadata import build_markdown_source_metadata

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_LIB = BASE_DIR / "dataset" / "raw_library"
CONVERT_LIB = BASE_DIR / "dataset" / "converted_library"
PROGRESS_FILE = BASE_DIR / "backend" / "hydration_progress.json"
MIN_PDF_BYTES = 1_000_000


def build_progress_entry(
    *,
    status: str,
    rel_path: str,
    md_path: Path | None = None,
    report: dict | None = None,
    reason: str | None = None,
    engine: str | None = None,
    model: str | None = None,
) -> dict:
    project_root = BASE_DIR
    raw_pdf = RAW_LIB / rel_path
    source_md = md_path or CONVERT_LIB / Path(rel_path).with_suffix(".md")

    metadata: dict = {}
    try:
        parts = Path(rel_path).parts
        if len(parts) >= 2 and parts[1].isdigit():
            metadata = build_markdown_source_metadata(
                md_path=source_md,
                subject=parts[0],
                grade=int(parts[1]),
                project_root=project_root,
            )
    except Exception:
        metadata = {}

    return {
        "status": status,
        "updated_at": datetime.now(UTC).isoformat(),
        "source_pdf": str(raw_pdf),
        "output_md": str(source_md),
        "title": metadata.get("title"),
        "subject": metadata.get("subject"),
        "grade": metadata.get("grade"),
        "engine": engine,
        "model": model,
        "reason": reason,
        "report": report or {},
    }


def load_progress():
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_progress(progress):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)


def get_status(value):
    if isinstance(value, dict):
        return value.get("status")
    return value


def get_job_list(progress, force=False, match=None):
    jobs = []
    match_text = match.casefold() if match else None
    for pdf_path in RAW_LIB.rglob("*.pdf"):
        rel_path = pdf_path.relative_to(RAW_LIB)
        output_md = CONVERT_LIB / rel_path.with_suffix(".md")
        rel_string = str(rel_path)

        if match_text and match_text not in rel_string.casefold():
            continue

        if pdf_path.stat().st_size < MIN_PDF_BYTES:
            progress[str(rel_path)] = build_progress_entry(
                status="skipped",
                rel_path=rel_string,
                md_path=output_md,
                reason=f"file too small: {pdf_path.stat().st_size / 1024:.1f} KB",
            )
            continue

        if output_md.exists():
            cleanup_markdown_file(output_md)

        report = markdown_quality_report(output_md)
        status = get_status(progress.get(str(rel_path)))

        if not force and report["usable"]:
            if status != "success":
                progress[str(rel_path)] = build_progress_entry(
                    status="success",
                    rel_path=rel_string,
                    md_path=output_md,
                    report=report,
                )
            continue

        jobs.append(
            {
                "pdf": pdf_path,
                "md": output_md,
                "rel": rel_string,
                "report": report,
            }
        )
    return jobs


def process_book_job(job, max_pages, model, engine):
    pdf_path = job["pdf"]
    md_path = job["md"]
    rel_path = job["rel"]

    engine_label = f"{engine}:{model}" if engine == "vision" else engine
    print(f"Starting conversion: {rel_path} using {engine_label}")
    success = process_pdf(
        str(pdf_path),
        str(md_path),
        max_pages=max_pages,
        model=model,
        engine=engine,
    )
    report = markdown_quality_report(md_path)

    if success and report["usable"]:
        print(
            f"Completed: {rel_path} ({report['kept_pages']} clean pages, {report['removed_pages']} removed)"
        )
        return rel_path, build_progress_entry(
            status="success",
            rel_path=rel_path,
            md_path=md_path,
            report=report,
            engine=engine,
            model=model,
        )

    print(f"Failed quality gate: {rel_path}")
    return rel_path, build_progress_entry(
        status="failed",
        rel_path=rel_path,
        md_path=md_path,
        report=report,
        reason="quality gate failed",
        engine=engine,
        model=model,
    )


def main():
    import sys

    if sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Batch process UNT textbooks using Vision AI")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of books to process")
    parser.add_argument("--workers", type=int, default=2, help="Number of parallel workers")
    parser.add_argument("--pages", type=int, default=None, help="Max pages per book")
    parser.add_argument(
        "--force", action="store_true", help="Rebuild markdown even when an output looks usable"
    )
    parser.add_argument("--model", default=MODEL, help="Vision model override")
    parser.add_argument(
        "--engine", default=OCR_ENGINE, choices=["tesseract", "vision"], help="OCR engine"
    )
    parser.add_argument(
        "--match", default=None, help="Only process books whose relative path contains this text"
    )
    args = parser.parse_args()

    progress = load_progress()
    jobs = get_job_list(progress, force=args.force, match=args.match)
    save_progress(progress)
    pending_jobs = jobs

    if args.limit:
        pending_jobs = pending_jobs[: args.limit]

    print(f"Total PDFs found: {len(jobs)}")
    print(f"Pending jobs: {len(pending_jobs)}")
    print(f"Parallel workers: {args.workers}")
    if args.pages:
        print(f"Pages per book: {args.pages}")
    print("--------------------------------------------------")

    if not pending_jobs:
        print("All books already processed.")
        return

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_job = {}
        for job in pending_jobs:
            future = executor.submit(process_book_job, job, args.pages, args.model, args.engine)
            future_to_job[future] = job

        try:
            for future in as_completed(future_to_job):
                rel_path, entry = future.result()
                progress[rel_path] = entry
                save_progress(progress)
        except KeyboardInterrupt:
            print("\nStop requested. Saving progress and exiting...")
            executor.shutdown(wait=False, cancel_futures=True)

    print("\nBatch processing cycle complete.")


if __name__ == "__main__":
    main()
