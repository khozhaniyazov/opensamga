import asyncio
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import LibraryUploadJob, UploadJobStatus

logger = logging.getLogger(__name__)

# Paths to the conversion and ingestion scripts
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
CONVERT_SCRIPT = BACKEND_DIR / "scripts" / "convert_scanned_book.py"
INGEST_SCRIPT = BACKEND_DIR / "scripts" / "ingest_markdown.py"
DATASET_DIR = BACKEND_DIR.parent / "dataset"


async def update_job_status(job_id: int, status: UploadJobStatus, logs: str = None):
    """Utility to update job status in a new DB session."""
    async with AsyncSessionLocal() as db:
        update_data = {"status": status}
        if logs is not None:
            update_data["logs"] = logs

        if status in [UploadJobStatus.COMPLETED, UploadJobStatus.FAILED]:
            update_data["completed_at"] = datetime.now(UTC)

        stmt = update(LibraryUploadJob).where(LibraryUploadJob.id == job_id).values(**update_data)
        await db.execute(stmt)
        await db.commit()


async def process_background_upload(job_id: int, pdf_path: str):
    """
    Background worker that runs the full OCR + Vector Ingestion pipeline.
    We track logs and update the database so the frontend can display progress.
    """
    pdf_file = Path(pdf_path)
    accumulated_logs = ""

    def log(message: str):
        nonlocal accumulated_logs
        accumulated_logs += message + "\n"
        # v3.57: route through module logger so the upload-job heartbeat
        # lands in standard scrapers. The DB-side ``logs`` column still
        # captures the full transcript via ``accumulated_logs`` above.
        # job_id is in the message format string so log scrapers can
        # filter by upload-job without parsing a prefix.
        logger.info("[UploadJob %s] %s", job_id, message)

    try:
        log(f"Starting background job {job_id} for file {pdf_file.name}")

        if not pdf_file.exists():
            raise FileNotFoundError(f"PDF file not found at {pdf_file}")

        # 1. OCR Processing
        log("\n=== Phase 1: OCR Processing ===")
        await update_job_status(job_id, UploadJobStatus.PROCESSING_OCR, accumulated_logs)

        ocr_cmd = [sys.executable, str(CONVERT_SCRIPT), str(pdf_file), "--limit", "0"]
        log(f"Executing: {' '.join(ocr_cmd)}")

        process = await asyncio.create_subprocess_exec(
            *ocr_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )

        while True:
            line = await process.stdout.readline()
            if not line:
                break
            decoded_line = line.decode("utf-8", errors="replace").rstrip()
            log(decoded_line)

        await process.wait()

        if process.returncode != 0:
            raise Exception(f"OCR Conversion failed with return code {process.returncode}")

        # Move the output markdown file to the correct structured directory for ingestion
        # source path: backend/dataset/converted_books/{stem}.md -> actually, wait
        # convert_scanned_book.py says: output_dir = Path("dataset/converted_books") relative to CWD
        # The script is run from backend dir, so it will be in backend_dir / "dataset" / "converted_books" if CWD is backend
        # Let's specify cwd to backend explicitly to be safe:

        # Ensure we move the file:
        # from backend/dataset/converted_books/{stem}.md
        # to ../dataset/converted_library/{subject}/{grade}/{stem}.md

        subject_dir = pdf_file.parent.parent.name
        grade_dir = pdf_file.parent.name

        # The script `convert_scanned_book.py` is invoked with CWD of the backend process,
        # so "dataset/converted_books" is under backend.
        default_output = BACKEND_DIR / "dataset" / "converted_books" / f"{pdf_file.stem}.md"

        target_md_dir = DATASET_DIR / "converted_library" / subject_dir / grade_dir
        target_md_dir.mkdir(parents=True, exist_ok=True)
        target_md_path = target_md_dir / f"{pdf_file.stem}.md"

        if default_output.exists():
            # If target already exists, remove it
            if target_md_path.exists():
                os.remove(target_md_path)
            default_output.rename(target_md_path)
            log(f"Moved Markdown file to {target_md_path}")
        else:
            raise Exception(f"Expected markdown output not found at {default_output}")

        # 2. Vector Ingestion
        log("\n=== Phase 2: Vector Ingestion ===")
        await update_job_status(job_id, UploadJobStatus.PROCESSING_VECTOR, accumulated_logs)

        ingest_cmd = [sys.executable, str(INGEST_SCRIPT)]
        log(f"Executing: {' '.join(ingest_cmd)}")

        process = await asyncio.create_subprocess_exec(
            *ingest_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(BACKEND_DIR),  # Ensure it runs from backend dir
        )

        while True:
            line = await process.stdout.readline()
            if not line:
                break
            decoded_line = line.decode("utf-8", errors="replace").rstrip()
            log(decoded_line)

        await process.wait()

        if process.returncode != 0:
            raise Exception(f"Vector Ingestion failed with return code {process.returncode}")

        # 3. Completed
        log("\n=== Phase 3: Completed Successfully! ===")
        await update_job_status(job_id, UploadJobStatus.COMPLETED, accumulated_logs)

    except Exception as e:
        log(f"\n❌ Job Failed: {str(e)}")
        await update_job_status(job_id, UploadJobStatus.FAILED, accumulated_logs)
