from __future__ import annotations

import re
from pathlib import Path

PAGE_MARKER_RE = re.compile(r"<!--\s*PAGE_(\d+)\s*-->", re.IGNORECASE)
PAGE_REF_RE = re.compile(r"\bpage\s*\d+\b", re.IGNORECASE)
ALPHA_RE = re.compile(r"[A-Za-zА-Яа-яӘәІіҢңҒғҮүҰұҚқӨөҺһ]")
THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
WATERMARK_MARKERS = (
    "okulyk.kz",
    "okulyk.com",
    "книга предоставлена исключительно",
    "образовательных целях",
    "ищите на сайтах",
    "не для печати",
)
INTRO_PREFIXES = (
    "here is the markdown",
    "here is the extracted",
    "below is the markdown",
    "markdown:",
)


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def strip_code_fences(text: str) -> str:
    text = THINK_BLOCK_RE.sub("", normalize_newlines(text)).strip()
    if not text.startswith("```"):
        return text

    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def strip_model_preface(text: str) -> str:
    lines = normalize_newlines(text).splitlines()
    while lines:
        normalized = re.sub(r"\s+", " ", lines[0]).strip().lower().rstrip(":")
        if normalized in {"markdown", "md"}:
            lines.pop(0)
            continue
        if any(normalized.startswith(prefix) for prefix in INTRO_PREFIXES):
            lines.pop(0)
            continue
        break
    return "\n".join(lines).strip()


def remove_watermark_lines(text: str) -> str:
    cleaned_lines: list[str] = []
    for line in normalize_newlines(text).splitlines():
        normalized = re.sub(r"\s+", " ", line).strip().lower()
        if normalized in {"[skip_page]", "skip_page"}:
            return "[SKIP_PAGE]"
        if normalized and any(marker in normalized for marker in WATERMARK_MARKERS):
            continue
        cleaned_lines.append(line.rstrip())

    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def looks_like_navigation_junk(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", normalize_newlines(text)).strip().lower()
    if not normalized:
        return True
    if normalized in {"[skip_page]", "skip_page"}:
        return True

    page_refs = PAGE_REF_RE.findall(normalized)
    if len(page_refs) >= 6:
        return True
    if page_refs and len(" ".join(page_refs)) / max(len(normalized), 1) > 0.35:
        return True

    if "okulyk" in normalized and len(normalized) < 260:
        return True

    alpha_count = len(ALPHA_RE.findall(normalized))
    if alpha_count < 24 and len(page_refs) >= 2:
        return True

    if re.fullmatch(r"[#*\-\s\d.:/]+", normalized):
        return True

    return False


def clean_page_markdown(text: str) -> str | None:
    cleaned = strip_model_preface(strip_code_fences(text))
    cleaned = remove_watermark_lines(cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if looks_like_navigation_junk(cleaned):
        return None
    return cleaned


def split_markdown_pages(text: str) -> list[tuple[int | None, str]]:
    normalized = normalize_newlines(text)
    matches = list(PAGE_MARKER_RE.finditer(normalized))
    if not matches:
        return [(None, normalized.strip())]

    page_blocks: list[tuple[int | None, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        page_number = int(match.group(1))
        content = normalized[start:end].strip()
        page_blocks.append((page_number, content))
    return page_blocks


def rebuild_markdown_document(page_blocks: list[tuple[int | None, str]]) -> str:
    parts: list[str] = []
    for page_number, content in page_blocks:
        body = content.strip()
        if not body:
            continue
        if page_number is None:
            parts.append(body)
        else:
            parts.append(f"<!-- PAGE_{page_number} -->\n{body}")
    if not parts:
        return ""
    return "\n\n".join(parts).strip() + "\n"


def cleanup_markdown_document(text: str) -> tuple[str, dict[str, int | bool]]:
    page_blocks = split_markdown_pages(text)
    kept_blocks: list[tuple[int | None, str]] = []
    removed_pages = 0

    for page_number, content in page_blocks:
        cleaned = clean_page_markdown(content)
        if cleaned is None:
            removed_pages += 1
            continue
        kept_blocks.append((page_number, cleaned))

    cleaned_document = rebuild_markdown_document(kept_blocks)
    original_normalized = normalize_newlines(text).strip()
    stats = {
        "total_pages": len(page_blocks),
        "kept_pages": len(kept_blocks),
        "removed_pages": removed_pages,
        "needs_rewrite": cleaned_document.strip() != original_normalized,
    }
    return cleaned_document, stats


def cleanup_markdown_file(path: Path) -> dict[str, int | bool]:
    if not path.exists():
        return {
            "total_pages": 0,
            "kept_pages": 0,
            "removed_pages": 0,
            "needs_rewrite": False,
        }

    original = path.read_text(encoding="utf-8", errors="ignore")
    cleaned, stats = cleanup_markdown_document(original)
    if stats["needs_rewrite"]:
        path.write_text(cleaned, encoding="utf-8")
    return stats


def markdown_quality_report(path: Path) -> dict[str, int | bool]:
    if not path.exists():
        return {
            "exists": False,
            "usable": False,
            "total_pages": 0,
            "kept_pages": 0,
            "removed_pages": 0,
            "needs_rewrite": False,
            "alpha_chars": 0,
            "cleaned_length": 0,
        }

    original = path.read_text(encoding="utf-8", errors="ignore")
    cleaned, stats = cleanup_markdown_document(original)
    alpha_chars = len(ALPHA_RE.findall(cleaned))
    usable = stats["kept_pages"] >= 3 and alpha_chars >= 1000
    return {
        "exists": True,
        "usable": usable,
        "total_pages": stats["total_pages"],
        "kept_pages": stats["kept_pages"],
        "removed_pages": stats["removed_pages"],
        "needs_rewrite": stats["needs_rewrite"],
        "alpha_chars": alpha_chars,
        "cleaned_length": len(cleaned),
    }
