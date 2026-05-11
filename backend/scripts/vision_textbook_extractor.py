import argparse
import base64
import os
import time
from pathlib import Path

import fitz  # PyMuPDF
import pytesseract
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageFilter, ImageOps
from textbook_markdown_utils import clean_page_markdown, cleanup_markdown_document

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
load_dotenv(BACKEND_ROOT / ".env")
load_dotenv(PROJECT_ROOT / ".env")

MODEL = os.getenv("TEXTBOOK_OCR_MODEL") or "gpt-4o"
OCR_ENGINE = (os.getenv("TEXTBOOK_OCR_ENGINE") or "tesseract").strip().lower()
TESSERACT_LANG = os.getenv("TEXTBOOK_OCR_LANG") or "rus+eng+kaz"
TESSERACT_CMD_CANDIDATES = (
    os.getenv("TESSERACT_CMD"),
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)
SYSTEM_PROMPT = """You are a rigorous OCR engine for Kazakhstan school textbooks.

RULES:
1. Extract the page into clean Markdown in the original language of the page.
2. Preserve Russian and Kazakh Cyrillic accurately, including Kazakh-specific letters.
3. Convert mathematical notation into LaTeX when needed.
4. Preserve headings, lists, tables, tasks, formulas, and short figure captions.
5. Omit the OKULYK watermark/footer and similar download-site noise.
6. If the page is mostly viewer navigation, thumbnail indexes, repeated labels like page1/page2, legal boilerplate, or otherwise has no useful study content, return exactly [SKIP_PAGE].
7. Output only the Markdown. Do not wrap it in code fences and do not add commentary.
"""


def get_available_tessdata_languages() -> set[str]:
    tessdata_dir = PROJECT_ROOT / "tessdata"
    if not tessdata_dir.exists():
        return set()
    return {path.stem for path in tessdata_dir.glob("*.traineddata")}


def resolve_tesseract_langs() -> str:
    requested = [part.strip() for part in TESSERACT_LANG.split("+") if part.strip()]
    available = get_available_tessdata_languages()
    if not requested:
        requested = ["rus", "eng", "kaz"]
    if not available:
        return "+".join(requested)

    selected = [lang for lang in requested if lang in available]
    if selected:
        return "+".join(selected)

    fallback = [lang for lang in ("rus", "eng") if lang in available]
    return "+".join(fallback or requested)


def get_client(api_key=None, base_url=None):
    api_key = api_key or os.getenv("TEXTBOOK_OCR_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = (
        base_url
        or os.getenv("TEXTBOOK_OCR_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    if not api_key:
        print("ERROR: OPENAI_API_KEY environment variable is not set and no key passed.")
        exit(1)
    return OpenAI(api_key=api_key, base_url=base_url)


def resolve_tesseract_cmd() -> str:
    for candidate in TESSERACT_CMD_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    raise FileNotFoundError(
        "Tesseract OCR executable was not found. Set TESSERACT_CMD or install Tesseract."
    )


def render_page_image(page: fitz.Page, zoom: float = 3.0) -> Image.Image:
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples).convert("L")
    image = ImageOps.autocontrast(image)
    image = image.filter(ImageFilter.SHARPEN)
    image = image.point(lambda pixel: 255 if pixel > 185 else 0)
    return image


def normalize_ocr_text(text: str) -> str:
    text = text.replace("\x0c", "").replace("\r", "\n")
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")

    raw_lines = [line.strip() for line in text.splitlines()]
    paragraphs: list[str] = []
    current: list[str] = []

    for line in raw_lines:
        if not line:
            if current:
                paragraphs.append(" ".join(current).strip())
                current = []
            continue

        if len(line) <= 1:
            continue

        current.append(line)
        if line.endswith((".", ":", ";", "?", "!", ")")) or len(current) >= 4:
            paragraphs.append(" ".join(current).strip())
            current = []

    if current:
        paragraphs.append(" ".join(current).strip())

    normalized = "\n\n".join(paragraph for paragraph in paragraphs if paragraph)
    return normalized.strip()


def process_page_with_tesseract(page: fitz.Page, page_num: int) -> str | None:
    tesseract_langs = resolve_tesseract_langs()
    print(f"   OCR page {page_num} with Tesseract ({tesseract_langs})...")
    pytesseract.pytesseract.tesseract_cmd = resolve_tesseract_cmd()
    os.environ.setdefault("TESSDATA_PREFIX", str(PROJECT_ROOT / "tessdata"))

    image = render_page_image(page)
    text = pytesseract.image_to_string(
        image,
        lang=tesseract_langs,
        config="--oem 1 --psm 6",
    )
    cleaned = clean_page_markdown(normalize_ocr_text(text))
    return cleaned or "[SKIP_PAGE]"


def process_page_with_vision(client, base64_image, page_num, model=MODEL):
    print(f"   Sending page {page_num} to Vision API ({model})...")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Transcribe this textbook page into clean Markdown.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"},
                        },
                    ],
                },
            ],
            temperature=0.0,
        )
        cleaned = clean_page_markdown(response.choices[0].message.content or "")
        return cleaned or "[SKIP_PAGE]"
    except Exception as e:
        print(f"   ERROR processing page {page_num}: {e}")
        return None


