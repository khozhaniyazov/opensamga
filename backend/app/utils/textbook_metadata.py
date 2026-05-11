from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

INVALID_TITLES = {"", "unknown", "untitled", "nan", "none"}
JUNK_TITLE_MARKERS = ("okulyk.kz", "download pdf", "скачать pdf")
LANGUAGE_SUFFIXES = {"ru", "kz", "en", "eng", "анг", "рус", "ру", "кз", "каз", "қаз"}


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def strip_language_suffixes(value: str) -> str:
    tokens = value.split()
    while tokens:
        lowered = tokens[-1].strip(".,()[]").lower()
        if lowered not in LANGUAGE_SUFFIXES:
            break
        tokens.pop()
    return " ".join(tokens)


def contains_junk_title(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in JUNK_TITLE_MARKERS)


def title_case_ascii(value: str) -> str:
    small_words = {"and", "of", "the"}
    parts = []
    for index, token in enumerate(value.split()):
        lowered = token.lower()
        if lowered in small_words and index > 0:
            parts.append(lowered)
        else:
            parts.append(lowered.capitalize())
    return " ".join(parts)


def clean_title_candidate(value: str | None) -> str:
    if not value:
        return ""

    cleaned = value.replace(".pdf", "")
    cleaned = cleaned.replace("_", " ").replace("-", " ")
    cleaned = normalize_whitespace(cleaned)
    cleaned = re.sub(r"(?i)\b(?:download|скачать)\s+pdf\b", "", cleaned)
    cleaned = re.sub(r"(?i)\bokulyk\.kz\b", "", cleaned)
    cleaned = re.sub(r"(?i)\bучебник\s+для\s+\d+\s+класса\b", "", cleaned)
    cleaned = strip_language_suffixes(normalize_whitespace(cleaned))
    cleaned = re.sub(r"(?i)\b(?:p|part)\s*([0-9]{1,2})\b", r"Part \1", cleaned)
    cleaned = normalize_whitespace(cleaned)

    if (
        not cleaned
        or cleaned.lower() in INVALID_TITLES
        or cleaned in {"-", "–", "—"}
        or cleaned.isdigit()
    ):
        return ""

    if re.fullmatch(r"[a-z0-9 ]+", cleaned.lower()):
        cleaned = title_case_ascii(cleaned)

    return cleaned


def extract_part_suffix(*values: str | None) -> str:
    for value in values:
        if not value:
            continue
        match = re.search(
            r"(?:^|[_\s-])(?:p|part)\s*([0-9]{1,2})(?:$|[_\s-])",
            value,
            re.IGNORECASE,
        )
        if match:
            return f"Part {match.group(1)}"
    return ""


def build_catalog_title(
    meta_title: str | None,
    pdf_title: str | None,
    file_name: str,
    subject: str | None,
    grade: int | None,
) -> str:
    candidate = clean_title_candidate(meta_title)
    if not candidate or contains_junk_title(candidate):
        candidate = clean_title_candidate(pdf_title)
    if not candidate or contains_junk_title(candidate):
        candidate = clean_title_candidate(Path(file_name).stem)

    if not candidate:
        candidate = normalize_whitespace(subject or "Textbook")
        if grade:
            candidate = f"{candidate} {grade}"

    part_suffix = extract_part_suffix(meta_title, pdf_title, file_name)
    candidate = strip_language_suffixes(normalize_whitespace(candidate))
    if part_suffix and part_suffix.lower() not in candidate.lower():
        candidate = f"{candidate} {part_suffix}"

    return candidate or "Textbook"


def load_sidecar_metadata(pdf_path: Path) -> dict[str, Any]:
    sidecar_path = pdf_path.with_suffix(".json")
    if not sidecar_path.exists():
        return {}
    try:
        return json.loads(sidecar_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def resolve_raw_pdf_for_markdown(md_path: Path, project_root: Path) -> Path | None:
    converted_root = (project_root / "dataset" / "converted_library").resolve()
    raw_root = (project_root / "dataset" / "raw_library").resolve()
    resolved_md = md_path.resolve()

    try:
        relative = resolved_md.relative_to(converted_root)
    except ValueError:
        return None

    candidate = raw_root / relative.with_suffix(".pdf")
    return candidate if candidate.exists() else None


def build_markdown_source_metadata(
    md_path: Path,
    subject: str,
    grade: int,
    project_root: Path,
) -> dict[str, Any]:
    source_pdf = resolve_raw_pdf_for_markdown(md_path, project_root)
    sidecar_meta = load_sidecar_metadata(source_pdf) if source_pdf else {}
    file_name = source_pdf.name if source_pdf else md_path.with_suffix(".pdf").name
    file_path = str(source_pdf or md_path)
    title = build_catalog_title(
        sidecar_meta.get("title"),
        None,
        file_name,
        subject,
        grade,
    )

    return {
        "title": title,
        "subject": subject,
        "grade": grade,
        "file_path": file_path,
        "file_name": file_name,
        "source_pdf_path": str(source_pdf) if source_pdf else None,
        "source_sidecar": sidecar_meta,
    }
