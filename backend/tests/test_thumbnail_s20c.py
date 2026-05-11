"""Phase A (s20c) — unit tests for the PDF page thumbnail renderer.

Covers the pure helper used by the ``GET /api/library/books/{id}/pages/{p}/thumbnail``
endpoint. We exercise the full render path on an in-memory two-page PDF so
we never need a real textbook on disk or a Postgres connection (these tests
are NOT marked ``integration``).

Endpoint-level behavior (404 on missing book, 400 on bad page, cache-hit
header) is covered end-to-end in the harness; here we pin down the render
contract + cache path contract.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import pytest

from app.routers.library import (
    _THUMB_MAX_WIDTH,
    _THUMB_MIN_WIDTH,
    _render_pdf_page_png,
    _thumb_cache_path,
)


def _make_two_page_pdf(tmpdir: Path) -> Path:
    """Create a tiny 2-page PDF on disk using PyMuPDF; return its path."""
    import fitz

    out = tmpdir / "sample.pdf"
    doc = fitz.open()
    for text in ("Page one content", "Page two content"):
        page = doc.new_page(width=612, height=792)  # US-letter
        page.insert_text((72, 72), text, fontsize=12)
    doc.save(str(out))
    doc.close()
    return out


def test_render_returns_png_bytes_at_requested_width():
    with tempfile.TemporaryDirectory() as td:
        pdf = _make_two_page_pdf(Path(td))
        png = _render_pdf_page_png(pdf, 1, 360)

    # PNG magic bytes
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    # Width check: parse the IHDR chunk (bytes 16..20 = width big-endian)
    width = int.from_bytes(png[16:20], "big")
    # We asked for 360, PyMuPDF rounds based on zoom * rect.width. US-letter
    # is 612px wide at 72 DPI, zoom = 360/612 ≈ 0.588, so width lands within
    # 1-2 px of target. Assert a tolerant band.
    assert 355 <= width <= 365, f"unexpected rendered width {width}"


def test_render_second_page_differs_from_first():
    with tempfile.TemporaryDirectory() as td:
        pdf = _make_two_page_pdf(Path(td))
        p1 = _render_pdf_page_png(pdf, 1, 240)
        p2 = _render_pdf_page_png(pdf, 2, 240)

    assert p1 != p2, "page 1 and page 2 renders should differ"


def test_render_raises_index_error_on_out_of_range_page():
    with tempfile.TemporaryDirectory() as td:
        pdf = _make_two_page_pdf(Path(td))
        with pytest.raises(IndexError):
            _render_pdf_page_png(pdf, 99, 240)
        with pytest.raises(IndexError):
            _render_pdf_page_png(pdf, 0, 240)


def test_render_handles_minimum_and_maximum_widths():
    with tempfile.TemporaryDirectory() as td:
        pdf = _make_two_page_pdf(Path(td))
        small = _render_pdf_page_png(pdf, 1, _THUMB_MIN_WIDTH)
        big = _render_pdf_page_png(pdf, 1, _THUMB_MAX_WIDTH)

    small_w = int.from_bytes(small[16:20], "big")
    big_w = int.from_bytes(big[16:20], "big")
    assert small_w < big_w
    assert abs(small_w - _THUMB_MIN_WIDTH) <= 2
    assert abs(big_w - _THUMB_MAX_WIDTH) <= 2


def test_cache_path_is_deterministic_and_namespaced():
    a = _thumb_cache_path(21, 142, 360)
    b = _thumb_cache_path(21, 142, 360)
    c = _thumb_cache_path(21, 142, 240)
    d = _thumb_cache_path(22, 142, 360)

    assert a == b, "same inputs must produce same cache path"
    assert a != c, "different widths must map to different files"
    assert a != d, "different book ids must map to different directories"
    # Directory shape: .../pdf_thumbs/21/142_w360.png
    assert a.name == "142_w360.png"
    assert a.parent.name == "21"


def test_cache_path_is_under_backend_cache_dir():
    p = _thumb_cache_path(99, 1, 240)
    parts = p.parts
    assert ".cache" in parts
    assert "pdf_thumbs" in parts