def process_pdf(
    pdf_path,
    output_md_path,
    start_page=0,
    max_pages=None,
    client=None,
    model=MODEL,
    engine=OCR_ENGINE,
):
    if not os.path.exists(pdf_path):
        print(f"ERROR: Target PDF not found at {pdf_path}")
        return False

    if engine == "vision" and not client:
        client = get_client()

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"ERROR: Failed to open PDF {pdf_path}: {e}")
        return False

    total_pages = len(doc)

    end_page = total_pages
    if max_pages:
        end_page = min(start_page + max_pages, total_pages)

    print(f"Opened PDF: {pdf_path}")
    print(f"Processing pages {start_page} to {end_page - 1}...")
    print(f"OCR engine: {engine}")

    all_markdown = []

    for i in range(start_page, end_page):
        try:
            page = doc[i]
            md_text = None
            if engine == "tesseract":
                md_text = process_page_with_tesseract(page, i)
            else:
                render = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
                img_bytes = render.tobytes("jpeg")
                base64_image = base64.b64encode(img_bytes).decode("utf-8")

                for _attempt in range(3):
                    md_text = process_page_with_vision(client, base64_image, i, model=model)
                    if md_text:
                        break
                    print(f"   Page {i} retrying in 2 seconds...")
                    time.sleep(2)

            if md_text:
                if "[SKIP_PAGE]" in md_text:
                    print(f"   Page {i} marked as skip.")
                else:
                    print(f"   Page {i} transcribed.")
                    all_markdown.append(f"<!-- PAGE_{i} -->\n{md_text}\n")
            else:
                print(f"   WARNING: Failed page {i}.")
        except Exception as e:
            print(f"   ERROR: Critical error on page {i}: {e}")

    if all_markdown:
        cleaned_document, stats = cleanup_markdown_document("\n\n".join(all_markdown))
        if not cleaned_document.strip():
            print("WARNING: No usable markdown remained after cleanup.")
            return False
        os.makedirs(os.path.dirname(output_md_path), exist_ok=True)
        with open(output_md_path, "w", encoding="utf-8") as f:
            f.write(cleaned_document)
        print(
            f"Cleanup kept {stats['kept_pages']} pages and removed {stats['removed_pages']} junk pages."
        )
        print(f"Saved to: {output_md_path}")
        return True
    else:
        print("WARNING: No markdown generated.")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert scanned PDFs to Markdown via OpenAI Vision API"
    )
    parser.add_argument("pdf_path", help="Path to input PDF")
    parser.add_argument("output_md", help="Path to output Markdown file")
    parser.add_argument("--start", type=int, default=0, help="Starting page index")
    parser.add_argument("--max_pages", type=int, default=None, help="Maximum pages to process")
    parser.add_argument("--model", default=MODEL, help="Vision model to use when engine=vision")
    parser.add_argument(
        "--engine", default=OCR_ENGINE, choices=["tesseract", "vision"], help="OCR engine"
    )

    args = parser.parse_args()
    process_pdf(
        args.pdf_path,
        args.output_md,
        args.start,
        args.max_pages,
        model=args.model,
        engine=args.engine,
    )
