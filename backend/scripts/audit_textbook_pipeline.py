from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.utils.textbook_metadata import load_sidecar_metadata

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_ROOT = PROJECT_ROOT / "dataset" / "raw_library"
CONVERTED_ROOT = PROJECT_ROOT / "dataset" / "converted_library"
PROGRESS_FILE = PROJECT_ROOT / "backend" / "hydration_progress.json"
OUTPUT_FILE = PROJECT_ROOT / "backend" / "validation" / "textbook_pipeline_audit.json"


def load_progress() -> dict:
    if not PROGRESS_FILE.exists():
        return {}
    return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))


def main() -> None:
    if hasattr(__import__("sys").stdout, "reconfigure"):
        __import__("sys").stdout.reconfigure(encoding="utf-8", errors="replace")

    progress = load_progress()
    subject_rows: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "raw_pdfs": 0,
            "converted_markdown": 0,
            "missing_markdown": 0,
            "progress_success": 0,
            "progress_failed": 0,
            "progress_skipped": 0,
        }
    )

    languages = Counter()
    missing_books = []

    raw_pdfs = sorted(RAW_ROOT.rglob("*.pdf"))
    converted_mds = sorted(CONVERTED_ROOT.rglob("*.md"))
    converted_set = {
        str(path.relative_to(CONVERTED_ROOT).with_suffix(".pdf")).casefold()
        for path in converted_mds
    }

    for pdf_path in raw_pdfs:
        rel = pdf_path.relative_to(RAW_ROOT)
        subject = rel.parts[0] if rel.parts else "Unknown"
        rel_key = str(rel)
        rel_lookup = rel_key.casefold()

        subject_rows[subject]["raw_pdfs"] += 1

        progress_value = progress.get(rel_key)
        if isinstance(progress_value, dict):
            status = str(progress_value.get("status") or "").lower()
        else:
            status = str(progress_value or "").lower()

        if status == "success":
            subject_rows[subject]["progress_success"] += 1
        elif status == "failed":
            subject_rows[subject]["progress_failed"] += 1
        elif status == "skipped":
            subject_rows[subject]["progress_skipped"] += 1

        if rel_lookup in converted_set:
            subject_rows[subject]["converted_markdown"] += 1
        else:
            subject_rows[subject]["missing_markdown"] += 1
            missing_books.append(rel_key)

        sidecar = load_sidecar_metadata(pdf_path)
        language = str(sidecar.get("Язык") or "").strip()
        if language:
            languages[language] += 1

    payload = {
        "raw_pdf_count": len(raw_pdfs),
        "converted_markdown_count": len(converted_mds),
        "missing_markdown_count": len(missing_books),
        "progress_entries": len(progress),
        "languages": languages.most_common(),
        "subjects": dict(sorted(subject_rows.items())),
        "sample_missing_books": missing_books[:100],
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"raw_pdf_count={payload['raw_pdf_count']}")
    print(f"converted_markdown_count={payload['converted_markdown_count']}")
    print(f"missing_markdown_count={payload['missing_markdown_count']}")
    print(f"audit_saved={OUTPUT_FILE}")


if __name__ == "__main__":
    main()
